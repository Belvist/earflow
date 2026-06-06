// Package websocket implements the per-user Hub pattern that fans Redis
// Pub/Sub events out to every live socket of the same user.
//
// Concurrency contract
// --------------------
//
//	Manager.Register/Unregister are concurrency-safe.
//	A Hub owns its `clients` map and its Redis subscription goroutine.
//	Hub.run is the ONLY goroutine that mutates `clients` → no mutex in hot path.
//
// Back-pressure
// -------------
//
//	Every Client has a bounded outbound channel. If the writer goroutine cannot
//	drain it before the next broadcast, we drop the client (close the socket)
//	instead of growing memory. This is the standard gorilla-websocket contract
//	and the right thing for "music-playing, timing-sensitive" peers.
package websocket

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/earflow/music-platform/device-sync-service/internal/devices"
	"github.com/earflow/music-platform/device-sync-service/internal/observability"
	"github.com/redis/go-redis/v9"
)

// Manager owns all per-user hubs. One per process.
type Manager struct {
	mu        sync.Mutex
	hubs      map[string]*Hub
	rdb       *redis.Client
	registry  *devices.Registry
	log       *slog.Logger
	m         *observability.Metrics
}

// NewManager wires dependencies. Call Close() on shutdown.
func NewManager(rdb *redis.Client, reg *devices.Registry, log *slog.Logger, m *observability.Metrics) *Manager {
	return &Manager{
		hubs:     make(map[string]*Hub, 1024),
		rdb:      rdb,
		registry: reg,
		log:      log,
		m:        m,
	}
}

// Register attaches a client to the hub for its user, creating the hub (and
// its Redis subscription) lazily.
func (mgr *Manager) Register(ctx context.Context, c *Client) {
	mgr.mu.Lock()
	hub, ok := mgr.hubs[c.UserID]
	if !ok {
		hub = newHub(mgr, c.UserID)
		mgr.hubs[c.UserID] = hub
		go hub.run(context.Background()) // shutdown via close(hub.done)
	}
	mgr.mu.Unlock()
	hub.register <- c
}

// unregister is called from the Hub itself once a client drains. If the hub
// becomes empty it shuts down and releases its subscription.
func (mgr *Manager) unregister(hub *Hub) {
	mgr.mu.Lock()
	if cur, ok := mgr.hubs[hub.userID]; ok && cur == hub {
		delete(mgr.hubs, hub.userID)
	}
	mgr.mu.Unlock()
	close(hub.done)
}

// Close drains all hubs on shutdown. Sockets are closed with code 1012.
func (mgr *Manager) Close() {
	mgr.mu.Lock()
	hubs := make([]*Hub, 0, len(mgr.hubs))
	for _, h := range mgr.hubs {
		hubs = append(hubs, h)
	}
	mgr.mu.Unlock()
	for _, h := range hubs {
		h.closeAll()
	}
}

// =============================================================================
// Hub: one instance per active user. run() owns clients and the sub goroutine.
// =============================================================================

type Hub struct {
	userID     string
	mgr        *Manager
	register   chan *Client
	unregister chan *Client
	done       chan struct{}
	shutdown   chan struct{}
	size       atomic.Int32
}

func newHub(mgr *Manager, userID string) *Hub {
	return &Hub{
		userID:     userID,
		mgr:        mgr,
		register:   make(chan *Client, 16),
		unregister: make(chan *Client, 16),
		done:       make(chan struct{}),
		shutdown:   make(chan struct{}),
	}
}

func (h *Hub) run(ctx context.Context) {
	clients := make(map[*Client]struct{}, 8)

	// Run Redis SUBSCRIBE in a dedicated goroutine and forward messages to a
	// channel. If Subscribe or the pubsub client blocked on the same stack as
	// the select below, a slow/dropped Redis would prevent `hub.register` from
	// being read — the WebSocket upgrader would stay blocked, the client would
	// get no `init` frame, and the browser would close with "connection
	// established" errors.
	eventsCh := make(chan *redis.Message, 512)
	innerCtx, innerCancel := context.WithCancel(ctx)
	defer innerCancel()

	go func() {
		defer close(eventsCh)
		chName := h.mgr.registry.UserChannel(h.userID)
		pubsub := h.mgr.rdb.Subscribe(innerCtx, chName)
		defer func() { _ = pubsub.Close() }()
		subCh := pubsub.Channel(redis.WithChannelSize(512))
		for {
			select {
			case <-innerCtx.Done():
				return
			case msg, ok := <-subCh:
				if !ok {
					return
				}
				if msg == nil {
					continue
				}
				select {
				case eventsCh <- msg:
				case <-innerCtx.Done():
					return
				}
			}
		}
	}()

	for {
		select {
		case <-h.shutdown:
			innerCancel()
			for c := range clients {
				c.CloseWithCode(1012, "server shutdown")
			}
			h.mgr.unregister(h)
			return

		case c := <-h.register:
			clients[c] = struct{}{}
			h.size.Store(int32(len(clients)))
			if h.mgr.m != nil {
				h.mgr.m.WSConnections.Inc()
			}

		case c := <-h.unregister:
			if _, ok := clients[c]; ok {
				delete(clients, c)
				h.size.Store(int32(len(clients)))
				if h.mgr.m != nil {
					h.mgr.m.WSConnections.Dec()
				}
			}
			if len(clients) == 0 {
				innerCancel()
				h.mgr.unregister(h)
				return
			}

		case msg, ok := <-eventsCh:
			if !ok {
				for c := range clients {
					c.CloseWithCode(1011, "subscription lost")
				}
				h.mgr.unregister(h)
				return
			}
			h.fanout(clients, msg.Payload)
		}
	}
}

// fanout is the ONLY server-side routing point. If the event is a directed
// `cmd`, it reaches exactly one socket; everything else broadcasts.
func (h *Hub) fanout(clients map[*Client]struct{}, payload string) {
	var event struct {
		Type string  `json:"type"`
		To   *string `json:"to,omitempty"`
	}
	if err := json.Unmarshal([]byte(payload), &event); err != nil {
		return
	}

	var directedTo string
	if event.Type == "cmd" && event.To != nil {
		directedTo = *event.To
	}
	data := []byte(payload)
	for c := range clients {
		if directedTo != "" && c.DeviceID != directedTo {
			continue
		}
		// Try non-blocking send; if the client cannot keep up, kill it.
		select {
		case c.out <- data:
		default:
			h.mgr.log.Warn("slow consumer, closing",
				slog.String("userId", h.userID),
				slog.String("deviceId", c.DeviceID),
			)
			c.CloseWithCode(1013, "slow consumer")
			if h.mgr.m != nil {
				h.mgr.m.WSErrors.WithLabelValues("slow_consumer").Inc()
			}
		}
	}
}

// closeAll is used at global shutdown.
func (h *Hub) closeAll() {
	select {
	case <-h.shutdown:
		// already closing
	default:
		close(h.shutdown)
	}
	// Wait a bounded time for the hub loop to exit.
	select {
	case <-h.done:
	case <-time.After(5 * time.Second):
	}
}
