package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/earflow/music-platform/go-api-gateway/internal/config"
	"github.com/redis/go-redis/v9"
)

// TestRotationDeferredUntilDeviceProofPasses locks the H-1 invariant: on a
// proof-required request, refresh rotation must NOT happen before the device
// proof is validated. A stolen mp_sid cookie alone (no device key) must produce
// 401 WITHOUT touching the session's refresh token.
func TestRotationDeferredUntilDeviceProofPasses(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	sid := "sid_h1_12345678901234567890"
	authDeviceID := "adev_h1_1234567890123456789"

	var rotateCalls atomic.Int32
	authServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		rotateCalls.Add(1)
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer authServer.Close()

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	secret := "test-secret-test-secret-test-secret-32"
	// Access token deliberately invalid so SessionAuth WOULD rotate if it ran first.
	sessJSON := marshalSessionForTest(t, Session{
		AccessToken:  "expired",
		RefreshToken: "old-refresh",
		User:         json.RawMessage(`{"id":1}`),
	})
	mr.Set("mp:sess:"+sid, sessJSON)
	rec := AuthDeviceRecord{
		AuthDeviceID:  authDeviceID,
		SID:           sid,
		UserID:        1,
		PublicKeySPKI: "unused",
		CreatedAt:     "2026-08-15T00:00:00Z",
		LastSeenAt:    "2026-08-15T00:00:00Z",
	}
	b, _ := json.Marshal(rec)
	mr.Set(authDeviceKey(authDeviceID), string(b))
	mr.SAdd(authSidDevicesKey(sid), authDeviceID)

	manager := &SessionManager{
		store:                &SessionStore{rdb: redisSessionKV{rdb: rdb}, keyPrefix: "mp:sess:", ttl: time.Hour},
		devices:              NewAuthDeviceStore(rdb, time.Hour),
		rdb:                  rdb,
		gatewaySessionPrefix: "mp:sess:",
		jwtSecret:            secret,
		cookie:               config.CookieConfig{Domain: ".earflow.ru", SameSite: "none", Secure: true},
		cookieNames:          testMainCookieNames(),
		authBaseURL:          authServer.URL,
		allowedOrigins:       map[string]struct{}{"https://earflow.ru": {}},
		sessionTTL:           time.Hour,
		isProduction:         true,
	}

	// Prod order (H-1): DeviceProof OUTER, SessionAuth inner.
	chain := manager.DeviceProofMiddleware()(
		manager.SessionAuthMiddleware()(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		})),
	)

	req := httptest.NewRequest(http.MethodGet, "/api/profile", nil)
	req.Header.Set("Origin", "https://earflow.ru")
	req.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
	w := httptest.NewRecorder()
	chain.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 without device proof", w.Code)
	}
	if rotateCalls.Load() != 0 {
		t.Fatalf("refresh upstream called %d times before proof; rotation must be deferred (H-1)", rotateCalls.Load())
	}
	raw, err := mr.Get("mp:sess:" + sid)
	if err != nil {
		t.Fatal(err)
	}
	var sess Session
	if err := json.Unmarshal([]byte(raw), &sess); err != nil {
		t.Fatal(err)
	}
	if sess.RefreshToken != "old-refresh" {
		t.Fatalf("refresh token rotated to %q before proof validated (H-1)", sess.RefreshToken)
	}
}

// TestRotationDeferredStillAllowsProofPassedRequests: with a valid proof the
// same chain proceeds and the expired access token triggers a rotation attempt.
func TestRotationDeferredStillAllowsProofPassedRequests(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	sid := "sid_h1b_1234567890123456789"
	authDeviceID := "adev_h1b_12345678901234567"
	priv, pub := generateTestECDSAKeyPair(t)

	var rotateCalls atomic.Int32
	authServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		rotateCalls.Add(1)
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer authServer.Close()

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	secret := "test-secret-test-secret-test-secret-32"
	sessJSON := marshalSessionForTest(t, Session{
		AccessToken:  "expired",
		RefreshToken: "old-refresh",
		User:         json.RawMessage(`{"id":1}`),
	})
	mr.Set("mp:sess:"+sid, sessJSON)
	rec := AuthDeviceRecord{
		AuthDeviceID:  authDeviceID,
		SID:           sid,
		UserID:        1,
		PublicKeySPKI: pub,
		CreatedAt:     "2026-08-15T00:00:00Z",
		LastSeenAt:    "2026-08-15T00:00:00Z",
	}
	b, _ := json.Marshal(rec)
	mr.Set(authDeviceKey(authDeviceID), string(b))
	mr.SAdd(authSidDevicesKey(sid), authDeviceID)

	manager := &SessionManager{
		store:                &SessionStore{rdb: redisSessionKV{rdb: rdb}, keyPrefix: "mp:sess:", ttl: time.Hour},
		devices:              NewAuthDeviceStore(rdb, time.Hour),
		rdb:                  rdb,
		gatewaySessionPrefix: "mp:sess:",
		jwtSecret:            secret,
		cookie:               config.CookieConfig{Domain: ".earflow.ru", SameSite: "none", Secure: true},
		cookieNames:          testMainCookieNames(),
		authBaseURL:          authServer.URL,
		allowedOrigins:       map[string]struct{}{"https://earflow.ru": {}},
		sessionTTL:           time.Hour,
		isProduction:         true,
	}

	chain := manager.DeviceProofMiddleware()(
		manager.SessionAuthMiddleware()(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		})),
	)

	ts := strconv.FormatInt(time.Now().Unix(), 10)
	nonce := "nonce-h1b-01"
	canonical := buildCanonicalProofString(http.MethodGet, "/api/profile", nil, ts, nonce, sidHashForProof(secret, sid))
	proof := signCanonicalTest(t, priv, canonical)

	req := httptest.NewRequest(http.MethodGet, "/api/profile", nil)
	req.Header.Set("Origin", "https://earflow.ru")
	req.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
	req.Header.Set(headerAuthDeviceID, authDeviceID)
	req.Header.Set(headerAuthDeviceProof, proof)
	req.Header.Set(headerAuthDeviceTs, ts)
	req.Header.Set(headerAuthDeviceNonce, nonce)
	w := httptest.NewRecorder()
	chain.ServeHTTP(w, req)

	// Proof passes -> SessionAuth runs -> access token invalid -> rotation attempted.
	if rotateCalls.Load() == 0 {
		t.Fatalf("refresh upstream not called after valid proof; expected rotation attempt")
	}
}
