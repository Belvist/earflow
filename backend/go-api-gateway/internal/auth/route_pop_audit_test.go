package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/earflow/music-platform/go-api-gateway/internal/config"
)

const auditAuthenticatedSID = "sid_audit123456789012345"

var authHandlerProtectedPaths = []string{
	"/api/profile",
	"/api/auth/profile",
	"/api/auth/sessions",
	"/api/auth/logout",
	"/api/log/error",
}

func TestGatewayYAMLProtectedAPIRoutesRequireDeviceProof(t *testing.T) {
	cfg, err := config.LoadGatewayYAML(filepath.Join("..", "..", "gateway.yaml"))
	if err != nil {
		t.Fatal(err)
	}

	manager := &SessionManager{isProduction: true}
	bypass := DeviceProofBypassPaths()

	for _, route := range cfg.Routes {
		if !route.Policies.RequireUser {
			continue
		}
		if route.Policies.WebSocket {
			continue
		}
		class := strings.ToLower(strings.TrimSpace(route.Policies.Class))
		if class == "public" {
			continue
		}

		path := samplePathForRoute(t, route)
		if !strings.HasPrefix(path, "/api") {
			continue
		}
		if _, exempt := bypass[path]; exempt {
			t.Fatalf("gateway route %q sample path %q must not be in DeviceProofBypassPaths", route.ID, path)
		}

		req := httptest.NewRequest(http.MethodGet, path, nil)
		req = req.WithContext(context.WithValue(req.Context(), ctxSID, auditAuthenticatedSID))
		if !manager.DeviceProofRequiredForRequest(req) {
			t.Fatalf("gateway route %q (require_user) sample path %q must require device proof when session is authenticated", route.ID, path)
		}
	}
}

func TestAuthHandlerProtectedPathsRequireDeviceProof(t *testing.T) {
	manager := &SessionManager{isProduction: true}
	for _, path := range authHandlerProtectedPaths {
		method := http.MethodGet
		if path == "/api/log/error" || path == "/api/auth/logout" {
			method = http.MethodPost
		}
		req := httptest.NewRequest(method, path, nil)
		req = req.WithContext(context.WithValue(req.Context(), ctxSID, auditAuthenticatedSID))
		if !manager.DeviceProofRequiredForRequest(req) {
			t.Fatalf("auth handler path %q must require device proof when session is authenticated", path)
		}
	}
}

func TestProtectedAPIWithoutProofReturns401(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	sid := auditAuthenticatedSID
	manager := newProofTestManager(t, mr, sid, "adev_audit1234567890123456", "unused", 42)

	paths := []string{
		"/api/profile",
		"/api/auth/sessions",
		"/api/playlists",
		"/api/devices",
	}
	chain := manager.SessionAuthMiddleware()(manager.DeviceProofMiddleware()(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})))

	for _, path := range paths {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
		w := httptest.NewRecorder()
		chain.ServeHTTP(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("%s cookie-only status = %d, want 401", path, w.Code)
		}
		var body apiError
		_ = json.Unmarshal(w.Body.Bytes(), &body)
		if body.Code != authCodeDeviceProofReq {
			t.Fatalf("%s code = %q, want %q", path, body.Code, authCodeDeviceProofReq)
		}
	}
}

func samplePathForRoute(t *testing.T, route config.Route) string {
	t.Helper()
	switch strings.ToLower(string(route.Match.Type)) {
	case "exact":
		return route.Match.Value
	case "prefix":
		v := strings.TrimSpace(route.Match.Value)
		if v == "/api/auth/sessions" {
			return v
		}
		if strings.HasSuffix(v, "/") {
			return v + "audit-sample"
		}
		return v + "/audit-sample"
	case "regex":
		return regexSamplePath(t, route.Match.Value)
	default:
		t.Fatalf("route %q: unsupported match type %q", route.ID, route.Match.Type)
		return ""
	}
}

func regexSamplePath(t *testing.T, pattern string) string {
	t.Helper()
	switch pattern {
	case `^/api/stream/v3/session/[^/]+/refresh$`:
		return "/api/stream/v3/session/sid-audit/refresh"
	default:
		re, err := regexp.Compile(pattern)
		if err != nil {
			t.Fatalf("compile regex %q: %v", pattern, err)
		}
		candidates := []string{
			"/api/stream/v3/session/sid-audit/refresh",
			"/api/audit/sample",
		}
		for _, c := range candidates {
			if re.MatchString(c) {
				return c
			}
		}
		t.Fatalf("no sample path for regex %q", pattern)
		return ""
	}
}
