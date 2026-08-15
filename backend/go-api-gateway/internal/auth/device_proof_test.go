package auth

import (
	"context"
	"crypto/ecdsa"
	"encoding/json"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/asn1"
	"encoding/base64"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func generateTestECDSAKeyPair(t *testing.T) (*ecdsa.PrivateKey, string) {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("GenerateKey: %v", err)
	}
	spki, err := x509.MarshalPKIXPublicKey(&priv.PublicKey)
	if err != nil {
		t.Fatalf("MarshalPKIXPublicKey: %v", err)
	}
	return priv, base64.RawURLEncoding.EncodeToString(spki)
}

func signCanonicalTest(t *testing.T, priv *ecdsa.PrivateKey, canonical string) string {
	t.Helper()
	digest := sha256.Sum256([]byte(canonical))
	r, s, err := ecdsa.Sign(rand.Reader, priv, digest[:])
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	sigDER, err := asn1.Marshal(struct {
		R, S *big.Int
	}{R: r, S: s})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	return base64.RawURLEncoding.EncodeToString(sigDER)
}

func signCanonicalP1363Test(t *testing.T, priv *ecdsa.PrivateKey, canonical string) string {
	t.Helper()
	digest := sha256.Sum256([]byte(canonical))
	r, s, err := ecdsa.Sign(rand.Reader, priv, digest[:])
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	rBytes := r.Bytes()
	sBytes := s.Bytes()
	p1363 := make([]byte, 64)
	copy(p1363[32-len(rBytes):32], rBytes)
	copy(p1363[64-len(sBytes):64], sBytes)
	return base64.RawURLEncoding.EncodeToString(p1363)
}

func newProofTestManager(t *testing.T, mr *miniredis.Miniredis, sid, authDeviceID, pubSPKI string, userID int64) *SessionManager {
	t.Helper()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	secret := "test-secret-test-secret-test-secret-32"
	access := makeAccessTokenForTest(t, secret, strconv.FormatInt(userID, 10))
	sessJSON := marshalSessionForTest(t, Session{
		AccessToken:  access,
		RefreshToken: "refresh",
		User:         json.RawMessage(`{"id":` + strconv.FormatInt(userID, 10) + `}`),
	})
	mr.Set("mp:sess:"+sid, sessJSON)
	rec := AuthDeviceRecord{
		AuthDeviceID:  authDeviceID,
		SID:           sid,
		UserID:        userID,
		PublicKeySPKI: pubSPKI,
		CreatedAt:     time.Now().UTC().Format(time.RFC3339),
		LastSeenAt:    time.Now().UTC().Format(time.RFC3339),
	}
	b, _ := json.Marshal(rec)
	mr.Set(authDeviceKey(authDeviceID), string(b))
	mr.SAdd(authSidDevicesKey(sid), authDeviceID)

	return &SessionManager{
		store:                &SessionStore{rdb: redisSessionKV{rdb: rdb}, keyPrefix: "mp:sess:", ttl: time.Hour},
		devices:              NewAuthDeviceStore(rdb, time.Hour),
		rdb:                  rdb,
		gatewaySessionPrefix: "mp:sess:",
		jwtSecret:            secret,
		cookieNames:          testMainCookieNames(),
		sessionTTL:           time.Hour,
		isProduction:         true,
	}
}

func TestProfileRequiresDeviceProof(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	sid := "sid_12345678901234567890"
	authDeviceID := "adev_1234567890123456789"
	priv, pub := generateTestECDSAKeyPair(t)
	manager := newProofTestManager(t, mr, sid, authDeviceID, pub, 9)

	req := httptest.NewRequest(http.MethodGet, "/api/profile", nil)
	req.Header.Set("Origin", "https://earflow.ru")
	req.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
	w := httptest.NewRecorder()
	handler := manager.DeviceProofMiddleware()(manager.SessionAuthMiddleware()(http.HandlerFunc(manager.handleProfile())))
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
	var body apiError
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body.Code != authCodeDeviceProofReq {
		t.Fatalf("code = %q, want %q", body.Code, authCodeDeviceProofReq)
	}

	ts := strconv.FormatInt(time.Now().Unix(), 10)
	nonce := "nonce-proof-test-01"
	canonical := buildCanonicalProofString(http.MethodGet, "/api/profile", nil, ts, nonce, sidHashForProof(manager.jwtSecret, sid))
	proof := signCanonicalTest(t, priv, canonical)

	req2 := httptest.NewRequest(http.MethodGet, "/api/profile", nil)
	req2.Header.Set("Origin", "https://earflow.ru")
	req2.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
	req2.Header.Set(headerAuthDeviceID, authDeviceID)
	req2.Header.Set(headerAuthDeviceProof, proof)
	req2.Header.Set(headerAuthDeviceTs, ts)
	req2.Header.Set(headerAuthDeviceNonce, nonce)
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("signed profile status = %d, want 200", w2.Code)
	}
}

func TestDeviceProofReplayRejected(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	sid := "sid_12345678901234567890"
	authDeviceID := "adev_1234567890123456789"
	priv, pub := generateTestECDSAKeyPair(t)
	manager := newProofTestManager(t, mr, sid, authDeviceID, pub, 3)

	ts := strconv.FormatInt(time.Now().Unix(), 10)
	nonce := "nonce-replay-once-xyz"
	canonical := buildCanonicalProofString(http.MethodGet, "/api/profile", nil, ts, nonce, sidHashForProof(manager.jwtSecret, sid))
	proof := signCanonicalTest(t, priv, canonical)

	serve := func() int {
		req := httptest.NewRequest(http.MethodGet, "/api/profile", nil)
		req.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
		req.Header.Set(headerAuthDeviceID, authDeviceID)
		req.Header.Set(headerAuthDeviceProof, proof)
		req.Header.Set(headerAuthDeviceTs, ts)
		req.Header.Set(headerAuthDeviceNonce, nonce)
		w := httptest.NewRecorder()
		h := manager.SessionAuthMiddleware()(manager.DeviceProofMiddleware()(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})))
		h.ServeHTTP(w, req)
		return w.Code
	}
	if serve() != http.StatusOK {
		t.Fatalf("first request should pass")
	}
	w2 := httptest.NewRequest(http.MethodGet, "/api/profile", nil)
	w2rec := httptest.NewRecorder()
	req := w2
	req.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
	req.Header.Set(headerAuthDeviceID, authDeviceID)
	req.Header.Set(headerAuthDeviceProof, proof)
	req.Header.Set(headerAuthDeviceTs, ts)
	req.Header.Set(headerAuthDeviceNonce, nonce)
	h := manager.SessionAuthMiddleware()(manager.DeviceProofMiddleware()(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})))
	h.ServeHTTP(w2rec, req)
	if w2rec.Code != http.StatusForbidden {
		t.Fatalf("replay status = %d, want 403", w2rec.Code)
	}
}

func TestCookieOnlyProfileDeviceProofRequired(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	sid := "sid_12345678901234567890"
	manager := newProofTestManager(t, mr, sid, "adev_1234567890123456789", "c3Bp", 1)
	csrf, _ := GenerateCSRFToken(sid, manager.jwtSecret)

	req := httptest.NewRequest(http.MethodGet, "/api/profile", nil)
	req.Header.Set("Origin", "https://earflow.ru")
	req.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
	req.AddCookie(&http.Cookie{Name: "mp_csrf", Value: csrf})
	w := httptest.NewRecorder()
	chain := manager.SessionAuthMiddleware()(manager.DeviceProofMiddleware()(http.HandlerFunc(manager.handleProfile())))
	chain.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("cookie-only profile = %d, want 401", w.Code)
	}
	var body apiError
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body.Code != authCodeDeviceProofReq {
		t.Fatalf("code = %q", body.Code)
	}
}

func TestRefreshWithoutProofRejected(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	sid := "sid_12345678901234567890"
	manager := newProofTestManager(t, mr, sid, "adev_1234567890123456789", "c3Bp", 2)

	w := httptest.NewRecorder()
	req := httptestNewRequestWithCookie(http.MethodPost, "/api/auth/refresh", sid)
	manager.DeviceProofMiddleware()(http.HandlerFunc(manager.handleRefresh())).ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("refresh without proof = %d, want 401", w.Code)
	}
	var body apiError
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body.Code != authCodeDeviceProofReq {
		t.Fatalf("code = %q, want %s", body.Code, authCodeDeviceProofReq)
	}
}

func TestExpiredProofTimestampRejected(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	sid := "sid_12345678901234567890"
	authDeviceID := "adev_1234567890123456789"
	priv, pub := generateTestECDSAKeyPair(t)
	manager := newProofTestManager(t, mr, sid, authDeviceID, pub, 4)

	ts := strconv.FormatInt(time.Now().Add(-10*time.Minute).Unix(), 10)
	nonce := "nonce-expired-01"
	canonical := buildCanonicalProofString(http.MethodGet, "/api/profile", nil, ts, nonce, sidHashForProof(manager.jwtSecret, sid))
	proof := signCanonicalTest(t, priv, canonical)

	req := httptest.NewRequest(http.MethodGet, "/api/profile", nil)
	req.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
	req.Header.Set(headerAuthDeviceID, authDeviceID)
	req.Header.Set(headerAuthDeviceProof, proof)
	req.Header.Set(headerAuthDeviceTs, ts)
	req.Header.Set(headerAuthDeviceNonce, nonce)
	w := httptest.NewRecorder()
	manager.SessionAuthMiddleware()(manager.DeviceProofMiddleware()(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))).ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expired proof = %d, want 401", w.Code)
	}
}

func TestRevokedAuthDeviceRejected(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	sid := "sid_12345678901234567890"
	authDeviceID := "adev_1234567890123456789"
	priv, pub := generateTestECDSAKeyPair(t)
	manager := newProofTestManager(t, mr, sid, authDeviceID, pub, 6)
	_ = manager.devices.Revoke(context.Background(), authDeviceID)

	ts := strconv.FormatInt(time.Now().Unix(), 10)
	nonce := "nonce-revoked-dev"
	canonical := buildCanonicalProofString(http.MethodGet, "/api/profile", nil, ts, nonce, sidHashForProof(manager.jwtSecret, sid))
	proof := signCanonicalTest(t, priv, canonical)

	req := httptest.NewRequest(http.MethodGet, "/api/profile", nil)
	req.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
	req.Header.Set(headerAuthDeviceID, authDeviceID)
	req.Header.Set(headerAuthDeviceProof, proof)
	req.Header.Set(headerAuthDeviceTs, ts)
	req.Header.Set(headerAuthDeviceNonce, nonce)
	w := httptest.NewRecorder()
	manager.SessionAuthMiddleware()(manager.DeviceProofMiddleware()(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))).ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("revoked device = %d, want 401", w.Code)
	}
}

func TestProductionIgnoresAllowCookieBypassEnv(t *testing.T) {
	t.Setenv(envAllowCookieOnly, "1")
	m := &SessionManager{isProduction: true}
	if !m.deviceProofEnforced() {
		t.Fatal("production must enforce proof even with ALLOW_COOKIE_AUTH_WITHOUT_PROOF=1")
	}
}

func TestRevokeSessionRemovesDeviceBinding(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	ctx := context.Background()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	sid := "sid_12345678901234567890"
	authDeviceID := "adev_12345678901234567890"
	mr.Set(authDeviceKey(authDeviceID), `{"authDeviceId":"`+authDeviceID+`"}`)
	mr.SAdd(authSidDevicesKey(sid), authDeviceID)
	if err := RevokeSessionFull(ctx, rdb, "mp:sess:", sid, 1, ""); err != nil {
		t.Fatal(err)
	}
	if mr.Exists(authDeviceKey(authDeviceID)) {
		t.Fatal("device key should be removed")
	}
}
