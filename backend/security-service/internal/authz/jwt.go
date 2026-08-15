package authz

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

type ctxKey int

const (
	ctxKeyPrincipal ctxKey = iota
)

// Principal is the authenticated caller derived from the access JWT.
type Principal struct {
	UserID  int64
	SID     string
	IsAdmin bool
	RawToken string
}

// Verifier parses and validates the access JWT.
type Verifier struct {
	Secret   []byte
	Issuer   string
	Audience string
}

// ErrUnauthorized is returned when the token is missing or invalid.
var ErrUnauthorized = errors.New("unauthorized")

// Verify parses the bearer token and returns the principal or ErrUnauthorized.
func (v Verifier) Verify(authorizationHeader string) (Principal, error) {
	raw := strings.TrimSpace(authorizationHeader)
	if raw == "" {
		return Principal{}, ErrUnauthorized
	}
	if !strings.HasPrefix(strings.ToLower(raw), "bearer ") {
		return Principal{}, ErrUnauthorized
	}
	token := strings.TrimSpace(raw[len("Bearer "):])
	if token == "" {
		return Principal{}, ErrUnauthorized
	}

	parser := jwt.NewParser(jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired())
	claims := jwt.MapClaims{}
	_, err := parser.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
		return v.Secret, nil
	})
	if err != nil {
		return Principal{}, ErrUnauthorized
	}

	if tp, ok := claims["type"]; ok {
		if s, ok := tp.(string); ok && s != "access" {
			return Principal{}, ErrUnauthorized
		}
	}

	if !verifyIssuer(claims, v.Issuer) {
		return Principal{}, ErrUnauthorized
	}
	if !verifyAudience(claims, v.Audience) {
		return Principal{}, ErrUnauthorized
	}

	userID := extractUserID(claims)
	if userID <= 0 {
		return Principal{}, ErrUnauthorized
	}

	sid, _ := claims["sid"].(string)
	sid = strings.TrimSpace(sid)
	if sid == "" {
		return Principal{}, ErrUnauthorized
	}

	isAdmin := false
	if v, ok := claims["isAdmin"].(bool); ok {
		isAdmin = v
	}

	return Principal{
		UserID:   userID,
		SID:      sid,
		IsAdmin:  isAdmin,
		RawToken: token,
	}, nil
}

// Middleware enforces a valid access JWT on every request.
func (v Verifier) Middleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			principal, err := v.Verify(r.Header.Get("Authorization"))
			if err != nil {
				writeUnauthorized(w)
				return
			}
			ctx := context.WithValue(r.Context(), ctxKeyPrincipal, principal)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// FromContext returns the principal set by Middleware.
func FromContext(ctx context.Context) (Principal, bool) {
	p, ok := ctx.Value(ctxKeyPrincipal).(Principal)
	return p, ok
}

func writeUnauthorized(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte(`{"error":"Authentication required","code":"UNAUTHORIZED"}`))
}

func verifyIssuer(claims jwt.MapClaims, expected string) bool {
	expected = strings.TrimSpace(expected)
	if expected == "" {
		return true
	}
	got, _ := claims["iss"].(string)
	return strings.TrimSpace(got) == expected
}

func verifyAudience(claims jwt.MapClaims, expected string) bool {
	expected = strings.TrimSpace(expected)
	if expected == "" {
		return true
	}
	aud := claims["aud"]
	switch v := aud.(type) {
	case string:
		return strings.TrimSpace(v) == expected
	case []any:
		for _, it := range v {
			if s, ok := it.(string); ok && strings.TrimSpace(s) == expected {
				return true
			}
		}
	case []string:
		for _, s := range v {
			if strings.TrimSpace(s) == expected {
				return true
			}
		}
	}
	return false
}

func extractUserID(claims jwt.MapClaims) int64 {
	if claims == nil {
		return 0
	}
	for _, k := range []string{"userId", "user_id", "id", "sub"} {
		if raw, ok := claims[k]; ok {
			switch v := raw.(type) {
			case float64:
				if v > 0 {
					return int64(v)
				}
			case int:
				if v > 0 {
					return int64(v)
				}
			case int64:
				if v > 0 {
					return v
				}
			case string:
				if v == "" {
					continue
				}
				var out int64
				for i := 0; i < len(v); i++ {
					ch := v[i]
					if ch < '0' || ch > '9' {
						return 0
					}
					out = out*10 + int64(ch-'0')
					if out < 0 {
						return 0
					}
				}
				if out > 0 {
					return out
				}
			}
		}
	}
	return 0
}
