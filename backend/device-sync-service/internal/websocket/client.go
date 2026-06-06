package websocket

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"time"

	ws "github.com/coder/websocket"
	"github.com/earflow/music-platform/device-sync-service/internal/config"
	"github.com/earflow/music-platform/device-sync-service/internal/devices"
	"github.com/earflow/music-platform/device-sync-service/internal/observability"
	"github.com/earflow/music-platform/device-sync-service/internal/ratelimit"
)

// Client is one live WebSocket connection. Every method is safe to call from
// a single hub goroutine; writes to `out` are also safe from the hub, because
// the channel itself is concurrency-safe.
type Client struct {
	UserID   string
	Username string
	DeviceID string

	conn *ws.Conn

	out chan []byte

	cfg      *config.Config
	registry *devices.Registry
	log      *slog.Logger
	m        *observability.Metrics
	rl       *ratelimit.Pool
	hub      *Hub

	closeOnce sync.Once
	ctx       context.Context
	cancel    context.CancelFunc
}

// ClientDeps is the only constructor input — every dependency is explicit and
// injected so tests don't need globals.
type ClientDeps struct {
	Config   *config.Config
	Registry *devices.Registry
	Logger   *slog.Logger
	Metrics  *observability.Metrics
	RL       *ratelimit.Pool
}

// Attach binds a freshly upgraded connection to a client and starts its
// read/write pumps. Returns once both pumps exit (connection is fully closed).
func Attach(ctx context.Context, conn *ws.Conn, userID, username, deviceID string, deps ClientDeps, hub *Hub) *Client {
	cctx, cancel := context.WithCancel(ctx)
	c := &Client{
		UserID:   userID,
		Username: username,
		DeviceID: deviceID,
		conn:     conn,
		out:      make(chan []byte, deps.Config.WS.WriteBuffer),
		cfg:      deps.Config,
		registry: deps.Registry,
		log:      deps.Logger,
		m:        deps.Metrics,
		rl:       deps.RL,
		hub:      hub,
		ctx:      cctx,
		cancel:   cancel,
	}
	return c
}

// Run blocks until the connection terminates. Call in its own goroutine.
func (c *Client) Run() {
	conn := c.conn
	conn.SetReadLimit(c.cfg.WS.ReadLimitBytes)

	// Send initial snapshot before starting pumps. Краткие ретраи — Redis/сеть
	// иногда мелькают, не рвём WSS сразу (и клиент не уходит в петлю ticket).
	if err := c.sendInitWithRetries(3, 200*time.Millisecond); err != nil {
		c.log.Warn("send init failed", slog.String("deviceId", c.DeviceID), slog.Any("err", err))
		c.CloseWithCode(1011, "init failed")
		return
	}

	go c.writePump()
	c.readPump()
	c.cancel()
	c.closeChannels()
	c.hub.unregister <- c
}

// =============================================================================
// writePump
// =============================================================================

func (c *Client) writePump() {
	pingT := time.NewTicker(c.cfg.WS.PingInterval)
	defer pingT.Stop()

	for {
		select {
		case <-c.ctx.Done():
			return

		case data, ok := <-c.out:
			if !ok {
				return
			}
			wctx, cancel := context.WithTimeout(c.ctx, c.cfg.WS.WriteTimeout)
			err := c.conn.Write(wctx, ws.MessageText, data)
			cancel()
			if err != nil {
				c.log.Debug("write failed", slog.Any("err", err))
				c.CloseWithCode(1011, "write failed")
				return
			}
			if c.m != nil {
				c.m.WSMessages.WithLabelValues("out", "any").Inc()
			}

		case <-pingT.C:
			pctx, cancel := context.WithTimeout(c.ctx, c.cfg.WS.WriteTimeout)
			err := c.conn.Ping(pctx)
			cancel()
			if err != nil {
				c.log.Debug("ping failed", slog.Any("err", err))
				c.CloseWithCode(1011, "ping failed")
				return
			}
		}
	}
}

// =============================================================================
// readPump
// =============================================================================

func (c *Client) readPump() {
	for {
		rctx, cancel := context.WithTimeout(c.ctx, c.cfg.WS.ReadTimeout)
		typ, data, err := c.conn.Read(rctx)
		cancel()
		if err != nil {
			if !errors.Is(err, context.Canceled) {
				var ce ws.CloseError
				if errors.As(err, &ce) {
					// Normal remote close.
					return
				}
				c.log.Debug("read failed", slog.Any("err", err))
			}
			return
		}
		if typ != ws.MessageText {
			c.CloseWithCode(1003, "binary frames not accepted")
			return
		}

		// Global per-socket rate-limit. A hot caller is killed instead of
		// throttled — clients with tight message budgets should reconnect.
		if !c.rl.Allow(c.rlKey()) {
			if c.m != nil {
				c.m.WSErrors.WithLabelValues("rate_limited").Inc()
			}
			c.CloseWithCode(4008, "rate limit")
			return
		}

		c.handleMessage(data)
	}
}

type incoming struct {
	Type           string                 `json:"type"`
	Cmd            string                 `json:"cmd,omitempty"`
	To             string                 `json:"to,omitempty"`
	Payload        map[string]interface{} `json:"payload,omitempty"`
	State          *devices.NowPlaying    `json:"state,omitempty"`
	ActiveRevision int64                  `json:"activeRevision,omitempty"`
	Ack            *devices.CmdAck        `json:"ack,omitempty"`
	OutputState    devices.OutputState    `json:"outputState,omitempty"`
	TransferID     string                 `json:"transferId,omitempty"`
	CommandID      string                 `json:"commandId,omitempty"`
	Step           string                 `json:"step,omitempty"`
	Ok             *bool                  `json:"ok,omitempty"`
	Reason         string                 `json:"reason,omitempty"`
}

func (c *Client) handleMessage(raw []byte) {
	// Hard size check — the Read limit above is enforced by the library,
	// but we also enforce a payload cap for command payloads explicitly.
	if len(raw) > c.cfg.Device.MaxCommandPayloadBytes+1024 {
		c.CloseWithCode(1009, "message too large")
		return
	}
	var in incoming
	if err := json.Unmarshal(raw, &in); err != nil {
		if c.m != nil {
			c.m.WSErrors.WithLabelValues("bad_json").Inc()
		}
		return
	}
	if c.m != nil {
		c.m.WSMessages.WithLabelValues("in", in.Type).Inc()
	}
	ctx := c.ctx
	switch in.Type {
	case "ping":
		c.send(Event{Type: "pong"})

	case "heartbeat":
		// Fire-and-forget; we don't answer.
		_, _ = c.registry.TouchDevice(ctx, c.DeviceID)

	case "background:heartbeat":
		_, _ = c.registry.TouchDevice(ctx, c.DeviceID)

	case "np:update":
		if in.State == nil {
			in.State = &devices.NowPlaying{}
		}
		in.State.DeviceID = c.DeviceID
		result, err := c.registry.PutNowPlaying(ctx, c.UserID, in.State)
		if errors.Is(err, devices.ErrNotActiveDevice) {
			if c.m != nil {
				c.m.WSErrors.WithLabelValues("np_from_non_active").Inc()
			}
			c.send(Event{Type: "np:ack", At: time.Now().UnixMilli(), DeviceID: c.DeviceID, Accepted: boolPtr(false), Reason: "NOT_ACTIVE"})
			return
		}
		if err != nil {
			c.log.Debug("put now-playing failed", slog.Any("err", err))
			c.send(Event{Type: "np:ack", At: time.Now().UnixMilli(), DeviceID: c.DeviceID, Accepted: boolPtr(false), Reason: "WRITE_FAILED"})
			return
		}
		accepted := false
		reason := ""
		var np *devices.NowPlaying
		if result != nil {
			accepted = result.Accepted
			reason = result.Reason
			np = result.NowPlaying
		}
		activeRevision := int64(0)
		if result != nil {
			activeRevision = result.ActiveRevision
		}
		c.send(Event{Type: "np:ack", At: time.Now().UnixMilli(), DeviceID: c.DeviceID, State: np, Accepted: boolPtr(accepted), Reason: reason, ActiveRevision: activeRevision})

	case "cmd":
		if in.Cmd == "" {
			return
		}
		if err := c.registry.SendCommand(ctx, c.UserID, c.DeviceID, in.To, in.Cmd, in.Payload, in.ActiveRevision); err != nil {
			c.log.Debug("send command failed",
				slog.String("cmd", in.Cmd),
				slog.Any("err", err),
			)
			if c.m != nil {
				c.m.WSErrors.WithLabelValues("cmd_rejected").Inc()
			}
		}

	case "cmd:ack":
		ack := devices.CmdAck{}
		if in.Ack != nil {
			ack = *in.Ack
		} else {
			ack = devices.CmdAck{
				TransferID:     in.TransferID,
				CommandID:      in.CommandID,
				Cmd:            in.Cmd,
				Step:           in.Step,
				Ok:             in.Ok == nil || *in.Ok,
				Reason:         in.Reason,
				ActiveRevision: in.ActiveRevision,
			}
		}
		ack.Type = "cmd:ack"
		ack.DeviceID = c.DeviceID
		if ack.At <= 0 {
			ack.At = time.Now().UnixMilli()
		}
		if _, err := c.registry.HandleCmdAck(ctx, c.UserID, ack); err != nil {
			c.log.Debug("cmd ack rejected", slog.Any("err", err), slog.String("deviceId", c.DeviceID))
			if c.m != nil {
				c.m.WSErrors.WithLabelValues("cmd_ack_rejected").Inc()
			}
		}

	case "output:report":
		if _, err := c.registry.HandleOutputReport(ctx, c.UserID, devices.OutputReport{
			DeviceID:       c.DeviceID,
			State:          in.OutputState,
			ActiveRevision: in.ActiveRevision,
			At:             time.Now().UnixMilli(),
			Reason:         in.Reason,
		}); err != nil {
			c.log.Debug("output report rejected", slog.Any("err", err), slog.String("deviceId", c.DeviceID))
			if c.m != nil {
				c.m.WSErrors.WithLabelValues("output_report_rejected").Inc()
			}
		}

	default:
		// Unknown types are ignored for forward-compatibility.
	}
}

// Event is a thin mirror of devices.Event for server→client frames that don't
// originate from the registry (e.g. the initial snapshot, pong).
type Event struct {
	Type           string                    `json:"type"`
	At             int64                     `json:"at,omitempty"`
	UserID         string                    `json:"userId,omitempty"`
	DeviceID       string                    `json:"deviceId,omitempty"`
	Devices        []*devices.Device         `json:"devices,omitempty"`
	NP             *devices.NowPlaying       `json:"nowPlaying,omitempty"`
	State          *devices.NowPlaying       `json:"state,omitempty"`
	Timeline       *devices.PlaybackTimeline `json:"timeline,omitempty"`
	Lease          *devices.OutputLease      `json:"lease,omitempty"`
	Transfer       *devices.TransferRecord   `json:"transfer,omitempty"`
	Accepted       *bool                     `json:"accepted,omitempty"`
	Reason         string                    `json:"reason,omitempty"`
	ActiveRevision int64                     `json:"activeRevision,omitempty"`
}

func boolPtr(v bool) *bool {
	return &v
}

func (c *Client) send(e Event) {
	data, err := json.Marshal(e)
	if err != nil {
		return
	}
	select {
	case c.out <- data:
	default:
		c.log.Warn("out buffer full on direct send",
			slog.String("userId", c.UserID),
			slog.String("deviceId", c.DeviceID),
		)
		c.CloseWithCode(1013, "slow consumer")
	}
}

// sendInit ships the initial state snapshot so the UI has something to render
// without a separate REST roundtrip.
func (c *Client) sendInit() error {
	ctx, cancel := context.WithTimeout(c.ctx, 5*time.Second)
	defer cancel()

	devs, np, err := c.registry.ListDevices(ctx, c.UserID)
	if err != nil {
		return err
	}
	activeRevision, err := c.registry.GetActiveRevision(ctx, c.UserID)
	if err != nil {
		return err
	}
	lease, err := c.registry.GetOutputLease(ctx, c.UserID)
	if err != nil {
		return err
	}
	var timeline *devices.PlaybackTimeline
	if np != nil {
		timeline = &devices.PlaybackTimeline{
			TrackID:       np.TrackID,
			Title:         np.Title,
			Artist:        np.Artist,
			Cover:         np.Cover,
			DurationSec:   np.DurationSec,
			IsPlaying:     np.IsPlaying,
			PositionSec:   np.PositionSec,
			UpdatedAtMs:   np.UpdatedAtMs,
			StateRevision: np.StateRevision,
		}
	}
	payload := Event{
		Type:           "init",
		At:             time.Now().UnixMilli(),
		UserID:         c.UserID,
		DeviceID:       c.DeviceID,
		Devices:        devs,
		NP:             np,
		Timeline:       timeline,
		Lease:          lease,
		ActiveRevision: activeRevision,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	wctx, wcancel := context.WithTimeout(c.ctx, c.cfg.WS.WriteTimeout)
	defer wcancel()
	return c.conn.Write(wctx, ws.MessageText, data)
}

func (c *Client) sendInitWithRetries(attempts int, pause time.Duration) error {
	if attempts < 1 {
		attempts = 1
	}
	var last error
	for i := 0; i < attempts; i++ {
		if i > 0 {
			time.Sleep(pause)
		}
		last = c.sendInit()
		if last == nil {
			return nil
		}
	}
	return last
}

// CloseWithCode is idempotent and safe to call from any goroutine.
func (c *Client) CloseWithCode(code ws.StatusCode, reason string) {
	c.closeOnce.Do(func() {
		_ = c.conn.Close(code, reason)
		c.cancel()
	})
}

func (c *Client) closeChannels() {
	// Drain out before closing so writePump's select exits cleanly.
	defer func() {
		// A second close panics: guard with recover just in case.
		_ = recover()
	}()
	close(c.out)
}

func (c *Client) rlKey() string {
	// Per-device bucket. IP-based would double-penalize legitimate users
	// behind CGNAT.
	return c.UserID + ":" + c.DeviceID
}
