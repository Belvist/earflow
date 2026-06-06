// Package auth identifies the authenticated user behind every HTTP request.
//
// Two accepted shapes, checked in this order:
//  1. Headers injected by go-api-gateway: X-User-Id / X-User-Name. Gateway is
//     responsible for stripping any spoofed variants on ingress — we only trust
//     these when they arrive from the internal network.
//  2. A standalone JWT in Authorization: Bearer … (for tests / direct curls).
//
// The package never authenticates WebSocket upgrades — that is handled by the
// ticket layer in auth/ticket.go to keep sensitive JWTs out of URL query.
package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/earflow/music-platform/device-sync-service/internal/config"
	"github.com/golang-jwt/jwt/v5"
)

type ctxKey int

const userCtxKey ctxKey = 1

// User is the minimal identity we use throughout the service.
type User struct {
	ID        string
	Username  string
	SessionID string
}

var userIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

// Errors returned by Identify are intentionally opaque. HTTP layer maps them
// to 401.
var (
	ErrNoIdentity  = errors.New("no identity")
	ErrBadIdentity = errors.New("bad identity")
)

// Identify inspects the request and returns the authenticated User, if any.
// Pure function — no side effects.
func Identify(r *http.Request, cfg *config.Config) (*User, error) {
	if u := fromGateway(r, cfg); u != nil {
		return u, nil
	}
	if u := fromBearer(r, cfg); u != nil {
		return u, nil
	}
	return nil, ErrNoIdentity
}

func fromGateway(r *http.Request, cfg *config.Config) *User {
	uid := strings.TrimSpace(r.Header.Get(cfg.GatewayHeaderUserID))
	if uid == "" || !userIDRe.MatchString(uid) {
		return nil
	}
	name := sanitizeName(r.Header.Get(cfg.GatewayHeaderUser))
	if name == "" {
		name = "User"
	}
	sid := strings.TrimSpace(r.Header.Get(cfg.GatewayHeaderSession))
	if len(sid) > 128 {
		sid = sid[:128]
	}
	return &User{ID: uid, Username: name, SessionID: sid}
}

func fromBearer(r *http.Request, cfg *config.Config) *User {
	authz := r.Header.Get("Authorization")
	if !strings.HasPrefix(authz, "Bearer ") {
		return nil
	}
	token := strings.TrimSpace(strings.TrimPrefix(authz, "Bearer "))
	if token == "" {
		return nil
	}

	opts := []jwt.ParserOption{jwt.WithValidMethods([]string{"HS256"})}
	if cfg.JWTIssuer != "" {
		opts = append(opts, jwt.WithIssuer(cfg.JWTIssuer))
	}
	if cfg.JWTAudience != "" {
		opts = append(opts, jwt.WithAudience(cfg.JWTAudience))
	}
	parsed, err := jwt.Parse(token, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return cfg.JWTSecret, nil
	}, opts...)
	if err != nil || !parsed.Valid {
		return nil
	}
	claims, ok := parsed.Claims.(jwt.MapClaims)
	if !ok {
		return nil
	}

	// Standard JWTs often put `sub` in JSON as a number; MapClaims deserialise
	// that as float64. The gateway’s extractUserID handles both — mirror that
	// so Authorization: Bearer works for the same access tokens the gateway
	// forwards as X-User-Id.
	var id string
	for _, key := range []string{"id", "userId", "sub"} {
		if v, ok := claims[key]; ok {
			if s := stringifyClaimID(v); s != "" {
				id = s
				break
			}
		}
	}
	if id == "" || !userIDRe.MatchString(id) {
		return nil
	}

	var name string
	for _, key := range []string{"username", "name", "first_name"} {
		if v, ok := claims[key].(string); ok && v != "" {
			name = sanitizeName(v)
			break
		}
	}
	if name == "" {
		name = "User"
	}

	return &User{ID: id, Username: name}
}

// WithUser attaches u to ctx for downstream handlers.
func WithUser(ctx context.Context, u *User) context.Context {
	return context.WithValue(ctx, userCtxKey, u)
}

// FromContext extracts the authenticated user, or nil.
func FromContext(ctx context.Context) *User {
	if ctx == nil {
		return nil
	}
	u, _ := ctx.Value(userCtxKey).(*User)
	return u
}

// stringifyClaimID normalises jwt.MapClaims user id values to the same string
// form go-api-gateway uses for X-User-Id (see session_manager.extractUserID).
func stringifyClaimID(v interface{}) string {
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	case float64:
		return strings.TrimSpace(strings.TrimRight(strings.TrimRight(strconv.FormatFloat(t, 'f', -1, 64), "0"), "."))
	case json.Number:
		return strings.TrimSpace(string(t))
	default:
		return ""
	}
}

func sanitizeName(raw string) string {
	if raw == "" {
		return ""
	}
	out := make([]rune, 0, len(raw))
	for _, r := range raw {
		switch {
		case r == '\r' || r == '\n' || r == '\t':
			out = append(out, ' ')
		case r == '<' || r == '>':
			// strip bracket-like characters so a spoofed name cannot be
			// reflected into any log / HTML context.
		case r < 0x20:
			// drop other control characters silently
		default:
			out = append(out, r)
		}
	}
	s := strings.TrimSpace(string(out))
	if len(s) > 64 {
		s = s[:64]
	}
	return s
}
