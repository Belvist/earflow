package middleware

import (
	"net/http"
)

func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Cross-Origin-Resource-Policy", "cross-origin")
		next.ServeHTTP(w, r)
	})
}

func InternalHeaderSanitizer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := r.Header
		h.Del("X-User-Id")
		h.Del("X-User-ID")
		h.Del("x-user-id")
		h.Del("X-User-Name")
		h.Del("X-User-NAME")
		h.Del("x-user-name")
		h.Del("X-User-Role")
		h.Del("x-user-role")
		h.Del("X-Artist-Id")
		h.Del("X-Artist-ID")
		h.Del("x-artist-id")
		h.Del("X-Service-User")
		h.Del("x-service-user")
		h.Del("X-Service-Token")
		h.Del("X-Service-Name")
		h.Del("X-Internal-Token")
		h.Del("X-Correlation-Id")
		h.Del("X-Earflow-Upload-Context")
		next.ServeHTTP(w, r)
	})
}
