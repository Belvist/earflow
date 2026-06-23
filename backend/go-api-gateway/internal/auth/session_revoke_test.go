package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/earflow/music-platform/go-api-gateway/internal/config"
	"github.com/redis/go-redis/v9"
)

func testCookieConfig() config.CookieConfig {
	return config.CookieConfig{Secure: false, SameSite: "lax"}
}

func httptestNewRequestWithCookie(method, path, sid string) *http.Request {
	req := httptest.NewRequest(method, path, nil)
	req.Header.Set("Origin", "https://earflow.ru")
	req.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
	return req
}

func TestRevokeSessionFullClearsGatewayAndAuthKeys(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	defer mr.Close()

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	ctx := context.Background()
	sid := "sid_12345678901234567890"
	jti := "jti-test-001"
	userID := int64(42)

	mr.Set(authSIDKey(sid), jti)
	mr.Set(authRefreshKey(jti), `{"userId":42}`)
	mr.Set(authSessionMetaKey(sid), `{"userId":42,"createdAt":"2026-01-01T00:00:00Z"}`)
	mr.Set("mp:sess:"+sid, `{"accessToken":"a","refreshToken":"r"}`)
	mr.Set(authStepUpKey(sid), `{"userId":42}`)
	mr.Set(authGraceKey(jti), "1")
	mr.SAdd("auth:user_sids:42", sid)

	if err := RevokeSessionFull(ctx, rdb, "mp:sess:", sid, userID, jti); err != nil {
		t.Fatalf("RevokeSessionFull: %v", err)
	}

	for _, key := range []string{
		authSIDKey(sid),
		authRefreshKey(jti),
		authSessionMetaKey(sid),
		"mp:sess:" + sid,
		authStepUpKey(sid),
		authGraceKey(jti),
	} {
		if mr.Exists(key) {
			t.Fatalf("expected key removed: %s", key)
		}
	}
	if ok, _ := mr.SIsMember("auth:user_sids:42", sid); ok {
		t.Fatalf("expected sid removed from user index")
	}
}

func TestHandleLogoutRevokesProfileAccess(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	defer mr.Close()

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	secret := "test-secret-test-secret-test-secret-32"
	sid := "sid_12345678901234567890"
	jti := "jti-logout-001"
	access := makeAccessTokenForTest(t, secret, "7")
	sessJSON := marshalSessionForTest(t, Session{
		AccessToken:  access,
		RefreshToken: "refresh-token",
		User:         json.RawMessage(`{"id":7,"userId":7}`),
	})

	mr.Set("mp:sess:"+sid, sessJSON)
	mr.Set(authSIDKey(sid), jti)
	mr.Set(authRefreshKey(jti), `{"userId":7,"sid":"`+sid+`"}`)

	manager := &SessionManager{
		store:                &SessionStore{rdb: redisSessionKV{rdb: rdb}, keyPrefix: "mp:sess:", ttl: time.Hour},
		rdb:                  rdb,
		gatewaySessionPrefix: "mp:sess:",
		jwtSecret:            secret,
		jwtIssuer:            "",
		jwtAudience:          "",
		cookie:               testCookieConfig(),
		cookieNames:          testMainCookieNames(),
		sessionTTL:           time.Hour,
		allowedOrigins:       map[string]struct{}{"https://earflow.ru": {}},
	}

	logoutReq := httptestNewRequestWithCookie(http.MethodPost, "/api/auth/logout", sid)
	logoutRec := httptest.NewRecorder()
	manager.handleLogout()(logoutRec, logoutReq)
	if logoutRec.Code != http.StatusNoContent {
		t.Fatalf("logout status = %d", logoutRec.Code)
	}

	profileReq := httptestNewRequestWithCookie(http.MethodGet, "/api/profile", sid)
	profileRec := httptest.NewRecorder()
	manager.SessionAuthMiddleware()(http.HandlerFunc(manager.handleProfile())).ServeHTTP(profileRec, profileReq)
	if profileRec.Code != http.StatusUnauthorized {
		t.Fatalf("profile after logout = %d, want 401", profileRec.Code)
	}
}
