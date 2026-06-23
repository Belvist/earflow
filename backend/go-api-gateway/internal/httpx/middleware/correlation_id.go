package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"
)

const correlationHeader = "X-Correlation-Id"

func CorrelationID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cid := strings.TrimSpace(r.Header.Get(correlationHeader))
		if cid == "" {
			cid = strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
		}
		cid = normalizeCorrelationID(cid)
		if cid == "" {
			cid = newCorrelationID()
		}
		r.Header.Set(correlationHeader, cid)
		w.Header().Set(correlationHeader, cid)
		next.ServeHTTP(w, r)
	})
}

func normalizeCorrelationID(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	if len(s) < 8 || len(s) > 64 {
		return ""
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		isAZ := c >= 'a' && c <= 'z'
		isAZU := c >= 'A' && c <= 'Z'
		isNum := c >= '0' && c <= '9'
		if isAZ || isAZU || isNum || c == '-' || c == '_' {
			continue
		}
		return ""
	}
	return s
}

func newCorrelationID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
