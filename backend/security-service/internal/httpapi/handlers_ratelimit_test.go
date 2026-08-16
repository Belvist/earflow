package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/earflow/music-platform/security-service/internal/store"
)

func TestRevokeSessionRateLimited(t *testing.T) {
	d := testDeps(t)
	if err := d.Redis.Client().Set(context.Background(), store.SessionActionsKey(7), "5", 0).Err(); err != nil {
		t.Fatal(err)
	}
	body := []byte(`{"sid":"sid_other"}`)
	w := httptest.NewRecorder()
	r := authedRequest(t, http.MethodPost, "/api/auth/sessions/revoke", 7, "sid_12345678901234567890", body)
	revokeSessionHandler(d)(w, r)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "RATE_LIMITED") {
		t.Fatalf("expected RATE_LIMITED code, got %s", w.Body.String())
	}
}

func TestRevokeOthersRateLimited(t *testing.T) {
	d := testDeps(t)
	if err := d.Redis.Client().Set(context.Background(), store.SessionActionsKey(7), "5", 0).Err(); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	r := authedRequest(t, http.MethodPost, "/api/auth/sessions/revoke-others", 7, "sid_12345678901234567890", nil)
	revokeOtherSessionsHandler(d)(w, r)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestRevokeAllRateLimited(t *testing.T) {
	d := testDeps(t)
	if err := d.Redis.Client().Set(context.Background(), store.SessionActionsKey(7), "5", 0).Err(); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	r := authedRequest(t, http.MethodPost, "/api/auth/sessions/revoke-all", 7, "sid_12345678901234567890", nil)
	revokeAllSessionsHandler(d)(w, r)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestTelegramUnlinkRateLimited(t *testing.T) {
	d := testDeps(t)
	if err := d.Redis.Client().Set(context.Background(), store.SessionActionsKey(7), "5", 0).Err(); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	r := authedRequest(t, http.MethodPost, "/api/auth/telegram/unlink", 7, "sid_12345678901234567890", nil)
	telegramUnlinkHandler(d)(w, r)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}
