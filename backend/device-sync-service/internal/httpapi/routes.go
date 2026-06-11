package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/earflow/music-platform/device-sync-service/internal/auth"
	"github.com/earflow/music-platform/device-sync-service/internal/config"
	"github.com/earflow/music-platform/device-sync-service/internal/devices"
	"github.com/earflow/music-platform/device-sync-service/internal/observability"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/redis/go-redis/v9"
)

// Deps is the constructor input for New.
type Deps struct {
	Config     *config.Config
	Registry   *devices.Registry
	Redis      *redis.Client
	Logger     *slog.Logger
	Metrics    *observability.Metrics
	WSUpgrader http.Handler
}

// New returns the top-level chi router. /health & /metrics bypass both the
// feature gate and authentication so operators can always see liveness.
func New(d Deps) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RealIP)
	r.Use(requestID)
	r.Use(recoverer(d.Logger))
	r.Use(accessLog(d.Logger, d.Metrics))

	r.Use(securityHeaders(d.Config))
	r.Use(corsMiddleware(d.Config))

	// Ops endpoints — outside auth, outside feature gate.
	r.Get("/health", healthHandler(d))
	r.Get("/ready", readyHandler(d))
	r.Handle("/metrics", d.Metrics.Handler())

	// WebSocket mount — upgrade handler does its own auth (via ticket).
	r.Handle("/ws/devices", d.WSUpgrader)

	// REST API. A per-request deadline applies ONLY here — the WebSocket
	// mount above deliberately has no write deadline so idle sockets aren't
	// killed by the Go server between heartbeats. 15s is plenty for every
	// REST handler below (all of them are O(1) Redis ops).
	r.Route("/api/devices", func(sub chi.Router) {
		sub.Use(featureGate(d.Config))
		sub.Use(newHTTPRateLimiter(d.Config).middleware)
		sub.Use(middleware.Timeout(d.Config.HTTP.Write))
		sub.Use(authRequired(d.Config))

		sub.Post("/register", registerDevice(d))
		sub.Post("/heartbeat", heartbeat(d))
		sub.Delete("/{deviceId}", deleteDevice(d))
		sub.Get("/", listDevices(d))
		sub.Post("/transfer/{deviceId}", transfer(d))
		sub.Get("/transfer/status/{transferId}", transferStatus(d))
		sub.Put("/now-playing", putNowPlaying(d))
		sub.Get("/now-playing", getNowPlaying(d))
		sub.Post("/commands", sendCommand(d))
		sub.Post("/ws-ticket", issueTicket(d))
	})

	return r
}

// =============================================================================
// Handlers
// =============================================================================

type registerReq struct {
	Name         string                      `json:"name,omitempty"`
	Kind         string                      `json:"kind,omitempty"`
	ClientKey    string                      `json:"clientKey,omitempty"`
	Capabilities *devices.DeviceCapabilities `json:"capabilities,omitempty"`
}

func registerDevice(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := auth.FromContext(r.Context())
		var in registerReq
		if err := readJSON(r, 1024, &in); err != nil && !errors.Is(err, context.Canceled) {
			writeJSON(w, http.StatusBadRequest, errorBody("invalid json", "VALIDATION_ERROR"))
			return
		}
		params := devices.RegisterParams{
			UserID:       u.ID,
			Name:         in.Name,
			Kind:         in.Kind,
			UserAgent:    r.Header.Get("User-Agent"),
			IP:           clientIP(r),
			SessionID:    u.SessionID,
			ClientKey:    in.ClientKey,
			Capabilities: in.Capabilities,
		}
		dev, err := d.Registry.RegisterDevice(r.Context(), params)
		if err != nil {
			d.Logger.Warn("register failed", slog.Any("err", err))
			writeJSON(w, http.StatusBadRequest, errorBody(err.Error(), "REGISTER_FAILED"))
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{
			"device": map[string]any{
				"id":           dev.ID,
				"name":         dev.Name,
				"kind":         dev.Kind,
				"createdAt":    dev.CreatedAt,
				"lastSeenAt":   dev.LastSeenAt,
				"capabilities": dev.Capabilities,
			},
		})
	}
}

type heartbeatReq struct {
	DeviceID string `json:"deviceId"`
}

func heartbeat(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := auth.FromContext(r.Context())
		var in heartbeatReq
		if err := readJSON(r, 512, &in); err != nil {
			writeJSON(w, http.StatusBadRequest, errorBody("invalid json", "VALIDATION_ERROR"))
			return
		}
		did := strings.TrimSpace(in.DeviceID)
		if did == "" {
			writeJSON(w, http.StatusBadRequest, errorBody("deviceId required", "VALIDATION_ERROR"))
			return
		}
		dev, err := d.Registry.TouchDevice(r.Context(), did)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errorBody(err.Error(), "HEARTBEAT_FAILED"))
			return
		}
		if dev == nil || dev.UserID != u.ID {
			writeJSON(w, http.StatusNotFound, errorBody("device not found", "DEVICE_NOT_FOUND"))
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":         true,
			"lastSeenAt": dev.LastSeenAt,
		})
	}
}

func deleteDevice(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := auth.FromContext(r.Context())
		did := chi.URLParam(r, "deviceId")
		if did == "" {
			writeJSON(w, http.StatusBadRequest, errorBody("deviceId required", "VALIDATION_ERROR"))
			return
		}
		err := d.Registry.RemoveDevice(r.Context(), u.ID, did)
		switch {
		case errors.Is(err, devices.ErrDeviceNotFound):
			writeJSON(w, http.StatusNotFound, errorBody("device not found", "DEVICE_NOT_FOUND"))
			return
		case errors.Is(err, devices.ErrNotOwned):
			writeJSON(w, http.StatusForbidden, errorBody("not your device", "NOT_OWNED"))
			return
		case err != nil:
			writeJSON(w, http.StatusInternalServerError, errorBody(err.Error(), "REMOVE_FAILED"))
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func listDevices(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := auth.FromContext(r.Context())
		playerState, err := d.Registry.GetPlayerState(r.Context(), u.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errorBody(err.Error(), "LIST_FAILED"))
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"devices":        playerState.Devices,
			"nowPlaying":     playerState.NowPlaying,
			"timeline":       playerState.Timeline,
			"lease":          playerState.Lease,
			"transfer":       playerState.Transfer,
			"activeRevision": playerState.ActiveRevision,
			"activeDeviceId": playerState.ActiveDeviceID,
			"volumeByDevice": playerState.VolumeByDevice,
			"playerState":    playerState,
		})
	}
}

func transfer(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := auth.FromContext(r.Context())
		did := chi.URLParam(r, "deviceId")
		var in struct {
			Resume *bool `json:"resume,omitempty"`
		}
		if r.Body != nil && r.ContentLength != 0 {
			if err := readJSON(r, 256, &in); err != nil {
				writeJSON(w, http.StatusBadRequest, errorBody("invalid json", "VALIDATION_ERROR"))
				return
			}
		}
		idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
		prev, activeRevision, transferRecord, err := d.Registry.StartTransfer(r.Context(), u.ID, did, in.Resume, idempotencyKey)
		if err != nil && d.Metrics != nil {
			d.Metrics.TransferFailed.Inc()
		}
		switch {
		case errors.Is(err, devices.ErrDeviceNotFound):
			writeJSON(w, http.StatusNotFound, errorBody("device not found", "DEVICE_NOT_FOUND"))
			return
		case errors.Is(err, devices.ErrNotOwned):
			writeJSON(w, http.StatusForbidden, errorBody("not your device", "NOT_OWNED"))
			return
		case err != nil:
			writeJSON(w, http.StatusInternalServerError, errorBody(err.Error(), "TRANSFER_FAILED"))
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":               true,
			"activeDeviceId":   did,
			"previousActiveId": prev,
			"activeRevision":   activeRevision,
			"transferId":       transferRecord.TransferID,
			"transfer":         transferRecord,
		})
	}
}

func transferStatus(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := auth.FromContext(r.Context())
		transferID := chi.URLParam(r, "transferId")
		transferRecord, err := d.Registry.GetTransfer(r.Context(), transferID)
		switch {
		case errors.Is(err, devices.ErrDeviceNotFound):
			writeJSON(w, http.StatusNotFound, errorBody("transfer not found", "TRANSFER_NOT_FOUND"))
			return
		case err != nil:
			writeJSON(w, http.StatusInternalServerError, errorBody(err.Error(), "TRANSFER_STATUS_FAILED"))
			return
		case transferRecord.UserID != u.ID:
			writeJSON(w, http.StatusForbidden, errorBody("not your transfer", "NOT_OWNED"))
			return
		default:
			writeJSON(w, http.StatusOK, map[string]any{"transfer": transferRecord})
		}
	}
}

type nowPlayingReq struct {
	devices.NowPlaying
}

func putNowPlaying(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := auth.FromContext(r.Context())
		var in nowPlayingReq
		if err := readJSON(r, 4096, &in); err != nil {
			writeJSON(w, http.StatusBadRequest, errorBody("invalid json", "VALIDATION_ERROR"))
			return
		}
		result, err := d.Registry.PutNowPlaying(r.Context(), u.ID, &in.NowPlaying)
		switch {
		case errors.Is(err, devices.ErrInvalidDeviceID):
			writeJSON(w, http.StatusBadRequest, errorBody("deviceId required", "VALIDATION_ERROR"))
			return
		case errors.Is(err, devices.ErrDeviceNotFound):
			writeJSON(w, http.StatusNotFound, errorBody("device not found", "DEVICE_NOT_FOUND"))
			return
		case errors.Is(err, devices.ErrNotOwned):
			writeJSON(w, http.StatusForbidden, errorBody("not your device", "NOT_OWNED"))
			return
		case errors.Is(err, devices.ErrNotActiveDevice):
			writeJSON(w, http.StatusForbidden, errorBody("not active device", "NOT_ACTIVE"))
			return
		case err != nil:
			writeJSON(w, http.StatusInternalServerError, errorBody(err.Error(), "NP_FAILED"))
			return
		}
		writeJSON(w, http.StatusOK, result)
	}
}

func getNowPlaying(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := auth.FromContext(r.Context())
		np, err := d.Registry.GetNowPlaying(r.Context(), u.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errorBody(err.Error(), "NP_FAILED"))
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"nowPlaying": np})
	}
}

type cmdReq struct {
	FromDeviceID   string                 `json:"fromDeviceId"`
	To             string                 `json:"to,omitempty"`
	Cmd            string                 `json:"cmd"`
	Payload        map[string]interface{} `json:"payload,omitempty"`
	ActiveRevision int64                  `json:"activeRevision,omitempty"`
}

func sendCommand(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := auth.FromContext(r.Context())
		var in cmdReq
		if err := readJSON(r, int64(d.Config.Device.MaxCommandPayloadBytes+1024), &in); err != nil {
			writeJSON(w, http.StatusBadRequest, errorBody("invalid json", "VALIDATION_ERROR"))
			return
		}
		// Defence-in-depth: ensure `from` belongs to the caller.
		dev, err := d.Registry.TouchDevice(r.Context(), in.FromDeviceID)
		if err != nil || dev == nil || dev.UserID != u.ID {
			writeJSON(w, http.StatusForbidden, errorBody("not your device", "NOT_OWNED"))
			return
		}
		err = d.Registry.SendCommand(r.Context(), u.ID, in.FromDeviceID, in.To, in.Cmd, in.Payload, in.ActiveRevision)
		switch {
		case errors.Is(err, devices.ErrDeviceNotFound):
			writeJSON(w, http.StatusNotFound, errorBody("device not found", "DEVICE_NOT_FOUND"))
		case errors.Is(err, devices.ErrUnknownCommand):
			writeJSON(w, http.StatusBadRequest, errorBody("unknown command", "UNKNOWN_COMMAND"))
		case errors.Is(err, devices.ErrInvalidCommandPayload):
			writeJSON(w, http.StatusBadRequest, errorBody("invalid command payload", "VALIDATION_ERROR"))
		case errors.Is(err, devices.ErrPayloadTooLarge):
			writeJSON(w, http.StatusRequestEntityTooLarge, errorBody("payload too large", "PAYLOAD_TOO_LARGE"))
		case errors.Is(err, devices.ErrStaleRevision):
			writeJSON(w, http.StatusConflict, errorBody("stale active revision", "STALE_REVISION"))
		case errors.Is(err, devices.ErrNotActiveDevice):
			writeJSON(w, http.StatusConflict, errorBody("target is not active device", "NOT_ACTIVE"))
		case err != nil:
			writeJSON(w, http.StatusInternalServerError, errorBody(err.Error(), "COMMAND_FAILED"))
		default:
			writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		}
	}
}

type ticketReq struct {
	DeviceID string `json:"deviceId"`
}

func issueTicket(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := auth.FromContext(r.Context())
		var in ticketReq
		if err := readJSON(r, 512, &in); err != nil {
			writeJSON(w, http.StatusBadRequest, errorBody("invalid json", "VALIDATION_ERROR"))
			return
		}
		did := strings.TrimSpace(in.DeviceID)
		if did == "" {
			writeJSON(w, http.StatusBadRequest, errorBody("deviceId required", "VALIDATION_ERROR"))
			return
		}
		dev, err := d.Registry.TouchDevice(r.Context(), did)
		if err != nil || dev == nil || dev.UserID != u.ID {
			writeJSON(w, http.StatusForbidden, errorBody("not your device", "NOT_OWNED"))
			return
		}
		ticket, err := auth.CreateTicket(d.Config, u.ID, did, u.Username)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errorBody(err.Error(), "TICKET_FAILED"))
			return
		}
		writeJSON(w, http.StatusOK, ticket)
	}
}

// =============================================================================
// Ops endpoints
// =============================================================================

func healthHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Liveness: always 200 while the process is alive. Readiness is a
		// separate endpoint.
		writeJSON(w, http.StatusOK, map[string]any{
			"status":    "ok",
			"enabled":   d.Config.Enabled,
			"instance":  d.Config.Instance,
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
	}
}

func readyHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		pong, err := d.Redis.Ping(ctx).Result()
		if err != nil || pong != "PONG" {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{
				"status": "not_ready",
				"redis":  err,
			})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": "ready"})
	}
}

// =============================================================================
// Security headers + CORS
// =============================================================================

func securityHeaders(cfg *config.Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("X-Frame-Options", "DENY")
			w.Header().Set("Referrer-Policy", "no-referrer")
			if cfg.IsProd {
				w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
			}
			next.ServeHTTP(w, r)
		})
	}
}

func corsMiddleware(cfg *config.Config) func(http.Handler) http.Handler {
	return cors.Handler(cors.Options{
		AllowedOrigins:   cfg.HTTP.AllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type", "Authorization", "X-CSRF-Token", "X-Request-Id"},
		ExposedHeaders:   []string{"X-Request-Id"},
		AllowCredentials: true,
		MaxAge:           86400,
	})
}
