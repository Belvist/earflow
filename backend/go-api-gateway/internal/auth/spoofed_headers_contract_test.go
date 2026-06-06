package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/earflow/music-platform/go-api-gateway/internal/httpx/middleware"
)

func TestSpoofedInternalHeadersStrippedBeforeAuthChain(t *testing.T) {
	spoofed := []string{
		"X-User-Id",
		"X-Artist-Id",
		"X-Service-User",
		"X-Service-Token",
	}

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, h := range spoofed {
			if got := r.Header.Get(h); got != "" {
				t.Fatalf("%s survived sanitizer with value %q", h, got)
			}
		}
		w.WriteHeader(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/profile", nil)
	for _, h := range spoofed {
		req.Header.Set(h, "attacker-controlled")
	}

	rec := httptest.NewRecorder()
	middleware.InternalHeaderSanitizer(next).ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
}

func TestSpoofedUserIDWithSessionCookieStillRequiresProof(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	sid := auditAuthenticatedSID
	manager := newProofTestManager(t, mr, sid, "adev_audit1234567890123456", "unused", 901)

	var downstreamUID string
	chain := middleware.InternalHeaderSanitizer(
		manager.SessionAuthMiddleware()(
			manager.DeviceProofMiddleware()(
				http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					downstreamUID = r.Header.Get("X-User-Id")
					w.WriteHeader(http.StatusOK)
				}),
			),
		),
	)

	req := httptest.NewRequest(http.MethodGet, "/api/profile", nil)
	req.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
	req.Header.Set("X-User-Id", "999999")
	req.Header.Set("X-Artist-Id", "888888")
	req.Header.Set("X-Service-User", "777777")

	rec := httptest.NewRecorder()
	chain.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 without proof", rec.Code)
	}
	if downstreamUID != "" {
		t.Fatalf("handler must not run without proof; downstream uid = %q", downstreamUID)
	}

	var body apiError
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body.Code != authCodeDeviceProofReq {
		t.Fatalf("code = %q, want %q", body.Code, authCodeDeviceProofReq)
	}
}

func TestSpoofedUserIDWithoutSessionDoesNotAuthenticate(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	manager := newProofTestManager(t, mr, auditAuthenticatedSID, "adev_audit1234567890123456", "unused", 901)

	chain := middleware.InternalHeaderSanitizer(
		manager.SessionAuthMiddleware()(
			manager.DeviceProofMiddleware()(
				http.HandlerFunc(manager.handleProfile()),
			),
		),
	)

	req := httptest.NewRequest(http.MethodGet, "/api/profile", nil)
	req.Header.Set("X-User-Id", "999999")
	req.Header.Set("X-Artist-Id", "888888")

	rec := httptest.NewRecorder()
	chain.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	var body apiError
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body.Code != authCodeNoSession {
		t.Fatalf("code = %q, want %q", body.Code, authCodeNoSession)
	}
}
