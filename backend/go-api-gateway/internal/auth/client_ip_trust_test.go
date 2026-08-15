package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientIPFromRequestPrefersXRealIP(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.5:1234"
	req.Header.Set("X-Forwarded-For", "6.6.6.6, 8.8.8.8")
	req.Header.Set("X-Real-IP", "8.8.8.8")
	if got := clientIPFromRequest(req); got != "8.8.8.8" {
		t.Fatalf("clientIP = %q, want 8.8.8.8 (X-Real-IP trusted)", got)
	}
}

func TestClientIPFromRequestUsesLastForwardedEntry(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.5:1234"
	// First entry is attacker-controlled; nginx appends the real client last.
	req.Header.Set("X-Forwarded-For", "6.6.6.6, 7.7.7.7, 8.8.8.8")
	if got := clientIPFromRequest(req); got != "8.8.8.8" {
		t.Fatalf("clientIP = %q, want 8.8.8.8 (last XFF entry trusted)", got)
	}
}

func TestClientIPFromRequestNeverTrustsFirstForwardedEntry(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.5:1234"
	req.Header.Set("X-Forwarded-For", "6.6.6.6, 8.8.8.8")
	if got := clientIPFromRequest(req); got == "6.6.6.6" {
		t.Fatal("clientIP must not use the attacker-controlled first XFF entry")
	}
}

func TestClientIPFromRequestFallsBackToRemoteAddr(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "203.0.113.7:4321"
	if got := clientIPFromRequest(req); got != "203.0.113.7" {
		t.Fatalf("clientIP = %q, want 203.0.113.7 (RemoteAddr)", got)
	}
}

func TestCopyClientMetadataHeadersRewritesForwardedIPs(t *testing.T) {
	src := httptest.NewRequest(http.MethodPost, "/api/auth/email/login", nil)
	src.RemoteAddr = "10.0.0.5:1234"
	src.Header.Set("X-Forwarded-For", "6.6.6.6, 8.8.8.8")
	src.Header.Set("X-Real-IP", "8.8.8.8")
	src.Header.Set("User-Agent", "test-ua")

	dst := httptest.NewRequest(http.MethodPost, "http://auth-service:3001/api/auth/email/login", nil)
	copyClientMetadataHeaders(dst, src)

	if got := dst.Header.Get("X-Forwarded-For"); got != "8.8.8.8" {
		t.Fatalf("X-Forwarded-For = %q, want 8.8.8.8 (single trusted value)", got)
	}
	if got := dst.Header.Get("X-Real-IP"); got != "8.8.8.8" {
		t.Fatalf("X-Real-IP = %q, want 8.8.8.8", got)
	}
	if got := dst.Header.Get("User-Agent"); got != "test-ua" {
		t.Fatalf("User-Agent = %q", got)
	}
}
