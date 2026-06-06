//go:build pop_e2e_harness

package auth

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/earflow/music-platform/go-api-gateway/internal/config"
	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
)

//go:embed pop_e2e_fixture.html
var popE2EFixtureHTML []byte

const (
	popE2EDefaultPort = 39201
	popE2EJWTSecret    = "pop-e2e-secret-pop-e2e-secret-32b"
	popE2EUserID      = int64(901)
)

// PopE2EHarness serves a real SessionAuth + DeviceProof stack for browser e2e (miniredis, isProduction=true).
type PopE2EHarness struct {
	Server  *http.Server
	Manager *SessionManager
	MiniRedis *miniredis.Miniredis
	BaseURL string
}

// StartPopE2EHarness listens on POP_E2E_PORT (default 39201). No cookie-only bypass env is read.
func StartPopE2EHarness(ctx context.Context) (*PopE2EHarness, error) {
	port := popE2EDefaultPort
	if raw := os.Getenv("POP_E2E_PORT"); raw != "" {
		if p, err := strconv.Atoi(raw); err == nil && p > 0 {
			port = p
		}
	}

	mr, err := miniredis.Run()
	if err != nil {
		return nil, err
	}

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	baseURL := fmt.Sprintf("http://127.0.0.1:%d", port)

	manager, err := NewSessionManager(SessionManagerConfig{
		Redis:       rdb,
		JWTSecret:   popE2EJWTSecret,
		JWTIssuer:   "earflow-pop-e2e",
		JWTAudience: "earflow-listener",
		Cookie: config.CookieConfig{
			Secure:   false,
			SameSite: "Lax",
		},
		CookieNames: config.CookieNamesConfig{
			Auth: "mp_auth", Refresh: "mp_refresh", SID: "mp_sid", CSRF: "mp_csrf",
		},
		SessionTTL:     time.Hour,
		AllowedOrigins: []string{baseURL},
		IsProduction:   true,
	})
	if err != nil {
		mr.Close()
		return nil, err
	}

	h := &PopE2EHarness{
		Manager:   manager,
		MiniRedis: mr,
		BaseURL:   baseURL,
	}

	r := chi.NewRouter()
	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","harness":"pop-e2e","popEnforced":true}`))
	})
	r.Get("/e2e/fixture.html", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(popE2EFixtureHTML)
	})
	r.Post("/e2e/seed-session", h.handleSeedSession)

	r.Group(func(api chi.Router) {
		api.Use(manager.SessionAuthMiddleware())
		api.Use(manager.DeviceProofMiddleware())
		api.Use(manager.CSRFEnsureCookieMiddleware())
		manager.MountRoutes(api)
	})

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		mr.Close()
		return nil, err
	}

	h.Server = &http.Server{
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		_ = h.Server.Serve(ln)
	}()

	if ctx != nil {
		go func() {
			<-ctx.Done()
			_ = h.Close()
		}()
	}

	return h, nil
}

func (h *PopE2EHarness) Close() error {
	if h.Server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = h.Server.Shutdown(ctx)
	}
	if h.MiniRedis != nil {
		h.MiniRedis.Close()
	}
	return nil
}

func (h *PopE2EHarness) handleSeedSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	sid, err := newSID()
	if err != nil {
		http.Error(w, "sid", http.StatusInternalServerError)
		return
	}
	userJSON := fmt.Sprintf(`{"id":%d,"userId":%d,"username":"pop-e2e-user"}`, popE2EUserID, popE2EUserID)
	access := popE2EMintAccessJWT(popE2EUserID)
	sess := Session{
		AccessToken:  access,
		RefreshToken: "refresh-pop-e2e-token",
		User:         json.RawMessage(userJSON),
		CreatedAt:    time.Now().UTC().Format(time.RFC3339),
		UpdatedAt:    time.Now().UTC().Format(time.RFC3339),
	}
	if err := h.Manager.store.Set(r.Context(), sid, sess); err != nil {
		http.Error(w, "store", http.StatusInternalServerError)
		return
	}
	csrf, err := GenerateCSRFToken(sid, popE2EJWTSecret)
	if err != nil {
		http.Error(w, "csrf", http.StatusInternalServerError)
		return
	}
	SetSessionCookies(w, config.CookieConfig{Secure: false, SameSite: "Lax"},
		config.CookieNamesConfig{SID: "mp_sid", CSRF: "mp_csrf"}, sid, csrf, 3600)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "sid": sid})
}

func popE2EMintAccessJWT(userID int64) string {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"type":   "access",
		"userId": strconv.FormatInt(userID, 10),
		"iss":    "earflow-pop-e2e",
		"aud":    "earflow-listener",
		"exp":    time.Now().Add(time.Hour).Unix(),
	})
	signed, _ := token.SignedString([]byte(popE2EJWTSecret))
	return signed
}
