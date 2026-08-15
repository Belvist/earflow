package auth

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/alicebob/miniredis/v2"
)

func makePKCEPairTest() (verifier, challenge string) {
	verifier = "earflow-pkce-verifier-0123456789-abcdefghijklmnop_~.-XYZ"
	sum := sha256.Sum256([]byte(verifier))
	challenge = base64.RawURLEncoding.EncodeToString(sum[:])
	return
}

func TestVerifyPKCES256(t *testing.T) {
	verifier, challenge := makePKCEPairTest()
	if !verifyPKCES256(verifier, challenge) {
		t.Fatal("matching verifier/challenge should verify")
	}
	if verifyPKCES256(verifier+"x", challenge) {
		t.Fatal("mismatched verifier must fail")
	}
	if verifyPKCES256("short", challenge) {
		t.Fatal("too-short verifier must fail")
	}
	if verifyPKCES256(verifier, "not base64url !!!") {
		t.Fatal("invalid challenge must fail")
	}
}

func TestNativeAuthRedirectAllowed(t *testing.T) {
	if !nativeAuthRedirectAllowed(defaultNativeRedirectURI) {
		t.Fatal("default redirect uri must be allowed")
	}
	if nativeAuthRedirectAllowed("https://evil.example/steal") {
		t.Fatal("untrusted redirect uri must be denied")
	}
	t.Setenv(envNativeAuthRedirectURIs, "earflow://auth/callback, earflow-dev://cb")
	if !nativeAuthRedirectAllowed("earflow-dev://cb") {
		t.Fatal("env-configured redirect uri must be allowed")
	}
	if nativeAuthRedirectAllowed("earflow://other") {
		t.Fatal("non-listed redirect must be denied")
	}
}

func TestNativeFinalizeMintsCodeAndRedirects(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	sid := "sid_12345678901234567890"
	authDeviceID := "adev_1234567890123456789"
	_, pub := generateTestECDSAKeyPair(t)
	m := newProofTestManager(t, mr, sid, authDeviceID, pub, 42)

	_, challenge := makePKCEPairTest()
	target := "/api/auth/native/finalize?" + url.Values{
		"redirect_uri":          {defaultNativeRedirectURI},
		"state":                 {"st-123"},
		"code_challenge":        {challenge},
		"code_challenge_method": {"S256"},
	}.Encode()

	req := httptest.NewRequest(http.MethodGet, target, nil)
	// Real login return_to flow: navigates from auth.earflow.ru; browsers drop
	// Origin on top-level navigation and send Referer instead.
	req.Header.Set("Referer", "https://auth.earflow.ru/login")
	req.Header.Set("Sec-Fetch-Site", "same-site")
	ctx := context.WithValue(req.Context(), ctxSID, sid)
	ctx = context.WithValue(ctx, ctxUserID, "42")
	req = req.WithContext(ctx)
	w := httptest.NewRecorder()
	m.handleNativeFinalize()(w, req)

	if w.Code != http.StatusFound {
		t.Fatalf("status = %d body=%s, want 302", w.Code, w.Body.String())
	}
	loc := w.Header().Get("Location")
	if !strings.HasPrefix(loc, "earflow://auth/callback?") {
		t.Fatalf("location = %q, want earflow callback", loc)
	}
	u, _ := url.Parse(loc)
	code := u.Query().Get("code")
	if code == "" {
		t.Fatal("expected code in redirect")
	}
	if u.Query().Get("state") != "st-123" {
		t.Fatalf("state = %q, want st-123", u.Query().Get("state"))
	}
	if !mr.Exists(nativeAuthCodeRedisPrefix + code) {
		t.Fatal("code must be stored in redis")
	}
}

func TestNativeFinalizeNoSessionRedirectsLoginRequired(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	m := newProofTestManager(t, mr, "sid_12345678901234567890", "adev_1234567890123456789", "unused", 42)

	_, challenge := makePKCEPairTest()
	target := "/api/auth/native/finalize?" + url.Values{
		"redirect_uri":   {defaultNativeRedirectURI},
		"state":          {"st-1"},
		"code_challenge": {challenge},
	}.Encode()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	// Real login return_to flow: navigates from auth.earflow.ru; browsers drop
	// Origin on top-level navigation and send Referer instead.
	req.Header.Set("Referer", "https://auth.earflow.ru/login")
	req.Header.Set("Sec-Fetch-Site", "same-site")
	w := httptest.NewRecorder()
	m.handleNativeFinalize()(w, req)

	if w.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302", w.Code)
	}
	u, _ := url.Parse(w.Header().Get("Location"))
	if u.Query().Get("error") != "login_required" {
		t.Fatalf("error = %q, want login_required", u.Query().Get("error"))
	}
	if u.Query().Get("code") != "" {
		t.Fatal("no code without session")
	}
}

func TestNativeFinalizeBadRedirectReturns400(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	m := newProofTestManager(t, mr, "sid_12345678901234567890", "adev_1234567890123456789", "unused", 42)

	_, challenge := makePKCEPairTest()
	target := "/api/auth/native/finalize?" + url.Values{
		"redirect_uri":   {"https://evil.example/cb"},
		"code_challenge": {challenge},
	}.Encode()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	// Real login return_to flow: navigates from auth.earflow.ru; browsers drop
	// Origin on top-level navigation and send Referer instead.
	req.Header.Set("Referer", "https://auth.earflow.ru/login")
	req.Header.Set("Sec-Fetch-Site", "same-site")
	ctx := context.WithValue(req.Context(), ctxSID, "sid_12345678901234567890")
	req = req.WithContext(ctx)
	w := httptest.NewRecorder()
	m.handleNativeFinalize()(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (no redirect to untrusted uri)", w.Code)
	}
	if w.Header().Get("Location") != "" {
		t.Fatal("must not redirect to untrusted uri")
	}
}

func seedNativeCode(t *testing.T, mr *miniredis.Miniredis, code, sid, challenge string, userID int64) {
	t.Helper()
	payload, _ := json.Marshal(nativeCodePayload{SID: sid, UserID: userID, CodeChallenge: challenge})
	mr.Set(nativeAuthCodeRedisPrefix+code, string(payload))
}

func newNativeExchangeManager(t *testing.T, mr *miniredis.Miniredis, sid string, userID int64) *SessionManager {
	t.Helper()
	m := newProofTestManager(t, mr, sid, "adev_seed12345678901234567", "unused", userID)
	m.allowedOrigins = map[string]struct{}{"https://earflow.ru": {}}
	return m
}

func TestNativeExchangeSuccessBindsDeviceAndSetsCookies(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	sid := "sid_12345678901234567890"
	m := newNativeExchangeManager(t, mr, sid, 42)

	verifier, challenge := makePKCEPairTest()
	code := "code_exchange_success_0123456789abcd"
	seedNativeCode(t, mr, code, sid, challenge, 42)

	authDeviceID := "adev_native_exch12345678901"
	_, pub := generateTestECDSAKeyPair(t)
	body, _ := json.Marshal(nativeExchangeRequest{
		Code:          code,
		CodeVerifier:  verifier,
		AuthDeviceID:  authDeviceID,
		PublicKeySPKI: pub,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/native/exchange", strings.NewReader(string(body)))
	req.Header.Set("Origin", "https://earflow.ru")
	w := httptest.NewRecorder()
	m.handleNativeExchange()(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s, want 200", w.Code, w.Body.String())
	}
	if !strings.Contains(strings.Join(w.Header().Values("Set-Cookie"), ";"), "mp_sid="+sid) {
		t.Fatalf("expected mp_sid cookie set, got %v", w.Header().Values("Set-Cookie"))
	}
	var resp nativeExchangeResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if !resp.OK || resp.AuthDeviceID != authDeviceID || resp.SIDHash == "" {
		t.Fatalf("bad response: %+v", resp)
	}
	rec, err := m.devices.Get(context.Background(), authDeviceID)
	if err != nil || rec == nil {
		t.Fatalf("device not bound: %v", err)
	}
	if rec.SID != sid {
		t.Fatalf("device sid = %q, want %q", rec.SID, sid)
	}
	if mr.Exists(nativeAuthCodeRedisPrefix + code) {
		t.Fatal("code must be consumed (single-use)")
	}
}

func TestNativeExchangeWrongVerifierRejectedAndCodeBurned(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	sid := "sid_12345678901234567890"
	m := newNativeExchangeManager(t, mr, sid, 42)

	_, challenge := makePKCEPairTest()
	code := "code_exchange_wrongver_0123456789ab"
	seedNativeCode(t, mr, code, sid, challenge, 42)

	_, pub := generateTestECDSAKeyPair(t)
	body, _ := json.Marshal(nativeExchangeRequest{
		Code:          code,
		CodeVerifier:  "earflow-pkce-verifier-WRONG-000000000000000000000",
		AuthDeviceID:  "adev_native_exch12345678901",
		PublicKeySPKI: pub,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/native/exchange", strings.NewReader(string(body)))
	req.Header.Set("Origin", "https://earflow.ru")
	w := httptest.NewRecorder()
	m.handleNativeExchange()(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
	if mr.Exists(nativeAuthCodeRedisPrefix + code) {
		t.Fatal("code must be burned even on PKCE failure")
	}
}

func TestNativeExchangeReusedCodeRejected(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	sid := "sid_12345678901234567890"
	m := newNativeExchangeManager(t, mr, sid, 42)

	verifier, challenge := makePKCEPairTest()
	code := "code_exchange_reuse_0123456789abcdef"
	seedNativeCode(t, mr, code, sid, challenge, 42)

	_, pub := generateTestECDSAKeyPair(t)
	mkReq := func() *httptest.ResponseRecorder {
		body, _ := json.Marshal(nativeExchangeRequest{
			Code:          code,
			CodeVerifier:  verifier,
			AuthDeviceID:  "adev_native_exch12345678901",
			PublicKeySPKI: pub,
		})
		req := httptest.NewRequest(http.MethodPost, "/api/auth/native/exchange", strings.NewReader(string(body)))
		req.Header.Set("Origin", "https://earflow.ru")
		w := httptest.NewRecorder()
		m.handleNativeExchange()(w, req)
		return w
	}
	if first := mkReq(); first.Code != http.StatusOK {
		t.Fatalf("first exchange = %d body=%s, want 200", first.Code, first.Body.String())
	}
	if second := mkReq(); second.Code != http.StatusUnauthorized {
		t.Fatalf("reused code = %d, want 401", second.Code)
	}
}

func TestNativeExchangeBadOriginRejected(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	sid := "sid_12345678901234567890"
	m := newNativeExchangeManager(t, mr, sid, 42)

	verifier, challenge := makePKCEPairTest()
	code := "code_exchange_origin_0123456789abcd"
	seedNativeCode(t, mr, code, sid, challenge, 42)

	_, pub := generateTestECDSAKeyPair(t)
	body, _ := json.Marshal(nativeExchangeRequest{
		Code: code, CodeVerifier: verifier,
		AuthDeviceID: "adev_native_exch12345678901", PublicKeySPKI: pub,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/native/exchange", strings.NewReader(string(body)))
	req.Header.Set("Origin", "https://evil.example")
	w := httptest.NewRecorder()
	m.handleNativeExchange()(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for bad origin", w.Code)
	}
}

func TestNativeFinalizeCrossSiteTopLevelNavigationRejected(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	sid := "sid_12345678901234567890"
	authDeviceID := "adev_1234567890123456789"
	_, pub := generateTestECDSAKeyPair(t)
	m := newProofTestManager(t, mr, sid, authDeviceID, pub, 42)
	m.allowedOrigins = map[string]struct{}{"https://earflow.ru": {}, "https://auth.earflow.ru": {}}

	_, challenge := makePKCEPairTest()
	target := "/api/auth/native/finalize?" + url.Values{
		"redirect_uri":          {defaultNativeRedirectURI},
		"state":                 {"st-123"},
		"code_challenge":        {challenge},
		"code_challenge_method": {"S256"},
	}.Encode()

	// Cross-origin top-level navigation carries no Origin and no allowed Referer.
	req := httptest.NewRequest(http.MethodGet, target, nil)
	ctx := context.WithValue(req.Context(), ctxSID, sid)
	req = req.WithContext(ctx)
	w := httptest.NewRecorder()
	m.handleNativeFinalize()(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("cross-site top-level navigation = %d, want 403", w.Code)
	}

	// Same for a foreign Origin header.
	req2 := httptest.NewRequest(http.MethodGet, target, nil)
	req2.Header.Set("Origin", "https://evil.example")
	req2 = req2.WithContext(context.WithValue(context.Background(), ctxSID, sid))
	w2 := httptest.NewRecorder()
	m.handleNativeFinalize()(w2, req2)
	if w2.Code != http.StatusForbidden {
		t.Fatalf("evil-origin navigation = %d, want 403", w2.Code)
	}
}
