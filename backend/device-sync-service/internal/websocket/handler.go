package websocket

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	ws "github.com/coder/websocket"
	"github.com/earflow/music-platform/device-sync-service/internal/auth"
	"github.com/earflow/music-platform/device-sync-service/internal/config"
	"github.com/earflow/music-platform/device-sync-service/internal/streamticket"
)

// UpgradeHandler builds the http.HandlerFunc mounted at /ws/devices.
// Expects the ticket in ?ticket=… and a TLS-terminated (or local) origin.
type UpgradeHandler struct {
	Config  *config.Config
	Manager *Manager
	Deps    ClientDeps
	Logger  *slog.Logger
	Tickets *streamticket.Verifier
}

func (h *UpgradeHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !h.Config.Enabled {
		http.Error(w, "feature disabled", http.StatusServiceUnavailable)
		return
	}

	lookupCtx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	ticket := r.URL.Query().Get("ticket")
	var claims *auth.TicketClaims
	var err error
	if h.Tickets != nil {
		claims, err = h.Tickets.VerifyUpgradeTicket(lookupCtx, h.Config, ticket)
	} else {
		claims, err = auth.VerifyTicket(h.Config, ticket)
	}
	if err != nil {
		// SEC-005 diagnostics: classify the reject without leaking the ticket.
		ticketLen := len(ticket)
		jwtLike := strings.Count(ticket, ".") == 2
		verifierOn := h.Tickets != nil
		acceptOn := false
		enforceOn := false
		if verifierOn {
			acceptOn = h.Tickets.AcceptEnabled()
			enforceOn = h.Tickets.EnforceEnabled()
		}
		h.Logger.Warn("ws upgrade ticket rejected",
			slog.Any("err", err),
			slog.Int("ticket_len", ticketLen),
			slog.Bool("jwt_like", jwtLike),
			slog.Bool("verifier_configured", verifierOn),
			slog.Bool("accept", acceptOn),
			slog.Bool("enforce", enforceOn),
		)
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// Cross-check the ticket against Redis: the device must still exist and
	// belong to the claimed user. Prevents replay of a ticket whose device
	// has since been revoked (1 HGETALL).
	dev, err := h.Deps.Registry.TouchDevice(lookupCtx, claims.DeviceID)
	if err != nil || dev == nil || dev.UserID != claims.UserID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	// Accept. IMPORTANT: coder/websocket matches Origin against url.Parse().Host
	// (bare hostname, possibly with port). So we use AllowedOriginHosts here
	// — full URLs like "https://earflow.ru" would never match and the upgrade
	// would 403 before the socket even opens.
	h.Logger.Debug("ws handshake (pre-accept)",
		slog.String("origin", r.Header.Get("Origin")),
		slog.String("referer", r.Header.Get("Referer")),
		slog.String("host", r.Host),
		slog.String("deviceId", claims.DeviceID),
	)
	conn, err := ws.Accept(w, r, &ws.AcceptOptions{
		OriginPatterns:     h.Config.HTTP.AllowedOriginHosts,
		InsecureSkipVerify: len(h.Config.HTTP.AllowedOriginHosts) == 0,
	})
	if err != nil {
		h.Logger.Warn("ws accept failed",
			slog.String("origin", r.Header.Get("Origin")),
			slog.String("referer", r.Header.Get("Referer")),
			slog.String("host", r.Host),
			slog.Any("err", err),
		)
		return
	}

	// Attach and register with the hub. The hub pointer is assigned AFTER
	// registerAndReturn so Client.Run has a valid back-reference when it
	// tries to unregister on close.
	// Do not use r.Context() as the parent: ServeHTTP returns right after
	// Accept+go Run(), and the server may cancel the request context, which
	// breaks sendInit (Redis/Write) with "context canceled" while the
	// WebSocket is still open.
	c := Attach(context.WithoutCancel(r.Context()), conn, claims.UserID, claims.Username, claims.DeviceID, h.Deps, nil)
	hub := h.Manager.registerAndReturn(c)
	c.hub = hub

	go c.Run()
}

// registerAndReturn is a small helper on Manager to avoid leaking the hub
// pointer through Register().
func (mgr *Manager) registerAndReturn(c *Client) *Hub {
	mgr.mu.Lock()
	hub, ok := mgr.hubs[c.UserID]
	if !ok {
		hub = newHub(mgr, c.UserID)
		mgr.hubs[c.UserID] = hub
		go hub.run(context.Background())
	}
	mgr.mu.Unlock()
	hub.register <- c
	return hub
}
