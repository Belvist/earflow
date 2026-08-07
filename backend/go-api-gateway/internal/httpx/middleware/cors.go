package middleware

import (
	"net/http"
	"strings"
)

type CORSConfig struct {
	AllowedOrigins []string
}

func CORS(cfg CORSConfig) func(http.Handler) http.Handler {
	allowed := make(map[string]struct{}, len(cfg.AllowedOrigins))
	for _, o := range cfg.AllowedOrigins {
		allowed[o] = struct{}{}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := strings.TrimSpace(r.Header.Get("Origin"))
			if origin != "" {
				if _, ok := allowed[origin]; ok {
					w.Header().Set("Access-Control-Allow-Origin", origin)
					w.Header().Set("Vary", "Origin")
					w.Header().Set("Access-Control-Allow-Credentials", "true")
					w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,PATCH,OPTIONS")
					// PoP headers (PEND-SEC-001): required for cross-origin API (auth.earflow.ru → api.earflow.ru).
					w.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization,X-CSRF-Token,X-Correlation-ID,Cache-Control,Pragma,Range,If-Range,Idempotency-Key,X-Auth-Device-Id,X-Auth-Device-Proof,X-Auth-Device-Proof-Ts,X-Auth-Device-Proof-Nonce,X-Auth-Proof-Access-Token")
					w.Header().Set("Access-Control-Expose-Headers", "X-Correlation-Id,Content-Length,Content-Range")
					w.Header().Set("Access-Control-Max-Age", "600")
				}
			}

			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
