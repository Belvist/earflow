package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/earflow/music-platform/security-service/internal/authz"
	"github.com/earflow/music-platform/security-service/internal/cryptoutil"
	"github.com/earflow/music-platform/security-service/internal/mfatotp"
	"github.com/earflow/music-platform/security-service/internal/recoverycodes"
	"github.com/earflow/music-platform/security-service/internal/store"
)

const (
	mfaIssuer            = "Earflow Artists"
	mfaRecoveryCodeCount = 10
	mfaRecoveryBytes     = 9
)

type mfaStatusResponse struct {
	Enabled                bool   `json:"enabled"`
	EnabledAt              string `json:"enabledAt"`
	RecoveryCodesRemaining int    `json:"recoveryCodesRemaining"`
}

func mfaStatusHandler(d Deps) http.HandlerFunc {
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
			d.Logger.Error("mfa-status: get user failed", "err", err, "user_id", principal.UserID)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}

		enabledAt := ""
		if user.MFAEnabledAt != nil {
			enabledAt = user.MFAEnabledAt.UTC().Format(time.RFC3339)
		}
		recoveryRaw := ""
		if user.MFARecoveryCodes != nil {
			recoveryRaw = *user.MFARecoveryCodes
		}

		writeJSON(w, http.StatusOK, mfaStatusResponse{
			Enabled:                user.MFAEnabled,
			EnabledAt:              enabledAt,
			RecoveryCodesRemaining: recoverycodes.CountRemaining(recoveryRaw),
		})
	}
}

type mfaSetupResponse struct {
	SecretBase32 string `json:"secretBase32"`
	OtpauthURL   string `json:"otpauthUrl"`
	Issuer       string `json:"issuer"`
	AccountName  string `json:"accountName"`
}

// mfaSetupHandler generates a new TOTP secret for the user (persisted
// encrypted), ready to be confirmed via /api/auth/2fa/enable.
func mfaSetupHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, ok := authz.FromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
			return
		}

		rl, err := d.Redis.IncrRateLimit(
			r.Context(),
			store.MFAAttemptsKey(principal.UserID),
			d.Config.Security.PasswordMaxAttempts,
			d.Config.Security.PasswordAttemptWindow,
		)
		if err != nil {
			d.Logger.Warn("mfa-setup: rate-limit failed", "err", err)
		}
		if rl.Blocked {
			writeRetry(w, rl.RetryAfterSecs, "Too many MFA setup attempts")
			return
		}

		user, err := d.Postgres.GetUserByID(r.Context(), principal.UserID)
		if err != nil {
			if err == store.ErrUserNotFound {
				writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "User not found")
				return
			}
			d.Logger.Error("mfa-setup: get user failed", "err", err, "user_id", principal.UserID)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}
		if user.Salt == "" {
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}
		if user.MFAEnabled {
			writeError(w, http.StatusConflict, "MFA_ALREADY_ENABLED", "MFA already enabled")
			return
		}

		secretBase32, err := mfatotp.GenerateSecretBase32(20)
		if err != nil {
			d.Logger.Error("mfa-setup: generate secret failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}

		payload, err := json.Marshal(map[string]string{"secretBase32": secretBase32})
		if err != nil {
			d.Logger.Error("mfa-setup: marshal secret failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}
		enc, err := cryptoutil.EncryptPayload(
			d.Config.Crypto.EncryptionKey,
			user.Salt,
			payload,
			d.Config.Security.EncryptionPbkdfIterations,
			d.Config.Security.EncryptionKeyLength,
		)
		if err != nil {
			d.Logger.Error("mfa-setup: encrypt secret failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}
		encJSON, err := json.Marshal(enc)
		if err != nil {
			d.Logger.Error("mfa-setup: marshal encrypted secret failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}
		encString := string(encJSON)

		if err := d.Postgres.UpdateUser(r.Context(), principal.UserID, store.UpdateUserParams{
			MFASecretEncrypted: &encString,
		}); err != nil {
			d.Logger.Error("mfa-setup: persist secret failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}

		accountName := maybeDecryptEmail(d, user)
		if accountName == "" {
			accountName = "user:" + intToString(principal.UserID)
		}

		otpauthURL, err := mfatotp.BuildOtpauthURL(mfaIssuer, accountName, secretBase32, 6, 30)
		if err != nil {
			d.Logger.Error("mfa-setup: build otpauth url failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}

		writeJSON(w, http.StatusOK, mfaSetupResponse{
			SecretBase32: secretBase32,
			OtpauthURL:   otpauthURL,
			Issuer:       mfaIssuer,
			AccountName:  accountName,
		})
	}
}

type mfaEnableRequest struct {
	Token string `json:"token"`
}

type mfaEnableResponse struct {
	Enabled          bool     `json:"enabled"`
	RecoveryCodes    []string `json:"recoveryCodes"`
	StepUpTTLSeconds int      `json:"stepUpTtlSeconds"`
}

func mfaEnableHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, ok := authz.FromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
			return
		}

		var req mfaEnableRequest
		if err := readJSON(r, d.Config.HTTP.MaxBodyBytes, &req); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_BODY", "Invalid request body")
			return
		}
		if strings.TrimSpace(req.Token) == "" {
			writeError(w, http.StatusBadRequest, "TOKEN_REQUIRED", "2FA code required")
			return
		}

		rl, err := d.Redis.IncrRateLimit(
			r.Context(),
			store.MFAAttemptsKey(principal.UserID),
			d.Config.Security.PasswordMaxAttempts,
			d.Config.Security.PasswordAttemptWindow,
		)
		if err != nil {
			d.Logger.Warn("mfa-enable: rate-limit failed", "err", err)
		}
		if rl.Blocked {
			writeRetry(w, rl.RetryAfterSecs, "Too many MFA attempts")
			return
		}

		user, err := d.Postgres.GetUserByID(r.Context(), principal.UserID)
		if err != nil {
			if err == store.ErrUserNotFound {
				writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "User not found")
				return
			}
			d.Logger.Error("mfa-enable: get user failed", "err", err, "user_id", principal.UserID)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}
		if user.Salt == "" {
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}
		if user.MFAEnabled {
			writeError(w, http.StatusConflict, "MFA_ALREADY_ENABLED", "MFA already enabled")
			return
		}
		if user.MFASecretEncrypted == nil || *user.MFASecretEncrypted == "" {
			writeError(w, http.StatusConflict, "MFA_SETUP_REQUIRED", "MFA setup required")
			return
		}

		secretBase32, err := decryptMfaSecret(d, user)
		if err != nil || secretBase32 == "" {
			writeError(w, http.StatusConflict, "MFA_SETUP_REQUIRED", "MFA setup required")
			return
		}

		if !mfatotp.VerifyTotp(secretBase32, req.Token, 1, 30, 6, time.Now()) {
			writeError(w, http.StatusBadRequest, "INVALID_2FA_CODE", "Invalid 2FA code")
			return
		}

		recoveryCodes, err := recoverycodes.Generate(mfaRecoveryCodeCount, mfaRecoveryBytes)
		if err != nil {
			d.Logger.Error("mfa-enable: generate recovery codes failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}
		hashes, err := recoverycodes.HashAll(user.Salt, recoveryCodes)
		if err != nil {
			d.Logger.Error("mfa-enable: hash recovery codes failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}
		hashesJSON, err := recoverycodes.MarshalHashes(hashes)
		if err != nil {
			d.Logger.Error("mfa-enable: marshal recovery codes failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}

		now := time.Now().UTC()
		if err := d.Postgres.UpdateUser(r.Context(), principal.UserID, store.UpdateUserParams{
			MFAEnabled:       boolPtr(true),
			MFAEnabledAt:     &now,
			MFARecoveryCodes: &hashesJSON,
		}); err != nil {
			d.Logger.Error("mfa-enable: persist failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}

		if err := d.Redis.BumpStepUp(r.Context(), principal.SID, principal.UserID, d.Config.Security.StepUpTTL); err != nil {
			d.Logger.Warn("mfa-enable: step-up bump failed", "err", err)
		}

		writeJSON(w, http.StatusOK, mfaEnableResponse{
			Enabled:          true,
			RecoveryCodes:    recoveryCodes,
			StepUpTTLSeconds: int(d.Config.Security.StepUpTTL.Seconds()),
		})
	}
}

type mfaStepUpRequest struct {
	Token        *string `json:"token"`
	RecoveryCode *string `json:"recoveryCode"`
}

type mfaStepUpResponse struct {
	OK         bool  `json:"ok"`
	TTLSeconds int64 `json:"ttlSeconds"`
}

// mfaStepUpHandler verifies a TOTP code or recovery code and grants a
// short-lived step-up on the current sid.
func mfaStepUpHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, ok := authz.FromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
			return
		}

		var req mfaStepUpRequest
		if err := readJSON(r, d.Config.HTTP.MaxBodyBytes, &req); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_BODY", "Invalid request body")
			return
		}
		if (req.Token == nil && req.RecoveryCode == nil) || (req.Token != nil && req.RecoveryCode != nil) {
			writeError(w, http.StatusBadRequest, "INVALID_BODY", "Provide either token or recoveryCode")
			return
		}

		rl, err := d.Redis.IncrRateLimit(
			r.Context(),
			store.MFAAttemptsKey(principal.UserID),
			d.Config.Security.PasswordMaxAttempts,
			d.Config.Security.PasswordAttemptWindow,
		)
		if err != nil {
			d.Logger.Warn("mfa-step-up: rate-limit failed", "err", err)
		}
		if rl.Blocked {
			writeRetry(w, rl.RetryAfterSecs, "Too many MFA attempts")
			return
		}

		user, err := d.Postgres.GetUserByID(r.Context(), principal.UserID)
		if err != nil {
			if err == store.ErrUserNotFound {
				writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "User not found")
				return
			}
			d.Logger.Error("mfa-step-up: get user failed", "err", err, "user_id", principal.UserID)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}
		if !user.MFAEnabled {
			writeError(w, http.StatusForbidden, "MFA_REQUIRED", "MFA required")
			return
		}
		if user.Salt == "" {
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}

		verified := false

		if req.Token != nil {
			secretBase32, derr := decryptMfaSecret(d, user)
			if derr != nil || secretBase32 == "" {
				verified = false
			} else {
				verified = mfatotp.VerifyTotp(secretBase32, *req.Token, 1, 30, 6, time.Now())
			}
		} else {
			stored := parseRecoveryHashes(user)
			res := recoverycodes.Consume(user.Salt, *req.RecoveryCode, stored)
			verified = res.OK
			if verified {
				nextJSON, merr := recoverycodes.MarshalHashes(res.NextHashes)
				if merr != nil {
					d.Logger.Error("mfa-step-up: marshal recovery hashes failed", "err", merr)
					writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
					return
				}
				if uerr := d.Postgres.UpdateUser(r.Context(), principal.UserID, store.UpdateUserParams{
					MFARecoveryCodes: &nextJSON,
				}); uerr != nil {
					d.Logger.Error("mfa-step-up: persist recovery codes failed", "err", uerr)
					writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
					return
				}
			}
		}

		if !verified {
			writeError(w, http.StatusBadRequest, "INVALID_2FA_CODE", "Invalid 2FA code")
			return
		}

		if err := d.Redis.BumpStepUp(r.Context(), principal.SID, principal.UserID, d.Config.Security.StepUpTTL); err != nil {
			d.Logger.Warn("mfa-step-up: bump failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}

		writeJSON(w, http.StatusOK, mfaStepUpResponse{
			OK:         true,
			TTLSeconds: int64(d.Config.Security.StepUpTTL.Seconds()),
		})
	}
}

type mfaStepUpStatusResponse struct {
	OK         bool   `json:"ok"`
	At         string `json:"at,omitempty"`
	TTLSeconds int64  `json:"ttlSeconds"`
}

func mfaStepUpStatusHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, ok := authz.FromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
			return
		}

		st, err := d.Redis.GetStepUpStatus(r.Context(), principal.SID)
		if err != nil {
			d.Logger.Warn("mfa-step-up-status: read failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}
		if !st.OK || st.UserID != principal.UserID {
			writeJSON(w, http.StatusOK, mfaStepUpStatusResponse{OK: false})
			return
		}

		writeJSON(w, http.StatusOK, mfaStepUpStatusResponse{
			OK:         true,
			At:         st.At,
			TTLSeconds: st.TTLSeconds,
		})
	}
}

type mfaDisableRequest struct {
	Token        *string `json:"token"`
	RecoveryCode *string `json:"recoveryCode"`
}

func mfaDisableHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, ok := authz.FromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
			return
		}

		var req mfaDisableRequest
		if err := readJSON(r, d.Config.HTTP.MaxBodyBytes, &req); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_BODY", "Invalid request body")
			return
		}
		if (req.Token == nil && req.RecoveryCode == nil) || (req.Token != nil && req.RecoveryCode != nil) {
			writeError(w, http.StatusBadRequest, "INVALID_BODY", "Provide either token or recoveryCode")
			return
		}

		rl, err := d.Redis.IncrRateLimit(
			r.Context(),
			store.MFAAttemptsKey(principal.UserID),
			d.Config.Security.PasswordMaxAttempts,
			d.Config.Security.PasswordAttemptWindow,
		)
		if err != nil {
			d.Logger.Warn("mfa-disable: rate-limit failed", "err", err)
		}
		if rl.Blocked {
			writeRetry(w, rl.RetryAfterSecs, "Too many MFA attempts")
			return
		}

		user, err := d.Postgres.GetUserByID(r.Context(), principal.UserID)
		if err != nil {
			if err == store.ErrUserNotFound {
				writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "User not found")
				return
			}
			d.Logger.Error("mfa-disable: get user failed", "err", err, "user_id", principal.UserID)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}
		if !user.MFAEnabled {
			writeError(w, http.StatusConflict, "MFA_NOT_ENABLED", "MFA not enabled")
			return
		}
		if user.Salt == "" {
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}

		verified := false
		if req.Token != nil {
			secretBase32, derr := decryptMfaSecret(d, user)
			if derr == nil && secretBase32 != "" {
				verified = mfatotp.VerifyTotp(secretBase32, *req.Token, 1, 30, 6, time.Now())
			}
		} else {
			res := recoverycodes.Consume(user.Salt, *req.RecoveryCode, parseRecoveryHashes(user))
			verified = res.OK
		}

		if !verified {
			writeError(w, http.StatusBadRequest, "INVALID_2FA_CODE", "Invalid 2FA code")
			return
		}

		if err := d.Postgres.UpdateUser(r.Context(), principal.UserID, store.UpdateUserParams{
			MFAEnabled:           boolPtr(false),
			MFAEnabledAtNull:     true,
			MFASecretNull:        true,
			MFARecoveryCodesNull: true,
		}); err != nil {
			d.Logger.Error("mfa-disable: persist failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}

		_ = d.Redis.DelStepUp(r.Context(), principal.SID)

		writeJSON(w, http.StatusOK, map[string]any{"enabled": false})
	}
}

// --- helpers ---------------------------------------------------------------

// decryptMfaSecret decrypts the stored encrypted TOTP secret for a user.
func decryptMfaSecret(d Deps, user *store.User) (string, error) {
	if user == nil || user.MFASecretEncrypted == nil || *user.MFASecretEncrypted == "" || user.Salt == "" {
		return "", nil
	}
	var payload cryptoutil.EncryptedPayload
	if err := json.Unmarshal([]byte(*user.MFASecretEncrypted), &payload); err != nil {
		return "", err
	}
	plaintext, err := cryptoutil.DecryptPayload(
		d.Config.Crypto.EncryptionKey,
		user.Salt,
		payload,
		d.Config.Security.EncryptionPbkdfIterations,
		d.Config.Security.PbkdfIterationsLegacy,
		d.Config.Security.EncryptionKeyLength,
	)
	if err != nil {
		return "", err
	}
	var parsed struct {
		SecretBase32 string `json:"secretBase32"`
	}
	if err := json.Unmarshal(plaintext, &parsed); err != nil {
		return "", err
	}
	return strings.TrimSpace(parsed.SecretBase32), nil
}

func parseRecoveryHashes(user *store.User) []string {
	if user == nil || user.MFARecoveryCodes == nil || *user.MFARecoveryCodes == "" {
		return nil
	}
	var arr []string
	if err := json.Unmarshal([]byte(*user.MFARecoveryCodes), &arr); err != nil {
		return nil
	}
	return arr
}

func boolPtr(v bool) *bool {
	return &v
}
