package httpapi

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/earflow/music-platform/security-service/internal/authz"
	"github.com/earflow/music-platform/security-service/internal/cryptoutil"
	"github.com/earflow/music-platform/security-service/internal/domain"
	"github.com/earflow/music-platform/security-service/internal/recoverycodes"
	"github.com/earflow/music-platform/security-service/internal/store"
)

type overviewAccount struct {
	Email       *string `json:"email"`
	HasPassword bool    `json:"hasPassword"`
	HasTelegram bool    `json:"hasTelegram"`
}

type overviewMFA struct {
	Enabled                bool    `json:"enabled"`
	EnabledAt              *string `json:"enabledAt"`
	RecoveryCodesRemaining int     `json:"recoveryCodesRemaining"`
}

type overviewStepUp struct {
	Active     bool    `json:"active"`
	TTLSeconds *int64  `json:"ttlSeconds"`
	At         *string `json:"at,omitempty"`
}

type overviewCapabilities struct {
	Password domain.PasswordCapability `json:"password"`
	Telegram domain.TelegramCapability `json:"telegram"`
	Sessions domain.SessionsCapability `json:"sessions"`
	MFA      domain.MfaCapability      `json:"mfa"`
}

type overviewResponse struct {
	Account       overviewAccount        `json:"account"`
	MFA           overviewMFA            `json:"mfa"`
	StepUp        overviewStepUp         `json:"stepUp"`
	Level         domain.Level           `json:"level"`
	Issues        []domain.Issue         `json:"issues"`
	Stats         []domain.StatTile      `json:"stats"`
	Capabilities  overviewCapabilities   `json:"capabilities"`
	Sessions      []domain.SessionView   `json:"sessions"`
	PasswordRules domain.PasswordRules   `json:"passwordRules"`
}

func overviewHandler(d Deps) http.HandlerFunc {
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

		user, err := d.Postgres.GetUserByID(r.Context(), principal.UserID)
		if err != nil {
			if err == store.ErrUserNotFound {
				writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "User not found")
				return
			}
			d.Logger.Error("overview: get user failed", "err", err, "user_id", principal.UserID)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}

		recoveryRaw := ""
		if user.MFARecoveryCodes != nil {
			recoveryRaw = *user.MFARecoveryCodes
		}
		recoveryCount := recoverycodes.CountRemaining(recoveryRaw)

		stepUpStatus, err := d.Redis.GetStepUpStatus(r.Context(), principal.SID)
		if err != nil {
			d.Logger.Warn("overview: step-up read failed", "err", err)
		}
		stepUpActive := stepUpStatus.OK && stepUpStatus.UserID == principal.UserID

		sessions := d.collectDecoratedSessions(r, principal)

		secCtx := makeSecurityContext(user, stepUpActive, recoveryCount)

		email := maybeDecryptEmail(d, user)
		masked := domain.MaskEmail(email)
		var emailPtr *string
		if masked != "" {
			emailPtr = &masked
		}

		resp := overviewResponse{
			Account: overviewAccount{
				Email:       emailPtr,
				HasPassword: user.HasPassword(),
				HasTelegram: user.HasTelegram(),
			},
			MFA: overviewMFA{
				Enabled:                user.MFAEnabled,
				EnabledAt:              mfaEnabledAtPtr(user),
				RecoveryCodesRemaining: recoveryCount,
			},
			StepUp: overviewStepUp{
				Active:     stepUpActive,
				TTLSeconds: ttlPtr(stepUpActive, stepUpStatus.TTLSeconds),
				At:         ptrIfNonEmpty(stepUpStatus.At),
			},
			Level:  domain.ComputeLevel(secCtx),
			Issues: domain.ComputeIssues(secCtx),
			Stats:  domain.ComputeStats(secCtx, len(sessions)),
			Capabilities: overviewCapabilities{
				Password: domain.ComputePasswordCapability(secCtx),
				Telegram: domain.ComputeTelegramCapability(secCtx),
				Sessions: domain.ComputeSessionsCapability(secCtx, countOtherSessions(sessions)),
				MFA:      domain.ComputeMfaCapability(secCtx),
			},
			Sessions:      sessions,
			PasswordRules: rules,
		}

		writeJSON(w, http.StatusOK, resp)
	}
}

func mfaEnabledAtPtr(u *store.User) *string {
	if u == nil || u.MFAEnabledAt == nil {
		return nil
	}
	s := u.MFAEnabledAt.UTC().Format(time.RFC3339)
	return &s
}

func ttlPtr(active bool, ttl int64) *int64 {
	if !active {
		return nil
	}
	if ttl <= 0 {
		return nil
	}
	v := ttl
	return &v
}

func ptrIfNonEmpty(s string) *string {
	if s == "" {
		return nil
	}
	v := s
	return &v
}

func countOtherSessions(list []domain.SessionView) int {
	count := 0
	for _, s := range list {
		if !s.Current {
			count++
		}
	}
	return count
}

// maybeDecryptEmail attempts to recover the plaintext email from the user row
// using either the encrypted blob or the cleartext column.
func maybeDecryptEmail(d Deps, user *store.User) string {
	if user == nil {
		return ""
	}
	if user.EmailCleartext != nil {
		s := *user.EmailCleartext
		if isPlainEmail(s) {
			return s
		}
	}
	if user.EmailEncrypted == nil || *user.EmailEncrypted == "" {
		return ""
	}
	var payload cryptoutil.EncryptedPayload
	if err := json.Unmarshal([]byte(*user.EmailEncrypted), &payload); err != nil {
		return ""
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
		return ""
	}
	var parsed struct {
		Value string `json:"value"`
	}
	if err := json.Unmarshal(plaintext, &parsed); err != nil {
		return ""
	}
	if !isPlainEmail(parsed.Value) {
		return ""
	}
	return parsed.Value
}

func isPlainEmail(s string) bool {
	if s == "" {
		return false
	}
	at := -1
	dot := -1
	for i, c := range s {
		if c == '@' {
			if at != -1 {
				return false
			}
			at = i
		}
		if c == '.' && at != -1 {
			dot = i
		}
	}
	return at > 0 && dot > at+1 && dot < len(s)-1
}
