package httpapi

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/earflow/music-platform/security-service/internal/authz"
	"github.com/earflow/music-platform/security-service/internal/config"
	"github.com/earflow/music-platform/security-service/internal/cryptoutil"
	"github.com/earflow/music-platform/security-service/internal/store"
	"github.com/golang-jwt/jwt/v5"
)

func testKey() []byte {
	b, _ := hex.DecodeString("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f")
	return b
}

func testDeps(t *testing.T) Deps {
	t.Helper()
	mr := miniredis.RunT(t)
	addr := mr.Addr() // host:port
	host, portStr, _ := net.SplitHostPort(addr)
	port, _ := strconv.Atoi(portStr)
	rd, err := store.NewRedis(context.Background(), config.RedisConfig{
		Host:         host,
		Port:         port,
		DB:           0,
		DialTimeout:  time.Second,
		ReadTimeout:  time.Second,
		WriteTimeout: time.Second,
		PoolSize:     4,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rd.Close() })

	return Deps{
		Config: config.Config{
			HTTP: config.HTTPConfig{MaxBodyBytes: 4096},
			Security: config.SecurityConfig{
				StepUpTTL:                 5 * time.Minute,
				PasswordAttemptWindow:     60 * time.Second,
				PasswordMaxAttempts:       5,
				EncryptionPbkdfIterations: 10000,
				PbkdfIterationsLegacy:     10000,
				EncryptionKeyLength:       32,
			},
			Crypto: config.CryptoConfig{EncryptionKey: testKey()},
		},
		Redis: rd,
	}
}

// authedRequest mints a real access JWT and runs it through the verifier
// middleware, returning the request with the Principal injected in context.
func authedRequest(t *testing.T, method, target string, userID int64, sid string, body []byte) *http.Request {
	t.Helper()
	claims := jwt.MapClaims{
		"type":   "access",
		"userId": userID,
		"sid":    sid,
		"iss":    "earflow-auth",
		"aud":    "earflow-api",
		"exp":    time.Now().Add(15 * time.Minute).Unix(),
		"iat":    time.Now().Unix(),
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := tok.SignedString(testKey())
	if err != nil {
		t.Fatal(err)
	}

	var captured *http.Request
	verifier := authz.Verifier{Secret: testKey(), Issuer: "earflow-auth", Audience: "earflow-api"}
	inner := verifier.Middleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured = r
	}))

	var bodyReader *bytes.Reader
	if body != nil {
		bodyReader = bytes.NewReader(body)
	} else {
		bodyReader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, target, bodyReader)
	req.Header.Set("Authorization", "Bearer "+signed)
	inner.ServeHTTP(httptest.NewRecorder(), req)
	if captured == nil {
		t.Fatal("verifier middleware did not authorize request")
	}
	return captured
}

func TestMfaSecretEncryptRoundTrip(t *testing.T) {
	const salt = "abc123"
	payload, err := json.Marshal(map[string]string{"secretBase32": "JBSWY3DPEHPK3PXP"})
	if err != nil {
		t.Fatal(err)
	}
	enc, err := cryptoutil.EncryptPayload(testKey(), salt, payload, 10000, 32)
	if err != nil {
		t.Fatal(err)
	}
	plain, err := cryptoutil.DecryptPayload(testKey(), salt, *enc, 10000, 10000, 32)
	if err != nil {
		t.Fatal(err)
	}
	var parsed struct {
		SecretBase32 string `json:"secretBase32"`
	}
	if err := json.Unmarshal(plain, &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed.SecretBase32 != "JBSWY3DPEHPK3PXP" {
		t.Errorf("round-trip secret = %q", parsed.SecretBase32)
	}
}

func TestMfaStatusRequiresAuth(t *testing.T) {
	d := testDeps(t)
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/auth/2fa/status", nil)
	mfaStatusHandler(d)(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestMfaEnableRequiresBodyAndToken(t *testing.T) {
	d := testDeps(t)

	// Empty token.
	body, _ := json.Marshal(map[string]any{"token": ""})
	w2 := httptest.NewRecorder()
	r2 := authedRequest(t, http.MethodPost, "/api/auth/2fa/enable", 7, "sid_12345678901234567890", body)
	mfaEnableHandler(d)(w2, r2)
	if w2.Code != http.StatusBadRequest {
		t.Fatalf("empty-token status=%d body=%s", w2.Code, w2.Body.String())
	}
}

func TestMfaStepUpRejectsBothFactors(t *testing.T) {
	d := testDeps(t)
	body, _ := json.Marshal(map[string]any{"token": "123456", "recoveryCode": "ABC"})
	w := httptest.NewRecorder()
	r := authedRequest(t, http.MethodPost, "/api/auth/2fa/step-up", 7, "sid_12345678901234567890", body)
	mfaStepUpHandler(d)(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestMfaStepUpStatusNoMarker(t *testing.T) {
	d := testDeps(t)
	w := httptest.NewRecorder()
	r := authedRequest(t, http.MethodGet, "/api/auth/2fa/step-up/status", 7, "sid_12345678901234567890", nil)
	mfaStepUpStatusHandler(d)(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var resp mfaStepUpStatusResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.OK {
		t.Fatalf("step-up should be inactive: %s", w.Body.String())
	}
}

func TestMfaStepUpStatusActiveAfterBump(t *testing.T) {
	d := testDeps(t)
	const sid = "sid_12345678901234567890"
	if err := d.Redis.BumpStepUp(context.Background(), sid, 7, 5*time.Minute); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	r := authedRequest(t, http.MethodGet, "/api/auth/2fa/step-up/status", 7, sid, nil)
	mfaStepUpStatusHandler(d)(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var resp mfaStepUpStatusResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if !resp.OK {
		t.Fatalf("step-up should be active: %s", w.Body.String())
	}
	if resp.TTLSeconds <= 0 {
		t.Fatalf("ttlSeconds should be positive: %s", w.Body.String())
	}
}

func TestMfaStepUpStatusWrongUser(t *testing.T) {
	d := testDeps(t)
	const sid = "sid_12345678901234567890"
	if err := d.Redis.BumpStepUp(context.Background(), sid, 99, 5*time.Minute); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	r := authedRequest(t, http.MethodGet, "/api/auth/2fa/step-up/status", 7, sid, nil)
	mfaStepUpStatusHandler(d)(w, r)
	var resp mfaStepUpStatusResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.OK {
		t.Fatalf("step-up for different user must be inactive: %s", w.Body.String())
	}
}
