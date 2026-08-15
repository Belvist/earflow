package httpapi

import (
	"net/http/httptest"
	"testing"
)

func TestPickIPPrefersExplicitGatewayIP(t *testing.T) {
	r := httptest.NewRequest("POST", "/internal/auth/v1/sessions/upsert", nil)
	r.RemoteAddr = "172.18.0.4:52345"
	r.Header.Set("X-Forwarded-For", "6.6.6.6, 8.8.8.8")
	if got := pickIP("203.0.113.7", r); got != "203.0.113.7" {
		t.Fatalf("pickIP = %q, want 203.0.113.7 (gateway-resolved wins)", got)
	}
}

func TestPickIPRejectsNonIPExplicit(t *testing.T) {
	r := httptest.NewRequest("POST", "/internal/auth/v1/sessions/upsert", nil)
	r.RemoteAddr = "172.18.0.4:52345"
	if got := pickIP("", r); got != "172.18.0.4" {
		t.Fatalf("pickIP = %q, want 172.18.0.4 (port-stripped RemoteAddr fallback)", got)
	}
}

func TestClientIPNeverTrustsFirstForwardedEntry(t *testing.T) {
	r := httptest.NewRequest("POST", "/internal/auth/v1/sessions/upsert", nil)
	r.RemoteAddr = "172.18.0.4:52345"
	r.Header.Set("X-Forwarded-For", "6.6.6.6, 8.8.8.8")
	if got := clientIP(r); got != "8.8.8.8" {
		t.Fatalf("clientIP = %q, want 8.8.8.8 (last XFF entry)", got)
	}
}

func TestClientIPStripsPortFromRemoteAddr(t *testing.T) {
	r := httptest.NewRequest("POST", "/internal/auth/v1/sessions/upsert", nil)
	r.RemoteAddr = "172.18.0.4:52345"
	if got := clientIP(r); got != "172.18.0.4" {
		t.Fatalf("clientIP = %q, want 172.18.0.4", got)
	}
}
