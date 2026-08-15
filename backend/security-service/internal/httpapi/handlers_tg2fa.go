package httpapi

import (
	"context"
	"crypto/subtle"
	"net/http"
	"strings"
	"time"

	"github.com/earflow/music-platform/security-service/internal/authz"
	"github.com/earflow/music-platform/security-service/internal/store"
	"github.com/earflow/music-platform/security-service/internal/tgcode"
)

// usersFor returns the user lookup backend, defaulting to Postgres.
func (d Deps) usersFor() UserLookup {
	if d.Users != nil {
		return d.Users
	}
	return d.Postgres
}

type tg2faStatusResponse struct {
	OK             bool  `json:"ok"`
	HasTelegram    bool  `json:"hasTelegram"`
	CodeSent       bool  `json:"codeSent"`
	TTLSeconds     int64 `json:"ttlSeconds,omitempty"`
	Enabled        bool  `json:"enabled"`
	ResendCooldown int64 `json:"resendCooldownSeconds,omitempty"`
}

type tg2faSendRequest struct {
	Purpose string `json:"purpose"`
}

type tg2faSendResponse struct {
	OK         bool  `json:"ok"`
	TTLSeconds int64 `json:"ttlSeconds"`
}

type tg2faVerifyRequest struct {
	Code string `json:"code"`
}

type tg2faVerifyResponse struct {
	OK bool `json:"ok"`
}

// tg2faCodeMessage builds the human-readable code message for a user.
func tg2faCodeMessage(code, purpose string, ttl time.Duration) string {
	purposeText := "подтверждения"
	switch strings.ToLower(strings.TrimSpace(purpose)) {
	case "login":
		purposeText = "входа на новом устройстве"
	case "step_up", "stepup":
		purposeText = "подтверждения действия"
	}
	minutes := int(ttl.Minutes())
	return "Код " + purposeText + ": " + code + "\n" +
		"Действителен " + formatTgMinutes(minutes) + " минут. Никому не сообщайте код."
}

func formatTgMinutes(m int) string {
	switch {
	case m <= 1:
		return "1"
	case m%10 >= 2 && m%10 <= 4 && (m%100 < 10 || m%100 >= 20):
		return "2–4"
	default:
		return "5"
	}
}

func tg2faSendHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tg := d.TelegramClient
		if tg == nil || !tg.Enabled() {
			writeError(w, http.StatusServiceUnavailable, "TELEGRAM_CODES_DISABLED", "Telegram confirmation codes are not enabled")
			return
		}

		principal, ok := authz.FromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
			return
		}

		user, err := d.usersFor().GetUserByID(r.Context(), principal.UserID)
		if err != nil {
			if err == store.ErrUserNotFound {
				writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "User not found")
				return
			}
			d.Logger.Error("tg2fa-send: get user failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}
		if !user.HasTelegram() {
			writeError(w, http.StatusConflict, "TELEGRAM_NOT_LINKED", "Telegram not linked")
			return
		}

		var req tg2faSendRequest
		if err := readJSON(r, d.Config.HTTP.MaxBodyBytes, &req); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_BODY", "Invalid request body")
			return
		}

		ttl := d.Config.Telegram.Tg2faTTL
		if ttl <= 0 {
			ttl = 5 * time.Minute
		}

		// Resend cooldown to avoid hammering the bot API.
		cooldown := d.Config.Telegram.Tg2faResendCooldown
		if cooldown <= 0 {
			cooldown = 30 * time.Second
		}
		if res, err := d.Redis.IncrRateLimit(r.Context(), store.Tg2faResendKey(principal.UserID), 1, cooldown); err == nil && res.Blocked {
			writeError(w, http.StatusTooManyRequests, "RESEND_COOLDOWN", "Wait before requesting a new code")
			return
		}

		code, err := tgcode.GenerateCode(d.Config.Telegram.Tg2faCodeLength)
		if err != nil {
			d.Logger.Error("tg2fa-send: code generation failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}

		// Delete a previous pending message so codes do not pile up.
		if prev, err := d.Redis.GetTg2faCode(r.Context(), principal.UserID); err == nil && prev != nil && prev.MessageID > 0 {
			_ = tg.DeleteMessage(r.Context(), prev.ChatID, prev.MessageID)
		}

		chatID := *user.TelegramID
		msgID, err := tg.SendCode(r.Context(), chatID, tg2faCodeMessage(code, req.Purpose, ttl))
		if err != nil {
			d.Logger.Error("tg2fa-send: send failed", "err", err, "userId", principal.UserID)
			writeError(w, http.StatusServiceUnavailable, "TELEGRAM_SEND_FAILED", "Failed to deliver code")
			return
		}

		if err := d.Redis.SetTg2faCode(r.Context(), principal.UserID, store.Tg2faRecord{
			Code:      code,
			ChatID:    chatID,
			MessageID: msgID,
			UserID:    principal.UserID,
			CreatedAt: time.Now().UTC(),
		}, ttl); err != nil {
			d.Logger.Error("tg2fa-send: store failed", "err", err, "userId", principal.UserID)
			_ = tg.DeleteMessage(r.Context(), chatID, msgID)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}

		// Auto-delete the message once the code expires.
		time.AfterFunc(ttl, func() {
			ctx, cancel := contextWithTimeout(r.Context(), 5*time.Second)
			defer cancel()
			_ = tg.DeleteMessage(ctx, chatID, msgID)
			_ = d.Redis.DelTg2faCode(ctx, principal.UserID)
		})

		writeJSON(w, http.StatusOK, tg2faSendResponse{OK: true, TTLSeconds: int64(ttl.Seconds())})
	}
}

func tg2faVerifyHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tg := d.TelegramClient
		if tg == nil || !tg.Enabled() {
			writeError(w, http.StatusServiceUnavailable, "TELEGRAM_CODES_DISABLED", "Telegram confirmation codes are not enabled")
			return
		}

		principal, ok := authz.FromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
			return
		}

		var req tg2faVerifyRequest
		if err := readJSON(r, d.Config.HTTP.MaxBodyBytes, &req); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_BODY", "Invalid request body")
			return
		}
		req.Code = strings.TrimSpace(req.Code)
		if req.Code == "" {
			writeError(w, http.StatusBadRequest, "INVALID_CODE", "Code is required")
			return
		}

		window := d.Config.Telegram.Tg2faAttemptWindow
		max := d.Config.Telegram.Tg2faMaxAttempts
		if window <= 0 {
			window = 60 * time.Second
		}
		if max <= 0 {
			max = 5
		}
		if res, err := d.Redis.IncrRateLimit(r.Context(), store.Tg2faAttemptsKey(principal.UserID), max, window); err == nil && res.Blocked {
			writeRetry(w, res.RetryAfterSecs, "Too many attempts. Try again shortly.")
			return
		}

		rec, err := d.Redis.GetTg2faCode(r.Context(), principal.UserID)
		if err != nil {
			d.Logger.Error("tg2fa-verify: read failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}
		if rec == nil || rec.Code == "" {
			writeError(w, http.StatusConflict, "NO_CODE_PENDING", "No pending code")
			return
		}

		expected := []byte(rec.Code)
		got := []byte(req.Code)
		if len(expected) != len(got) || subtle.ConstantTimeCompare(expected, got) != 1 {
			writeError(w, http.StatusForbidden, "INVALID_CODE", "Invalid code")
			return
		}

		// Success: grant step-up for the session and clean up the message.
		stepUpTTL := d.Config.Security.StepUpTTL
		if stepUpTTL <= 0 {
			stepUpTTL = 5 * time.Minute
		}
		if err := d.Redis.BumpStepUp(r.Context(), principal.SID, principal.UserID, stepUpTTL); err != nil {
			d.Logger.Error("tg2fa-verify: step-up failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}

		_ = tg.DeleteMessage(r.Context(), rec.ChatID, rec.MessageID)
		_ = d.Redis.DelTg2faCode(r.Context(), principal.UserID)

		writeJSON(w, http.StatusOK, tg2faVerifyResponse{OK: true})
	}
}

func tg2faStatusHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tg := d.TelegramClient
		enabled := tg != nil && tg.Enabled()

		principal, ok := authz.FromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
			return
		}

		user, err := d.usersFor().GetUserByID(r.Context(), principal.UserID)
		if err != nil {
			if err == store.ErrUserNotFound {
				writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "User not found")
				return
			}
			d.Logger.Error("tg2fa-status: get user failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}

		resp := tg2faStatusResponse{OK: true, HasTelegram: user.HasTelegram(), Enabled: enabled}

		if rec, err := d.Redis.GetTg2faCode(r.Context(), principal.UserID); err == nil && rec != nil {
			resp.CodeSent = true
			if ttl, ttlErr := d.Redis.Tg2faCodeTTL(r.Context(), principal.UserID); ttlErr == nil {
				resp.TTLSeconds = int64(ttl.Seconds())
			}
		}

		if res, err := d.Redis.IncrRateLimit(r.Context(), store.Tg2faResendKey(principal.UserID), 1, 30*time.Second); err == nil && !res.Blocked {
			// Probe only; ignore the probe counter by not exposing cooldown.
		}

		writeJSON(w, http.StatusOK, resp)
	}
}

// contextWithTimeout is a tiny helper to avoid importing context twice inline.
func contextWithTimeout(ctx context.Context, d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, d)
}
