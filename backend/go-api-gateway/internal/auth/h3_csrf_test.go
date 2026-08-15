package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/earflow/music-platform/go-api-gateway/internal/config"
	"github.com/redis/go-redis/v9"
)

const csrfTestSecret = "test-secret-test-secret-test-secret-32"

func csrfTestManager(mr *miniredis.Miniredis, sid string) *SessionManager {
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	return &SessionManager{
		store:          &SessionStore{rdb: redisSessionKV{rdb: rdb}, keyPrefix: "mp:sess:", ttl: time.Hour},
		jwtSecret:      csrfTestSecret,
		cookie:         config.CookieConfig{Domain: ".earflow.ru", SameSite: "none", Secure: true},
		cookieNames:    testMainCookieNames(),
		authBaseURL:    "http://127.0.0.1:1",
		allowedOrigins: map[string]struct{}{"https://earflow.ru": {}},
	}
}

// TestCSRFGroupRejectsRefreshWithoutToken locks H-3: sensitive local auth POSTs
// (refresh/logout/proof/stream/device-register) require double-submit CSRF
// (cookie + matching header), not just Origin.
func TestCSRFGroupRejectsRefreshWithoutToken(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	sid := "sid_csrf_1234567890123456789"
	csrf, _ := GenerateCSRFToken(sid, csrfTestSecret)
	mr.Set("mp:sess:"+sid, marshalSessionForTest(t, Session{
		AccessToken:  makeAccessTokenForTest(t, csrfTestSecret, "1"),
		RefreshToken: "refresh",
		User:         json.RawMessage(`{"id":1}`),
	}))

	handler := csrfTestManager(mr, sid).CSRFProtectionMiddleware()(
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }),
	)

	// No X-CSRF-Token header -> 403 CSRF_MISSING.
	req := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
	req.Header.Set("Origin", "https://earflow.ru")
	req.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
	req.AddCookie(&http.Cookie{Name: "mp_csrf", Value: csrf})
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("no-token refresh = %d, want 403", w.Code)
	}
	var body apiError
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body.Code != "CSRF_MISSING" {
		t.Fatalf("code = %q, want CSRF_MISSING", body.Code)
	}

	// Matching header -> passes to handler.
	req2 := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
	req2.Header.Set("Origin", "https://earflow.ru")
	req2.Header.Set("X-CSRF-Token", csrf)
	req2.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
	req2.AddCookie(&http.Cookie{Name: "mp_csrf", Value: csrf})
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, req2)
	if w2.Code == http.StatusForbidden {
		t.Fatalf("valid-csrf refresh blocked: %s", w2.Body.String())
	}
}

// TestCSRFGroupRejectsForgedHeader: an attacker who cannot read the csrf cookie
// cannot guess a matching token.
func TestCSRFGroupRejectsForgedHeader(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	sid := "sid_csrf2_123456789012345678"
	csrf, _ := GenerateCSRFToken(sid, csrfTestSecret)
	mr.Set("mp:sess:"+sid, marshalSessionForTest(t, Session{
		AccessToken:  makeAccessTokenForTest(t, csrfTestSecret, "1"),
		RefreshToken: "refresh",
		User:         json.RawMessage(`{"id":1}`),
	}))

	handler := csrfTestManager(mr, sid).CSRFProtectionMiddleware()(
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }),
	)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)
	req.Header.Set("Origin", "https://earflow.ru")
	req.Header.Set("X-CSRF-Token", "attacker-guessed")
	req.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
	req.AddCookie(&http.Cookie{Name: "mp_csrf", Value: csrf})
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("forged-csrf logout = %d, want 403", w.Code)
	}
}

// TestCSRFGroupBypassesSafeMethods: GET stays safe (no CSRF token required).
func TestCSRFGroupBypassesSafeMethods(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	handler := csrfTestManager(mr, "sid_csrf3_12345678901234567").CSRFProtectionMiddleware()(
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }),
	)

	req := httptest.NewRequest(http.MethodGet, "/api/profile", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusNoContent {
		t.Fatalf("GET = %d, want 204 (safe methods bypass CSRF)", w.Code)
	}
}
