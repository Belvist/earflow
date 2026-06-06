package authz

import (
	"crypto/subtle"
	"net/http"
	"strings"
)

// ServiceKeyMiddleware gates internal routes (gateway → security-service).
func ServiceKeyMiddleware(expectedKey string) func(http.Handler) http.Handler {
	key := []byte(strings.TrimSpace(expectedKey))
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if len(key) == 0 {
				http.Error(w, `{"error":"internal auth disabled","code":"INTERNAL_AUTH_DISABLED"}`, http.StatusServiceUnavailable)
				return
			}
			got := []byte(strings.TrimSpace(r.Header.Get("X-Service-Token")))
			if len(got) == 0 || subtle.ConstantTimeCompare(got, key) != 1 {
				http.Error(w, `{"error":"unauthorized","code":"INVALID_SERVICE_TOKEN"}`, http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
