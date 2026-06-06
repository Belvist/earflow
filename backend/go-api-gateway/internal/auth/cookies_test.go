package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/earflow/music-platform/go-api-gateway/internal/config"
)

func testMainCookieNames() config.CookieNamesConfig {
	return config.CookieNamesConfig{Auth: "mp_auth", Refresh: "mp_refresh", SID: "mp_sid", CSRF: "mp_csrf"}
}

func testArtistCookieNames() config.CookieNamesConfig {
	return config.CookieNamesConfig{Auth: "mp_auth_artists", Refresh: "mp_refresh_artists", SID: "mp_sid_artists", CSRF: "mp_csrf_artists"}
}

func hasActiveCookie(headers []string, name string, value string) bool {
	prefix := name + "=" + value
	for _, h := range headers {
		if strings.HasPrefix(h, prefix+";") && !strings.Contains(h, "Max-Age=-1") {
			return true
		}
	}
	return false
}

func hasAnyActiveCookieNamed(headers []string, name string) bool {
	prefix := name + "="
	for _, h := range headers {
		if strings.HasPrefix(h, prefix) && !strings.Contains(h, "Max-Age=-1") {
			return true
		}
	}
	return false
}

func TestSetSessionCookies_MainDoesNotIssueArtistCookies(t *testing.T) {
	w := httptest.NewRecorder()
	cookie := config.CookieConfig{Domain: ".earflow.ru", SameSite: "none", Secure: true}

	SetSessionCookies(w, cookie, testMainCookieNames(), "sid_12345678901234567890", "csrf-token", 3600)

	headers := w.Result().Header.Values("Set-Cookie")
	if !hasActiveCookie(headers, "mp_sid", "sid_12345678901234567890") {
		t.Fatalf("expected active mp_sid cookie, got %v", headers)
	}
	if !hasActiveCookie(headers, "mp_csrf", "csrf-token") {
		t.Fatalf("expected active mp_csrf cookie, got %v", headers)
	}
	if hasActiveCookie(headers, "mp_sid_artists", "sid_12345678901234567890") {
		t.Fatalf("did not expect active artist SID cookie from main gateway, got %v", headers)
	}
	if hasActiveCookie(headers, "mp_csrf_artists", "csrf-token") {
		t.Fatalf("did not expect active artist CSRF cookie from main gateway, got %v", headers)
	}
}

func TestSetSessionCookies_ArtistDoesNotIssueMainCookies(t *testing.T) {
	w := httptest.NewRecorder()
	cookie := config.CookieConfig{Domain: ".artists.earflow.ru", SameSite: "none", Secure: true}

	SetSessionCookies(w, cookie, testArtistCookieNames(), "sid_12345678901234567890", "csrf-token", 3600)

	headers := w.Result().Header.Values("Set-Cookie")
	if !hasActiveCookie(headers, "mp_sid_artists", "sid_12345678901234567890") {
		t.Fatalf("expected active artist SID cookie, got %v", headers)
	}
	if !hasActiveCookie(headers, "mp_csrf_artists", "csrf-token") {
		t.Fatalf("expected active artist CSRF cookie, got %v", headers)
	}
	if hasActiveCookie(headers, "mp_sid", "sid_12345678901234567890") {
		t.Fatalf("did not expect active main SID cookie from artist gateway, got %v", headers)
	}
	if hasActiveCookie(headers, "mp_csrf", "csrf-token") {
		t.Fatalf("did not expect active main CSRF cookie from artist gateway, got %v", headers)
	}
}

func TestCSRFEnsureCookieMiddleware_DoesNotIssueAltCSRF(t *testing.T) {
	sid := "sid_12345678901234567890"
	m := &SessionManager{
		jwtSecret:   strings.Repeat("a", 32),
		cookie:      config.CookieConfig{Domain: ".earflow.ru", SameSite: "none", Secure: true},
		cookieNames: testMainCookieNames(),
		sessionTTL:  time.Hour,
	}

	req := httptest.NewRequest(http.MethodGet, "/api/profile", nil)
	req.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
	w := httptest.NewRecorder()

	handler := m.CSRFEnsureCookieMiddleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	handler.ServeHTTP(w, req)

	headers := w.Result().Header.Values("Set-Cookie")
	if !hasAnyActiveCookieNamed(headers, "mp_csrf") {
		t.Fatalf("expected active main CSRF cookie, got %v", headers)
	}
	if hasAnyActiveCookieNamed(headers, "mp_csrf_artists") {
		t.Fatalf("did not expect active artist CSRF cookie from main gateway, got %v", headers)
	}
}
