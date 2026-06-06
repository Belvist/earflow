package partygw

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/earflow/music-platform/party-go/internal/party"
	"github.com/earflow/music-platform/party-go/internal/wire"
	"github.com/earflow/music-platform/party-go/internal/wstoken"
	"github.com/nats-io/nats.go"
	"github.com/oklog/ulid/v2"
)

const (
	wsWriteTimeout      = 2 * time.Second
	wsHeartbeatInterval = 25 * time.Second
	wsHeartbeatTimeout  = 5 * time.Second
)

// Server is the Party real-time WebSocket service (NATS backplane).
type Server struct {
	Cfg  Config
	NC   *nats.Conn
	Subs []*nats.Subscription
	Log  *slog.Logger
	mu   sync.Mutex
	// partyId -> set of connId
	byParty   map[string]map[string]struct{}
	conns     map[string]*connState
	lastTouch map[string]time.Time
}

type connState struct {
	id, partyId, userId, username string
	c                             *websocket.Conn
	writeMu                       sync.Mutex
	closeOnce                     sync.Once
}

// New subscribes to party.v2.events shards.
func New(nc *nats.Conn, cfg Config) *Server {
	s := &Server{
		Cfg:       cfg,
		NC:        nc,
		Log:       slog.Default(),
		byParty:   map[string]map[string]struct{}{},
		conns:     map[string]*connState{},
		lastTouch: map[string]time.Time{},
	}
	for _, sh := range parseShards(cfg.PartyGWShards, cfg.ShardCount) {
		subj := fmt.Sprintf("party.v2.events.%d", sh)
		sub, err := nc.Subscribe(subj, s.onNATS)
		if err == nil {
			s.Subs = append(s.Subs, sub)
		} else if s.Log != nil {
			s.Log.Error("party gateway nats subscribe failed", slog.String("subject", subj), slog.Any("err", err))
		}
	}
	return s
}

func (cs *connState) writeBinary(ctx context.Context, b []byte) error {
	cs.writeMu.Lock()
	defer cs.writeMu.Unlock()
	return cs.c.Write(ctx, websocket.MessageBinary, b)
}

func (cs *connState) writeText(ctx context.Context, b []byte) error {
	cs.writeMu.Lock()
	defer cs.writeMu.Unlock()
	return cs.c.Write(ctx, websocket.MessageText, b)
}

func (cs *connState) close(code websocket.StatusCode, reason string) {
	cs.closeOnce.Do(func() {
		_ = cs.c.Close(code, reason)
	})
}

func (s *Server) registerConn(cs *connState) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.byParty[cs.partyId] == nil {
		s.byParty[cs.partyId] = map[string]struct{}{}
	}
	s.byParty[cs.partyId][cs.id] = struct{}{}
	s.conns[cs.id] = cs
}

func (s *Server) dropConn(cs *connState, code websocket.StatusCode, reason string) {
	if cs == nil {
		return
	}
	s.mu.Lock()
	if set := s.byParty[cs.partyId]; set != nil {
		delete(set, cs.id)
		if len(set) == 0 {
			delete(s.byParty, cs.partyId)
			delete(s.lastTouch, cs.partyId)
		}
	}
	delete(s.conns, cs.id)
	s.mu.Unlock()
	cs.close(code, reason)
}

func (s *Server) activeConnectionCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.conns)
}

func (s *Server) activePartyCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.byParty)
}

func (s *Server) onNATS(m *nats.Msg) {
	raw, err := wire.DecodeMap(m.Data)
	if err != nil {
		return
	}
	partyID, _ := raw["partyId"].(string)
	if partyID == "" {
		if p, ok := raw["payload"].(map[string]any); ok {
			partyID, _ = p["partyId"].(string)
		}
	}
	s.mu.Lock()
	ids, ok := s.byParty[partyID]
	if !ok || len(ids) == 0 {
		s.mu.Unlock()
		return
	}
	clone := make([]*connState, 0, len(ids))
	for id := range ids {
		if c := s.conns[id]; c != nil {
			clone = append(clone, c)
		}
	}
	s.mu.Unlock()
	b := m.Data
	for _, cs := range clone {
		ctx, cancel := context.WithTimeout(context.Background(), wsWriteTimeout)
		err := cs.writeBinary(ctx, b)
		cancel()
		if err != nil {
			if s.Log != nil {
				s.Log.Warn("party ws broadcast failed",
					slog.String("partyId", cs.partyId),
					slog.String("connId", cs.id),
					slog.Any("err", err),
				)
			}
			s.dropConn(cs, websocket.StatusInternalError, "write failed")
		}
	}
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet && r.URL.Path == "/health" {
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
		return
	}
	if r.Method == http.MethodGet && r.URL.Path == "/metrics" {
		n := s.activeConnectionCount()
		p := s.activePartyCount()
		w.Header().Set("content-type", "text/plain; version=0.0.4; charset=utf-8")
		_, _ = fmt.Fprintf(w, "# HELP party_gateway_up gauge\nparty_gateway_up 1\n# HELP party_gateway_active_connections gauge\nparty_gateway_active_connections %d\n# HELP party_gateway_active_parties gauge\nparty_gateway_active_parties %d\n", n, p)
		return
	}
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	q, _ := url.ParseQuery(r.URL.RawQuery)
	tok := strings.TrimSpace(q.Get("wsToken"))
	if tok == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	claims, err := wstoken.Verify(s.Cfg.WSTokenSecret, tok)
	if err != nil {
		if s.Log != nil {
			s.Log.Warn("party ws token rejected", slog.Any("err", err))
		}
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	uid := strings.TrimSpace(r.Header.Get("X-User-Id"))
	if uid == "" || claims.UserID != uid {
		if s.Log != nil {
			s.Log.Warn("party ws user mismatch", slog.String("partyId", claims.PartyID))
		}
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	uname := strings.TrimSpace(r.Header.Get("X-User-Name"))
	if uname == "" {
		uname = "User"
	}
	partyId := claims.PartyID
	cid := ulid.Make().String()

	nc, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	nc.SetReadLimit(64 * 1024)

	cs := &connState{id: cid, partyId: partyId, userId: uid, username: uname, c: nc}
	s.registerConn(cs)

	defer func() {
		s.dropConn(cs, websocket.StatusNormalClosure, "")
	}()

	// initial join
	sh := party.ShardForParty(partyId, s.Cfg.ShardCount)
	joinB, _ := wire.Encode(map[string]any{
		"t": "cmd", "id": cid, "partyId": partyId,
		"payload": map[string]any{
			"cmd": map[string]any{
				"type": "join", "partyId": partyId, "userId": uid, "username": uname,
			},
		},
	})
	resp, err := s.NC.Request(fmt.Sprintf("party.v2.cmd.%d", sh), joinB, s.Cfg.ReqTimeout)
	if err != nil {
		if s.Log != nil {
			s.Log.Warn("party ws initial join failed",
				slog.String("partyId", partyId),
				slog.String("connId", cid),
				slog.Any("err", err),
			)
		}
		cs.close(websocket.StatusInternalError, "join failed")
		return
	}
	{
		ctx, cancel := context.WithTimeout(context.Background(), wsWriteTimeout)
		err = cs.writeBinary(ctx, resp.Data)
		cancel()
		if err != nil {
			if s.Log != nil {
				s.Log.Warn("party ws initial reply failed",
					slog.String("partyId", partyId),
					slog.String("connId", cid),
					slog.Any("err", err),
				)
			}
			return
		}
	}

	heartbeatCtx, stopHeartbeat := context.WithCancel(context.Background())
	defer stopHeartbeat()
	go s.runHeartbeat(heartbeatCtx, cs)

	// read loop
	for {
		typ, b, err := nc.Read(context.Background())
		if err != nil {
			if s.Log != nil {
				s.Log.Debug("party ws closed",
					slog.String("partyId", partyId),
					slog.String("connId", cid),
					slog.Any("err", err),
				)
			}
			return
		}
		// Optional JSON ping from legacy client — do not send to NATS
		if typ == websocket.MessageText {
			_ = b
			continue
		}
		if typ != websocket.MessageBinary {
			continue
		}
		m, err := wire.DecodeMap(b)
		if err != nil {
			continue
		}
		inner, _ := m["payload"].(map[string]any)
		if inner == nil {
			continue
		}
		cmd, _ := inner["cmd"]
		if cmd == nil {
			continue
		}
		// require party/user match
		if cm, ok := cmd.(map[string]any); ok {
			if p, _ := cm["partyId"].(string); p != partyId {
				continue
			}
			if u, _ := cm["userId"].(string); u != uid {
				continue
			}
		}
		if isPingCommand(cmd) {
			s.maybeTouchPartyState(partyId, sh)
			if err := s.writeLocalPong(cs); err != nil {
				if s.Log != nil {
					s.Log.Warn("party ws pong failed",
						slog.String("partyId", partyId),
						slog.String("connId", cid),
						slog.Any("err", err),
					)
				}
				return
			}
			continue
		}
		out, _ := wire.Encode(map[string]any{
			"t": "cmd", "id": ulid.Make().String(), "partyId": partyId,
			"payload": map[string]any{"cmd": cmd},
		})
		rsp, err := s.NC.Request(fmt.Sprintf("party.v2.cmd.%d", sh), out, s.Cfg.ReqTimeout)
		if err == nil {
			if !shouldEchoCommandReply(cmd, rsp.Data) {
				continue
			}
			ctx, cancel := context.WithTimeout(context.Background(), wsWriteTimeout)
			err = cs.writeBinary(ctx, rsp.Data)
			cancel()
			if err != nil {
				if s.Log != nil {
					s.Log.Warn("party ws command reply failed",
						slog.String("partyId", partyId),
						slog.String("connId", cid),
						slog.Any("err", err),
					)
				}
				return
			}
		} else if s.Log != nil {
			s.Log.Warn("party ws command failed",
				slog.String("partyId", partyId),
				slog.String("connId", cid),
				slog.Any("err", err),
			)
		}
	}
}

func commandType(cmd any) string {
	cm, ok := cmd.(map[string]any)
	if !ok {
		return ""
	}
	typ, _ := cm["type"].(string)
	return strings.TrimSpace(typ)
}

func shouldEchoCommandReply(cmd any, data []byte) bool {
	switch commandType(cmd) {
	case "join", "snapshot":
		return true
	}
	raw, err := wire.DecodeMap(data)
	if err != nil {
		return true
	}
	payload, _ := raw["payload"].(map[string]any)
	if payload == nil {
		return true
	}
	ok, okType := payload["ok"].(bool)
	if !okType {
		return true
	}
	return !ok
}

func isPingCommand(cmd any) bool {
	cm, ok := cmd.(map[string]any)
	if !ok {
		return false
	}
	typ, _ := cm["type"].(string)
	return typ == "ping"
}

func (s *Server) writeLocalPong(cs *connState) error {
	ctx, cancel := context.WithTimeout(context.Background(), wsWriteTimeout)
	defer cancel()
	return cs.writeText(ctx, []byte(`{"type":"pong"}`))
}

func (s *Server) maybeTouchPartyState(partyID string, shard int) {
	if strings.TrimSpace(partyID) == "" || s.Cfg.StateTouchInterval <= 0 || s.NC == nil {
		return
	}
	now := time.Now()
	s.mu.Lock()
	last := s.lastTouch[partyID]
	if !last.IsZero() && now.Sub(last) < s.Cfg.StateTouchInterval {
		s.mu.Unlock()
		return
	}
	s.lastTouch[partyID] = now
	s.mu.Unlock()

	msg, err := wire.Encode(map[string]any{
		"t":       "cmd",
		"id":      ulid.Make().String(),
		"partyId": partyID,
		"payload": map[string]any{
			"cmd": map[string]any{
				"type": "ping", "partyId": partyID,
			},
		},
	})
	if err != nil {
		return
	}
	if err := s.NC.Publish(fmt.Sprintf("party.v2.cmd.%d", shard), msg); err != nil && s.Log != nil {
		s.Log.Warn("party state touch publish failed", slog.String("partyId", partyID), slog.Any("err", err))
	}
}

func (s *Server) runHeartbeat(ctx context.Context, cs *connState) {
	t := time.NewTicker(wsHeartbeatInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			pingCtx, cancel := context.WithTimeout(ctx, wsHeartbeatTimeout)
			err := cs.c.Ping(pingCtx)
			cancel()
			if err != nil {
				if s.Log != nil {
					s.Log.Warn("party ws heartbeat failed",
						slog.String("partyId", cs.partyId),
						slog.String("connId", cs.id),
						slog.Any("err", err),
					)
				}
				s.dropConn(cs, websocket.StatusPolicyViolation, "heartbeat failed")
				return
			}
		}
	}
}

func parseShards(raw string, shardCount int) []int {
	if shardCount <= 0 {
		return []int{0}
	}
	if strings.TrimSpace(raw) == "" {
		out := make([]int, shardCount)
		for i := 0; i < shardCount; i++ {
			out[i] = i
		}
		return out
	}
	// minimal: "0" or "0-3,5"
	seen := map[int]struct{}{}
	parts := strings.Split(raw, ",")
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if d := strings.Index(p, "-"); d > 0 {
			a, _ := parseInt(p[:d])
			b, _ := parseInt(p[d+1:])
			if a > b {
				a, b = b, a
			}
			for i := a; i <= b && i < shardCount; i++ {
				if i >= 0 {
					seen[i] = struct{}{}
				}
			}
			continue
		}
		n, _ := parseInt(p)
		if n >= 0 && n < shardCount {
			seen[n] = struct{}{}
		}
	}
	if len(seen) == 0 {
		out := make([]int, shardCount)
		for i := 0; i < shardCount; i++ {
			out[i] = i
		}
		return out
	}
	var out []int
	for i := 0; i < shardCount; i++ {
		if _, ok := seen[i]; ok {
			out = append(out, i)
		}
	}
	return out
}

func parseInt(s string) (int, error) {
	return strconv.Atoi(strings.TrimSpace(s))
}
