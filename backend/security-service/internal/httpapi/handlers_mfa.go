package httpapi

import (
	"net/http"

	"github.com/earflow/music-platform/security-service/internal/authz"
	"github.com/earflow/music-platform/security-service/internal/recoverycodes"
	"github.com/earflow/music-platform/security-service/internal/store"
)

type recoveryRegenerateResponse struct {
	RecoveryCodes []string `json:"recoveryCodes"`
}

func recoveryRegenerateHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, ok := authz.FromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
			return
		}

		rl, err := d.Redis.IncrRateLimit(
			r.Context(),
			store.MFAAttemptsKey(principal.UserID),
			5,
			d.Config.Security.PasswordAttemptWindow,
		)
		if err != nil {
			d.Logger.Warn("recovery-regen: rate-limit failed", "err", err)
		}
		if rl.Blocked {
			writeRetry(w, rl.RetryAfterSecs, "Too many MFA attempts")
			return
		}

		if !stepUpOK(d, r, principal) {
			writeError(w, http.StatusForbidden, "MFA_STEP_UP_REQUIRED", "Step-up required")
			return
		}

		user, err := d.Postgres.GetUserByID(r.Context(), principal.UserID)
		if err != nil {
			if err == store.ErrUserNotFound {
				writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "User not found")
				return
			}
			d.Logger.Error("recovery-regen: get user failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}
		if user.Salt == "" {
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}
		if !user.MFAEnabled {
			writeError(w, http.StatusConflict, "MFA_NOT_ENABLED", "MFA not enabled")
			return
		}

		codes, err := recoverycodes.Generate(10, 9)
		if err != nil {
			d.Logger.Error("recovery-regen: generate failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}
		hashes, err := recoverycodes.HashAll(user.Salt, codes)
		if err != nil {
			d.Logger.Error("recovery-regen: hash failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}
		payload, err := recoverycodes.MarshalHashes(hashes)
		if err != nil {
			d.Logger.Error("recovery-regen: marshal failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}

		if err := d.Postgres.UpdateMFARecoveryCodes(r.Context(), principal.UserID, payload); err != nil {
			d.Logger.Error("recovery-regen: update failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}

		writeJSON(w, http.StatusOK, recoveryRegenerateResponse{RecoveryCodes: codes})
	}
}
