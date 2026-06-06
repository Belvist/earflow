package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestInternalHeaderSanitizerStripsClientControlledInternalHeaders(t *testing.T) {
	protected := []string{
		"X-User-Id",
		"X-User-ID",
		"x-user-id",
		"X-User-Name",
		"X-User-NAME",
		"x-user-name",
		"X-User-Role",
		"x-user-role",
		"X-Artist-Id",
		"X-Artist-ID",
		"x-artist-id",
		"X-Service-User",
		"x-service-user",
		"X-Service-Token",
		"X-Service-Name",
		"X-Internal-Token",
		"X-Correlation-Id",
		"X-Earflow-Upload-Context",
	}

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, header := range protected {
			if got := r.Header.Get(header); got != "" {
				t.Fatalf("%s survived sanitizer with value %q", header, got)
			}
		}
		w.WriteHeader(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodPost, "/api/upload/song", nil)
	for _, header := range protected {
		req.Header.Set(header, "spoofed")
	}

	rec := httptest.NewRecorder()
	InternalHeaderSanitizer(next).ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}
}
