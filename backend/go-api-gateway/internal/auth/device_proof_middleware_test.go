package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// DECISIONS 2026-08-13 + 2026-08-16: numeric/public-id song routes are the
// identity-free canonical-redirect chain. Browsers follow the nginx 301 as a
// document navigation and cannot attach X-Auth-Device-* headers, so PoP must
// not be enforced on these paths even when a valid session cookie is present.
func TestRedirectPublicPathsBypassDeviceProofWhenAuthenticated(t *testing.T) {
	manager := &SessionManager{isProduction: true}

	paths := []string{
		"/api/songs/redirect-public/755",
		"/api/songs/by-public-id/1f8214e8f8dc61e1",
	}
	for _, path := range paths {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req = req.WithContext(context.WithValue(req.Context(), ctxSID, "sid_12345678901234567890"))
		if manager.DeviceProofRequiredForRequest(req) {
			t.Fatalf("%s must NOT require device proof for authenticated requests", path)
		}
	}
}
