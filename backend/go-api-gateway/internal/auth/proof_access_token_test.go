package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
)

func TestProofAccessTokenHotPathSkipsNonce(t *testing.T) {
	t.Setenv(envProofAccessTokenEnabled, "1")

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	sid := "sid_12345678901234567890"
	authDeviceID := "adev_1234567890123456789"
	priv, pub := generateTestECDSAKeyPair(t)
	manager := newProofTestManager(t, mr, sid, authDeviceID, pub, 9)
	manager.proofEpochs = newProofEpochCache()

	token, _, err := manager.issueProofAccessToken(sid, authDeviceID, ProofEpochLookup{})
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	serve := func() int {
		req := httptest.NewRequest(http.MethodGet, "/api/profile", nil)
		req.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
		req.Header.Set(headerAuthDeviceID, authDeviceID)
		req.Header.Set(headerProofAccessToken, token)
		w := httptest.NewRecorder()
		h := manager.SessionAuthMiddleware()(manager.DeviceProofMiddleware()(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})))
		h.ServeHTTP(w, req)
		return w.Code
	}
	if serve() != http.StatusOK {
		t.Fatalf("first token request should pass")
	}
	if serve() != http.StatusOK {
		t.Fatalf("second token request should pass without nonce replay store")
	}
	_ = priv
}

func TestProofAccessTokenRejectedAfterEpochBump(t *testing.T) {
	t.Setenv(envProofAccessTokenEnabled, "1")

	mr, _ := miniredis.Run()
	defer mr.Close()
	sid := "sid_12345678901234567890"
	authDeviceID := "adev_1234567890123456789"
	_, pub := generateTestECDSAKeyPair(t)
	manager := newProofTestManager(t, mr, sid, authDeviceID, pub, 9)
	manager.proofEpochs = newProofEpochCache()

	token, _, err := manager.issueProofAccessToken(sid, authDeviceID, ProofEpochLookup{SessionEpoch: 1})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	manager.proofEpochs.bumpSessionEpoch(sid, 2)

	req := httptest.NewRequest(http.MethodGet, "/api/profile", nil)
	req.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
	req.Header.Set(headerAuthDeviceID, authDeviceID)
	req.Header.Set(headerProofAccessToken, token)
	w := httptest.NewRecorder()
	manager.SessionAuthMiddleware()(manager.DeviceProofMiddleware()(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))).ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("stale token status = %d, want 401", w.Code)
	}
}

func TestSensitivePathRequiresFullProofEvenWithToken(t *testing.T) {
	t.Setenv(envProofAccessTokenEnabled, "1")

	mr, _ := miniredis.Run()
	defer mr.Close()
	sid := "sid_12345678901234567890"
	authDeviceID := "adev_1234567890123456789"
	_, pub := generateTestECDSAKeyPair(t)
	manager := newProofTestManager(t, mr, sid, authDeviceID, pub, 9)
	manager.proofEpochs = newProofEpochCache()

	token, _, err := manager.issueProofAccessToken(sid, authDeviceID, ProofEpochLookup{})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)
	req.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
	req.Header.Set(headerAuthDeviceID, authDeviceID)
	req.Header.Set(headerProofAccessToken, token)
	w := httptest.NewRecorder()
	manager.DeviceProofMiddleware()(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})).ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("logout with token only = %d, want 401", w.Code)
	}
}

func TestDeviceProofSensitivePathMatcher(t *testing.T) {
	if !deviceProofSensitivePath("/api/auth/sessions/revoke-others") {
		t.Fatal("sessions revoke should be sensitive")
	}
	if deviceProofSensitivePath("/api/profile") {
		t.Fatal("profile should not be sensitive")
	}
}

func TestProofTokenHandlerRequiresFullProof(t *testing.T) {
	t.Setenv(envProofAccessTokenEnabled, "1")

	mr, _ := miniredis.Run()
	defer mr.Close()
	sid := "sid_12345678901234567890"
	authDeviceID := "adev_1234567890123456789"
	_, pub := generateTestECDSAKeyPair(t)
	manager := newProofTestManager(t, mr, sid, authDeviceID, pub, 9)
	manager.proofEpochs = newProofEpochCache()
	manager.allowedOrigins = map[string]struct{}{"https://earflow.ru": {}}

	req := httptest.NewRequest(http.MethodPost, "/api/auth/proof/token", nil)
	req = req.WithContext(withTestCtxSID(req.Context(), sid))
	req.Header.Set("Origin", "https://earflow.ru")
	w := httptest.NewRecorder()
	manager.handleProofToken().ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("token exchange without proof = %d, want 401", w.Code)
	}
}

func withTestCtxSID(ctx context.Context, sid string) context.Context {
	return context.WithValue(ctx, ctxSID, sid)
}

func TestProofTokenHandlerIssuesToken(t *testing.T) {
	t.Setenv(envProofAccessTokenEnabled, "1")

	mr, _ := miniredis.Run()
	defer mr.Close()
	sid := "sid_12345678901234567890"
	authDeviceID := "adev_1234567890123456789"
	priv, pub := generateTestECDSAKeyPair(t)
	manager := newProofTestManager(t, mr, sid, authDeviceID, pub, 9)
	manager.proofEpochs = newProofEpochCache()
	manager.allowedOrigins = map[string]struct{}{"https://earflow.ru": {}}

	ts := strconv.FormatInt(time.Now().Unix(), 10)
	nonce := "nonce-proof-token-ex"
	canonical := buildCanonicalProofString(http.MethodPost, "/api/auth/proof/token", nil, ts, nonce, sidHashForProof(manager.jwtSecret, sid))
	proof := signCanonicalTest(t, priv, canonical)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/proof/token", nil)
	req = req.WithContext(withTestCtxSID(req.Context(), sid))
	req.Header.Set("Origin", "https://earflow.ru")
	req.Header.Set(headerAuthDeviceID, authDeviceID)
	req.Header.Set(headerAuthDeviceProof, proof)
	req.Header.Set(headerAuthDeviceTs, ts)
	req.Header.Set(headerAuthDeviceNonce, nonce)
	w := httptest.NewRecorder()
	manager.handleProofToken().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("exchange status = %d, want 200 body=%s", w.Code, w.Body.String())
	}
	var body proofAccessTokenResponse
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Token == "" || body.ExpiresIn <= 0 {
		t.Fatalf("bad response: %+v", body)
	}
}
