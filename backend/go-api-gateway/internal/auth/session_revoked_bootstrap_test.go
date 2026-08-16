package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/alicebob/miniredis/v2"
)

// TestSessionRevokedDoesNotBlockBootstrapRoutes: a browser still carrying a
// stale sid cookie (locally revoked: logout on another tab, deploy,
// revoke-sweep) must NOT receive 401 on anonymous bootstrap routes. Before
// this fix isSessionLocallyRevoked ran BEFORE the bypass list, so csrf /
// email login / telegram login / refresh / logout all returned 401 and the
// frontend could never bootstrap a csrf token to log back in (the observed
// "после выхода не заходит" loop — an endless 401 storm on /api/auth/csrf,
// /api/auth/device/register and /api/auth/telegram/login).
func TestSessionRevokedDoesNotBlockBootstrapRoutes(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	defer mr.Close()

	m := newContractManager(t, mr)
	sid := "sid_deaddeaddeaddeaddead"
	m.markSessionLocallyRevoked(sid, 1, "test")

	chain := m.SessionAuthMiddleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))

	bootstrap := []struct{ method, path string }{
		{http.MethodGet, "/api/auth/csrf"},
		{http.MethodPost, "/api/auth/email/login"},
		{http.MethodPost, "/api/auth/email/register"},
		{http.MethodPost, "/api/auth/telegram/login"},
		{http.MethodPost, "/api/auth/reset-password"},
		{http.MethodPost, "/api/auth/refresh"},
		{http.MethodPost, "/api/auth/logout"},
		{http.MethodGet, "/api/public-config"},
	}
	for _, rt := range bootstrap {
		req := httptestNewRequestWithCookie(rt.method, rt.path, sid)
		w := httptest.NewRecorder()
		chain.ServeHTTP(w, req)
		if w.Code == http.StatusUnauthorized {
			t.Fatalf("%s %s with a revoked sid cookie got 401; bootstrap routes must pass through to their self-guarded handlers", rt.method, rt.path)
		}
	}
}

// Protected /api paths with a locally revoked sid still 401 (the revoke
// mark keeps working where it matters).
func TestSessionRevokedStillBlocksProtectedRoutes(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	defer mr.Close()

	m := newContractManager(t, mr)
	sid := "sid_deaddeaddeaddeaddead"
	m.markSessionLocallyRevoked(sid, 1, "test")

	req := httptestNewRequestWithCookie(http.MethodGet, "/api/profile", sid)
	w := httptest.NewRecorder()
	chain := m.SessionAuthMiddleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))
	chain.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("/api/profile with a revoked sid = %d, want 401", w.Code)
	}
}
