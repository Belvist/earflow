package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/earflow/music-platform/go-api-gateway/internal/config"
	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
)

func TestBypassesSessionAuthMiddleware(t *testing.T) {
	tests := []struct {
		path string
		want bool
	}{
		{path: "/api/auth/email/login", want: true},
		{path: "/api/auth/email/register", want: true},
		{path: "/api/auth/telegram/login", want: true},
		{path: "/api/auth/csrf", want: true},
		{path: "/api/auth/refresh", want: true},
		{path: "/api/auth/logout", want: true},
		{path: "/api/public-config", want: true},
		{path: "/api/profile", want: false},
		{path: "/api/playlists", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			if got := bypassesSessionAuthMiddleware(tt.path); got != tt.want {
				t.Fatalf("bypassesSessionAuthMiddleware(%q) = %v, want %v", tt.path, got, tt.want)
			}
		})
	}
}

type sequenceKV struct {
	values []string
	calls  int
	dels   int
}

func (k *sequenceKV) Get(_ context.Context, _ string) (string, error) {
	if len(k.values) == 0 {
		return "", redis.Nil
	}
	i := k.calls
	k.calls++
	if i >= len(k.values) {
		i = len(k.values) - 1
	}
	v := k.values[i]
	if v == "" {
		return "", redis.Nil
	}
	return v, nil
}

func (k *sequenceKV) SetEx(_ context.Context, _ string, _ string, _ time.Duration) error {
	return nil
}

func (k *sequenceKV) Del(_ context.Context, _ string) error {
	k.dels++
	return nil
}

func (k *sequenceKV) Expire(_ context.Context, _ string, _ time.Duration) error {
	return nil
}

func makeAccessTokenForTest(t *testing.T, secret string, userID string) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"type":   "access",
		"userId": userID,
		"exp":    time.Now().Add(time.Hour).Unix(),
	})
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("SignedString failed: %v", err)
	}
	return signed
}

func marshalSessionForTest(t *testing.T, sess Session) string {
	t.Helper()
	b, err := json.Marshal(sess)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}
	return string(b)
}

func TestTryRecoverAfterRotateInvalidRetriesUpdatedSession(t *testing.T) {
	secret := "test-secret-test-secret-test-secret-32"
	invalid := marshalSessionForTest(t, Session{AccessToken: "expired", RefreshToken: "old-refresh", User: json.RawMessage(`{"id":1}`)})
	valid := marshalSessionForTest(t, Session{AccessToken: makeAccessTokenForTest(t, secret, "1"), RefreshToken: "new-refresh", User: json.RawMessage(`{"id":1}`)})
	kv := &sequenceKV{values: []string{invalid, valid}}
	manager := &SessionManager{
		store:     &SessionStore{rdb: kv, keyPrefix: "mp:sess:", ttl: time.Hour},
		jwtSecret: secret,
	}

	sess, claims, status := manager.tryRecoverAfterRotateInvalid(context.Background(), "sid_123")
	if status != recoverAfterRotateInvalidOK {
		t.Fatalf("status = %s, want %s", status, recoverAfterRotateInvalidOK)
	}
	if sess == nil || sess.RefreshToken != "new-refresh" {
		t.Fatalf("unexpected session: %+v", sess)
	}
	if got := extractUserID(claims); got != "1" {
		t.Fatalf("userID = %q, want 1", got)
	}
	if kv.calls < 2 {
		t.Fatalf("Get calls = %d, want retry", kv.calls)
	}
}

func TestHandleRefreshInvalidPreservesRecoverableSession(t *testing.T) {
	sid := "sid_12345678901234567890"
	kv := &sequenceKV{values: []string{
		marshalSessionForTest(t, Session{
			AccessToken:  "expired",
			RefreshToken: "old-refresh",
			User:         json.RawMessage(`{"id":"user-1"}`),
		}),
	}}
	authServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer authServer.Close()

	manager := &SessionManager{
		store:          &SessionStore{rdb: kv, keyPrefix: "mp:sess:", ttl: time.Hour},
		jwtSecret:      "test-secret-test-secret-test-secret-32",
		cookie:         config.CookieConfig{Domain: ".earflow.ru", SameSite: "none", Secure: true},
		cookieNames:    testMainCookieNames(),
		authBaseURL:    authServer.URL,
		allowedOrigins: map[string]struct{}{"https://earflow.ru": {}},
	}

	req := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
	req.Header.Set("Origin", "https://earflow.ru")
	req.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
	w := httptest.NewRecorder()

	manager.handleRefresh().ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
	var body errorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("response json unmarshal failed: %v", err)
	}
	if body.Code != authCodeSessionUnverified {
		t.Fatalf("code = %q, want %q", body.Code, authCodeSessionUnverified)
	}
	if !body.Recoverable {
		t.Fatalf("recoverable = false, want true")
	}
	if body.ReauthRequired {
		t.Fatalf("reauthRequired = true, want false")
	}
	if kv.dels != 0 {
		t.Fatalf("Del calls = %d, want 0", kv.dels)
	}
	for _, h := range w.Result().Header.Values("Set-Cookie") {
		if strings.Contains(h, "Max-Age=-1") {
			t.Fatalf("did not expect clearing Set-Cookie header, got %q", h)
		}
	}
}

func TestHandleProfileRequiresAuthenticatedMiddlewareContext(t *testing.T) {
	sid := "sid_12345678901234567890"
	secret := "test-secret-test-secret-test-secret-32"
	kv := &sequenceKV{values: []string{
		marshalSessionForTest(t, Session{
			AccessToken:  makeAccessTokenForTest(t, secret, "user-1"),
			RefreshToken: "refresh-token",
			User:         json.RawMessage(`{"id":"user-1"}`),
		}),
	}}
	manager := &SessionManager{
		store:       &SessionStore{rdb: kv, keyPrefix: "mp:sess:", ttl: time.Hour},
		jwtSecret:   secret,
		cookieNames: testMainCookieNames(),
	}

	req := httptest.NewRequest(http.MethodGet, "/api/profile", nil)
	req.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
	w := httptest.NewRecorder()

	manager.handleProfile().ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status without auth context = %d, want %d", w.Code, http.StatusUnauthorized)
	}
	var noSessionBody errorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &noSessionBody); err != nil {
		t.Fatalf("no session response json unmarshal failed: %v", err)
	}
	if noSessionBody.Code != authCodeNoSession {
		t.Fatalf("no session code = %q, want %q", noSessionBody.Code, authCodeNoSession)
	}
	if !noSessionBody.ReauthRequired {
		t.Fatalf("no session reauthRequired = false, want true")
	}
	if noSessionBody.Recoverable {
		t.Fatalf("no session recoverable = true, want false")
	}

	req = httptest.NewRequest(http.MethodGet, "/api/profile", nil)
	req = req.WithContext(context.WithValue(req.Context(), ctxSID, sid))
	req.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
	w = httptest.NewRecorder()

	manager.handleProfile().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status with auth context = %d, want %d", w.Code, http.StatusOK)
	}
}

func mintTokenForTest(t *testing.T, secret string, claims jwt.MapClaims) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("SignedString failed: %v", err)
	}
	return signed
}

func TestVerifyAccessRequiresTypeClaim(t *testing.T) {
	secret := "test-secret-test-secret-test-secret-32"
	manager := &SessionManager{jwtSecret: secret}

	noType := mintTokenForTest(t, secret, jwt.MapClaims{
		"userId": "user-1",
		"exp":    time.Now().Add(time.Hour).Unix(),
	})
	if ok, _ := manager.verifyAccess(noType); ok {
		t.Fatalf("token without type claim must be rejected")
	}

	wrongType := mintTokenForTest(t, secret, jwt.MapClaims{
		"type":   "refresh",
		"userId": "user-1",
		"exp":    time.Now().Add(time.Hour).Unix(),
	})
	if ok, _ := manager.verifyAccess(wrongType); ok {
		t.Fatalf("token with non-access type must be rejected")
	}

	valid := makeAccessTokenForTest(t, secret, "user-1")
	if ok, _ := manager.verifyAccess(valid); !ok {
		t.Fatalf("valid access token must be accepted")
	}
}
