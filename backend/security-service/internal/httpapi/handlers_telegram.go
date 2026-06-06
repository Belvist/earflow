package httpapi

import (
	"net/http"

	"github.com/earflow/music-platform/security-service/internal/authz"
	"github.com/earflow/music-platform/security-service/internal/store"
)

type telegramUnlinkResponse struct {
	OK          bool `json:"ok"`
	HasTelegram bool `json:"hasTelegram"`
}

func telegramUnlinkHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, ok := authz.FromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
			return
		}

		user, err := d.Postgres.GetUserByID(r.Context(), principal.UserID)
		if err != nil {
			if err == store.ErrUserNotFound {
				writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "User not found")
				return
			}
			d.Logger.Error("telegram-unlink: get user failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}

		if !user.HasTelegram() {
			writeError(w, http.StatusConflict, "TELEGRAM_NOT_LINKED", "Telegram not linked")
			return
		}
		if !user.HasPassword() {
			writeError(w, http.StatusConflict, "PASSWORD_REQUIRED_BEFORE_UNLINK", "Password must be set before unlinking Telegram")
			return
		}
		if user.MFAEnabled && !stepUpOK(d, r, principal) {
			writeError(w, http.StatusForbidden, "MFA_STEP_UP_REQUIRED", "Step-up required")
			return
		}

		if err := d.Postgres.ClearTelegramID(r.Context(), principal.UserID); err != nil {
			d.Logger.Error("telegram-unlink: clear failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}

		writeJSON(w, http.StatusOK, telegramUnlinkResponse{OK: true, HasTelegram: false})
	}
}
