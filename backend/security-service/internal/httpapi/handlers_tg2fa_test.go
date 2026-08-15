package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/earflow/music-platform/security-service/internal/config"
	"github.com/earflow/music-platform/security-service/internal/store"
	"github.com/earflow/music-platform/security-service/internal/tgcode"
)

// tgDeps builds Deps with TelegramClient pointing at a stub HTTP server so
// sendMessage/deleteMessage go nowhere real (or to httptest if configured).
func tgTestDeps(t *testing.T) Deps {
	t.Helper()
	d := testDeps(t)
	d.Config.Telegram = config.TelegramConfig{
		BotToken:            "test:token",
		Tg2faTTL:            5 * time.Minute,
		Tg2faMaxAttempts:    5,
		Tg2faAttemptWindow:  60 * time.Second,
		Tg2faCodeLength:     6,
		Tg2faResendCooldown: 30 * time.Second,
	}
	d.TelegramClient = tgcode.NewClient("test:token")
	// Stub out the HTTP transport so tests never hit api.telegram.org.
	d.TelegramClient.SetTransport(stubTransport())
	d.Users = fakeUserLookup{}
	return d
}

// fakeUserLookup returns a user with a linked telegram for userID 7.
type fakeUserLookup struct{}

func (fakeUserLookup) GetUserByID(ctx context.Context, userID int64) (*store.User, error) {
	if userID != 7 {
		return nil, store.ErrUserNotFound
	}
	telegramID := int64(111)
	return &store.User{ID: userID, TelegramID: &telegramID}, nil
}

func stubTransport() http.RoundTripper {
	return roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		body := `{"ok":true,"result":{"message_id":42}}`
		return stubResponse(body), nil
	})
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func stubResponse(body string) *http.Response {
	return &http.Response{
		StatusCode: http.StatusOK,
		Status:     "200 OK",
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     make(http.Header),
	}
}

func TestTg2faStatusWithTelegram(t *testing.T) {
	d := tgTestDeps(t)
	w := httptest.NewRecorder()
	r := authedRequest(t, http.MethodGet, "/api/auth/tg2fa/status", 7, "sid_12345678901234567890", nil)
	tg2faStatusHandler(d)(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var resp tg2faStatusResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if !resp.OK || !resp.Enabled || !resp.HasTelegram {
		t.Fatalf("unexpected response: %s", w.Body.String())
	}
}

func TestTg2faDisabledWithoutToken(t *testing.T) {
	d := testDeps(t) // TelegramClient nil
	d.Users = fakeUserLookup{}
	w := httptest.NewRecorder()
	r := authedRequest(t, http.MethodGet, "/api/auth/tg2fa/status", 7, "sid_12345678901234567890", nil)
	tg2faStatusHandler(d)(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var resp tg2faStatusResponse
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Enabled {
		t.Fatalf("feature must be disabled without token: %s", w.Body.String())
	}
}

func TestTg2faSendSucceedsForLinkedUser(t *testing.T) {
	d := tgTestDeps(t)
	body, _ := json.Marshal(map[string]any{"purpose": "login"})
	w := httptest.NewRecorder()
	r := authedRequest(t, http.MethodPost, "/api/auth/tg2fa/send", 7, "sid_12345678901234567890", body)
	tg2faSendHandler(d)(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var resp tg2faSendResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if !resp.OK || resp.TTLSeconds <= 0 {
		t.Fatalf("unexpected response: %s", w.Body.String())
	}

	// A pending code must be stored.
	rec, err := d.Redis.GetTg2faCode(context.Background(), 7)
	if err != nil {
		t.Fatal(err)
	}
	if rec == nil || rec.MessageID != 42 || rec.ChatID != 111 {
		t.Fatalf("pending code not stored correctly: %+v", rec)
	}
	if len(rec.Code) != 6 {
		t.Fatalf("code length=%d want 6", len(rec.Code))
	}
}

func TestTg2faSendRequiresTelegramLinked(t *testing.T) {
	d := tgTestDeps(t)
	// userID 99 is not found by the fake store → 404 USER_NOT_FOUND.
	body, _ := json.Marshal(map[string]any{"purpose": "login"})
	w := httptest.NewRecorder()
	r := authedRequest(t, http.MethodPost, "/api/auth/tg2fa/send", 99, "sid_12345678901234567890", body)
	tg2faSendHandler(d)(w, r)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestTg2faVerifyNoPendingCode(t *testing.T) {
	d := tgTestDeps(t)
	body, _ := json.Marshal(map[string]any{"code": "123456"})
	w := httptest.NewRecorder()
	r := authedRequest(t, http.MethodPost, "/api/auth/tg2fa/verify", 7, "sid_12345678901234567890", body)
	tg2faVerifyHandler(d)(w, r)
	if w.Code != http.StatusConflict {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestTg2faVerifyValidCodeGrantsStepUp(t *testing.T) {
	d := tgTestDeps(t)
	const sid = "sid_12345678901234567890"
	const userID = int64(7)
	const code = "123456"
	if err := d.Redis.SetTg2faCode(context.Background(), userID, store.Tg2faRecord{
		Code:      code,
		ChatID:    111,
		MessageID: 42,
		UserID:    userID,
		CreatedAt: time.Now().UTC(),
	}, 5*time.Minute); err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]any{"code": code})
	w := httptest.NewRecorder()
	r := authedRequest(t, http.MethodPost, "/api/auth/tg2fa/verify", userID, sid, body)
	tg2faVerifyHandler(d)(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}

	st, err := d.Redis.GetStepUpStatus(context.Background(), sid)
	if err != nil {
		t.Fatal(err)
	}
	if !st.OK || st.UserID != userID {
		t.Fatalf("step-up not granted: %+v", st)
	}

	// Code must be consumed.
	rec, err := d.Redis.GetTg2faCode(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}
	if rec != nil {
		t.Fatalf("code should be cleared after verify")
	}
}

func TestTg2faVerifyWrongCode(t *testing.T) {
	d := tgTestDeps(t)
	const userID = int64(7)
	if err := d.Redis.SetTg2faCode(context.Background(), userID, store.Tg2faRecord{
		Code:      "654321",
		ChatID:    111,
		MessageID: 42,
		UserID:    userID,
		CreatedAt: time.Now().UTC(),
	}, 5*time.Minute); err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]any{"code": "123456"})
	w := httptest.NewRecorder()
	r := authedRequest(t, http.MethodPost, "/api/auth/tg2fa/verify", userID, "sid_12345678901234567890", body)
	tg2faVerifyHandler(d)(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}

	// Code must survive a failed attempt.
	rec, err := d.Redis.GetTg2faCode(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}
	if rec == nil || rec.Code != "654321" {
		t.Fatalf("code should survive wrong attempt")
	}
}

func TestTg2faVerifyRateLimited(t *testing.T) {
	d := tgTestDeps(t)
	const userID = int64(7)
	if err := d.Redis.SetTg2faCode(context.Background(), userID, store.Tg2faRecord{
		Code:      "111111",
		ChatID:    111,
		MessageID: 42,
		UserID:    userID,
		CreatedAt: time.Now().UTC(),
	}, 5*time.Minute); err != nil {
		t.Fatal(err)
	}

	// Burn through the attempt budget with wrong codes.
	for i := 0; i < d.Config.Telegram.Tg2faMaxAttempts; i++ {
		body, _ := json.Marshal(map[string]any{"code": "000000"})
		w := httptest.NewRecorder()
		r := authedRequest(t, http.MethodPost, "/api/auth/tg2fa/verify", userID, "sid_12345678901234567890", body)
		tg2faVerifyHandler(d)(w, r)
		if w.Code != http.StatusForbidden {
			t.Fatalf("attempt %d status=%d body=%s", i, w.Code, w.Body.String())
		}
	}

	// The next attempt must be rate-limited (even with the right code).
	body, _ := json.Marshal(map[string]any{"code": "111111"})
	w := httptest.NewRecorder()
	r := authedRequest(t, http.MethodPost, "/api/auth/tg2fa/verify", userID, "sid_12345678901234567890", body)
	tg2faVerifyHandler(d)(w, r)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}
