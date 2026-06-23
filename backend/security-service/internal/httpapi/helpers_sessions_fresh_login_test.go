package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/earflow/music-platform/security-service/internal/authz"
	"github.com/earflow/music-platform/security-service/internal/config"
	"github.com/earflow/music-platform/security-service/internal/store"
	"github.com/redis/go-redis/v9"
)

func freshLoginTestDeps(t *testing.T, mr *miniredis.Miniredis) Deps {
	t.Helper()
	c := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	return Deps{
		Config: config.Config{
			Security: config.SecurityConfig{
				StepUpTTL: 5 * time.Minute,
			},
		},
		Redis:  store.RedisClientFromGoRedis(c),
		Logger: slog.Default(),
	}
}

func seedSessionMeta(t *testing.T, mr *miniredis.Miniredis, sid string, userID int64, createdAt time.Time) {
	t.Helper()
	meta, err := json.Marshal(map[string]any{
		"userId":    userID,
		"createdAt": createdAt.UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatal(err)
	}
	mr.Set(store.SIDKey(sid), "jti-fresh-login-test")
	mr.Set(store.SessionMetaKey(sid), string(meta))
	mr.SAdd(store.UserSidsKey(userID), sid)
}

func withPrincipal(req *http.Request, userID int64, sid string) *http.Request {
	principal := authz.Principal{UserID: userID, SID: sid}
	return req.WithContext(authz.WithPrincipal(req.Context(), principal))
}

func decodeErrorCode(t *testing.T, body []byte) string {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("decode body: %v raw=%s", err, string(body))
	}
	code, _ := payload["code"].(string)
	return code
}

func TestRevokeOthers_FreshSessionWithoutStepUp_ReturnsFreshLoginRequired(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	const (
		userID = int64(42)
		sid    = "sid_fresh_login_guard_test01"
	)
	seedSessionMeta(t, mr, sid, userID, time.Now().UTC())

	d := freshLoginTestDeps(t, mr)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/sessions/revoke-others", bytes.NewReader([]byte("{}")))
	req = withPrincipal(req, userID, sid)
	w := httptest.NewRecorder()

	revokeOtherSessionsHandler(d)(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	if got := decodeErrorCode(t, w.Body.Bytes()); got != "FRESH_LOGIN_REQUIRED" {
		t.Fatalf("code=%q want FRESH_LOGIN_REQUIRED", got)
	}
}

func TestRevokeOthers_FreshSessionWithStepUp_AllowsMassRevoke(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	const (
		userID = int64(42)
		sid    = "sid_fresh_login_guard_test02"
	)
	seedSessionMeta(t, mr, sid, userID, time.Now().UTC())

	d := freshLoginTestDeps(t, mr)
	if err := d.Redis.BumpStepUp(context.Background(), sid, userID, d.Config.Security.StepUpTTL); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/auth/sessions/revoke-others", bytes.NewReader([]byte("{}")))
	req = withPrincipal(req, userID, sid)
	w := httptest.NewRecorder()

	revokeOtherSessionsHandler(d)(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestRevokeOthers_MatureSessionWithoutStepUp_SkipsFreshLoginGuard(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	const (
		userID = int64(42)
		sid    = "sid_fresh_login_guard_test03"
	)
	seedSessionMeta(t, mr, sid, userID, time.Now().UTC().Add(-25*time.Hour))

	d := freshLoginTestDeps(t, mr)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/sessions/revoke-others", bytes.NewReader([]byte("{}")))
	req = withPrincipal(req, userID, sid)
	w := httptest.NewRecorder()

	revokeOtherSessionsHandler(d)(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}
