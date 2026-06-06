package httpapi

import (
	"net/http"

	"github.com/earflow/music-platform/security-service/internal/authz"
	"github.com/earflow/music-platform/security-service/internal/cryptoutil"
	"github.com/earflow/music-platform/security-service/internal/domain"
	"github.com/earflow/music-platform/security-service/internal/store"
)

type passwordStrengthRequest struct {
	Password string `json:"password"`
}

func passwordStrengthHandler(d Deps) http.HandlerFunc {
	rules := domain.PasswordRules{
		MinLength:     d.Config.Security.PasswordMinLength,
		MaxLength:     d.Config.Security.PasswordMaxLength,
		RequireLetter: true,
		RequireDigit:  true,
	}

	return func(w http.ResponseWriter, r *http.Request) {
		principal, ok := authz.FromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
			return
		}

		rl, err := d.Redis.IncrRateLimit(
			r.Context(),
			store.StrengthAttemptsKey(principal.UserID),
			d.Config.Security.StrengthRateMax,
			d.Config.Security.StrengthRateWindow,
		)
		if err != nil {
			d.Logger.Warn("strength: rate-limit failed", "err", err)
		}
		if rl.Blocked {
			writeRetry(w, rl.RetryAfterSecs, "Too many requests")
			return
		}

		var req passwordStrengthRequest
		if err := readJSON(r, d.Config.HTTP.MaxBodyBytes, &req); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_BODY", "Invalid request body")
			return
		}
		if len(req.Password) > rules.MaxLength {
			writeError(w, http.StatusRequestEntityTooLarge, "PASSWORD_TOO_LONG", "Password too long")
			return
		}

		strength := domain.EvaluatePasswordStrength(req.Password, rules)
		writeJSON(w, http.StatusOK, strength)
	}
}

type passwordChangeRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

type passwordChangeResponse struct {
	OK                    bool `json:"ok"`
	HasPassword           bool `json:"hasPassword"`
	RevokedOtherSessions  int  `json:"revokedOtherSessions"`
}

func passwordChangeHandler(d Deps) http.HandlerFunc {
	rules := domain.PasswordRules{
		MinLength:     d.Config.Security.PasswordMinLength,
		MaxLength:     d.Config.Security.PasswordMaxLength,
		RequireLetter: true,
		RequireDigit:  true,
	}

	return func(w http.ResponseWriter, r *http.Request) {
		principal, ok := authz.FromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
			return
		}

		var req passwordChangeRequest
		if err := readJSON(r, d.Config.HTTP.MaxBodyBytes, &req); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_BODY", "Invalid request body")
			return
		}
		if req.NewPassword == "" {
			writeError(w, http.StatusBadRequest, "NEW_PASSWORD_REQUIRED", "New password required")
			return
		}

		strength := domain.EvaluatePasswordStrength(req.NewPassword, rules)
		if !strength.MeetsComplexity {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error":    "Password too weak",
				"code":     "WEAK_PASSWORD",
				"strength": strength,
			})
			return
		}

		rl, err := d.Redis.IncrRateLimit(
			r.Context(),
			store.PasswordAttemptsKey(principal.UserID),
			d.Config.Security.PasswordMaxAttempts,
			d.Config.Security.PasswordAttemptWindow,
		)
		if err != nil {
			d.Logger.Warn("password-change: rate-limit failed", "err", err)
		}
		if rl.Blocked {
			writeRetry(w, rl.RetryAfterSecs, "Too many attempts")
			return
		}

		user, err := d.Postgres.GetUserByID(r.Context(), principal.UserID)
		if err != nil {
			if err == store.ErrUserNotFound {
				writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "User not found")
				return
			}
			d.Logger.Error("password-change: get user failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}
		if user.Salt == "" {
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}

		hasPassword := user.HasPassword()
		mfaEnabled := user.MFAEnabled

		if hasPassword {
			if req.CurrentPassword == "" {
				writeError(w, http.StatusBadRequest, "CURRENT_PASSWORD_REQUIRED", "Current password required")
				return
			}
			candidate := cryptoutil.HashPassword(
				req.CurrentPassword,
				user.Salt,
				d.Config.Security.PbkdfIterations,
				d.Config.Security.PbkdfKeyLength,
			)
			if !cryptoutil.ConstantTimeHexEquals(candidate, *user.PasswordHash) {
				legacy := cryptoutil.HashPassword(
					req.CurrentPassword,
					user.Salt,
					d.Config.Security.PbkdfIterationsLegacy,
					d.Config.Security.PbkdfKeyLength,
				)
				if !cryptoutil.ConstantTimeHexEquals(legacy, *user.PasswordHash) {
					writeError(w, http.StatusBadRequest, "INVALID_CURRENT_PASSWORD", "Invalid current password")
					return
				}
			}
			if mfaEnabled {
				if !stepUpOK(d, r, principal) {
					writeError(w, http.StatusForbidden, "MFA_STEP_UP_REQUIRED", "Step-up required")
					return
				}
			}
		} else {
			if !mfaEnabled {
				writeError(w, http.StatusForbidden, "MFA_REQUIRED_TO_SET_PASSWORD", "Enable 2FA before setting a password")
				return
			}
			if !stepUpOK(d, r, principal) {
				writeError(w, http.StatusForbidden, "MFA_STEP_UP_REQUIRED", "Step-up required")
				return
			}
		}

		newHash := cryptoutil.HashPassword(
			req.NewPassword,
			user.Salt,
			d.Config.Security.PbkdfIterations,
			d.Config.Security.PbkdfKeyLength,
		)
		if err := d.Postgres.UpdatePasswordHash(r.Context(), principal.UserID, newHash); err != nil {
			d.Logger.Error("password-change: update failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}

		if mfaEnabled {
			_ = d.Redis.BumpStepUp(r.Context(), principal.SID, principal.UserID, d.Config.Security.StepUpTTL)
		}

		revoked := d.revokeAllSessionsExcept(r, principal.UserID, principal.SID)

		writeJSON(w, http.StatusOK, passwordChangeResponse{
			OK:                   true,
			HasPassword:          true,
			RevokedOtherSessions: revoked,
		})
	}
}

// stepUpOK returns true when the caller's sid currently has an active step-up.
func stepUpOK(d Deps, r *http.Request, principal authz.Principal) bool {
	st, err := d.Redis.GetStepUpStatus(r.Context(), principal.SID)
	if err != nil {
		d.Logger.Warn("step-up read failed", "err", err)
		return false
	}
	return st.OK && st.UserID == principal.UserID
}

// revokeAllSessionsExcept revokes every session for the user except `keep`.
func (d Deps) revokeAllSessionsExcept(r *http.Request, userID int64, keepSID string) int {
	sids, err := d.Redis.EnumerateUserSids(r.Context(), userID)
	if err != nil {
		d.Logger.Warn("revoke: enumerate failed", "err", err)
	}
	revoked := 0
	seen := map[string]struct{}{}
	for _, sid := range sids {
		if sid == "" {
			continue
		}
		if sid == keepSID {
			continue
		}
		if _, ok := seen[sid]; ok {
			continue
		}
		seen[sid] = struct{}{}
		info, err := d.Redis.ReadSessionInfo(r.Context(), sid)
		if err != nil {
			d.Logger.Warn("revoke: read failed", "err", err)
			continue
		}
		if info == nil {
			_ = d.Redis.RemoveUserSidFromIndex(r.Context(), userID, sid)
			continue
		}
		if err := store.RevokeSessionViaSoT(r.Context(), d.AuthSoT, d.Redis, userID, info.SID, info.JTI); err != nil {
			d.Logger.Warn("revoke: failed", "err", err, "sid", sid)
			continue
		}
		revoked++
	}
	return revoked
}
