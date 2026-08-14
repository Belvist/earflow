package authn

import (
	"context"
	"strings"
	"time"

	"github.com/earflow/music-platform/auth-core/internal/store"
)

// LoginTelegram mirrors Node telegram login (HMAC validation + user upsert).
func (s *Service) LoginTelegram(ctx context.Context, raw map[string]any) (*AuthResult, *APIError) {
	if strings.TrimSpace(s.Auth.TelegramBotToken) == "" {
		return nil, ErrServiceUnavailable
	}

	payload := NormalizeTelegramAuthPayload(raw)
	if payload == nil {
		return nil, &APIError{Status: 400, Message: "Некорректные данные Telegram", Code: "INVALID_TELEGRAM_PAYLOAD"}
	}
	if !VerifyTelegramAuth(payload, s.Auth.TelegramBotToken) {
		return nil, &APIError{Status: 401, Message: "Недействительная подпись Telegram", Code: "INVALID_TELEGRAM_SIGNATURE"}
	}
	s.audit(ctx, "telegram_login_attempt", "telegramId", payload.ID, "ip", ipFromCtx(ctx), "ua", uaFromCtx(ctx))

	firstName := ""
	if v := SanitizeProfileField(strPtrVal(payload.FirstName)); v != nil {
		firstName = *v
	}
	lastName := ""
	if v := SanitizeProfileField(strPtrVal(payload.LastName)); v != nil {
		lastName = *v
	}
	safeUsername := ""
	if payload.Username != nil {
		safeUsername = strings.TrimSpace(*payload.Username)
	}
	safeUsername = truncateRunes(safeUsername, 64)
	safeUsername = strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(safeUsername, "<", ""), ">", ""), "\r", "")

	user, err := s.PG.GetUserByTelegram(ctx, payload.ID)
	if err != nil && err != store.ErrUserNotFound {
		return nil, ErrServiceUnavailable
	}

	var userID int64
	if user == nil {
		userSalt, err := NewHexBytes(32)
		if err != nil {
			return nil, ErrServiceUnavailable
		}
		var metadata *string
		if firstName != "" || lastName != "" {
			plain := marshalJSON(map[string]any{"firstName": nullIfEmpty(firstName), "lastName": nullIfEmpty(lastName)})
			enc, encryptErr := encryptJSON(s.EncryptionKey, userSalt, plain, s.Auth.EncryptionPbkdfIterations, s.Auth.EncryptionKeyLength)
			if encryptErr == nil {
				encRaw := string(marshalJSON(enc))
				metadata = &encRaw
			}
		}
		usernameSeed := safeUsername
		if usernameSeed == "" {
			usernameSeed = "tg_" + itoa(payload.ID)
		}
		username := usernameDefault(usernameSeed, nil)

		created, err := s.PG.CreateUser(ctx, store.CreateUserParams{
			Username:   username,
			Salt:       &userSalt,
			Metadata:   metadata,
			TelegramID: &payload.ID,
		})
		if err != nil {
			return nil, ErrServiceUnavailable
		}
		userID = created.ID
	} else {
		userID = user.ID
		now := time.Now().UTC()
		updates := store.UpdateUserParams{LastLogin: &now}
		if user.TelegramID == nil {
			updates.TelegramID = &payload.ID
		}
		if user.Salt != nil {
			if firstName != "" || lastName != "" {
				plain := marshalJSON(map[string]any{"firstName": nullIfEmpty(firstName), "lastName": nullIfEmpty(lastName)})
				enc, encryptErr := encryptJSON(s.EncryptionKey, *user.Salt, plain, s.Auth.EncryptionPbkdfIterations, s.Auth.EncryptionKeyLength)
				if encryptErr == nil {
					encRaw := string(marshalJSON(enc))
					updates.Metadata = &encRaw
				}
			}
		}
		if err := s.PG.UpdateUser(ctx, userID, updates); err != nil {
			return nil, ErrServiceUnavailable
		}
	}

	// is_admin is fresh only for newly created users; re-read to be safe, since
	// telegram logins may also hit existing email accounts.
	fresh, err := s.PG.GetUserByID(ctx, userID)
	if err != nil {
		return nil, ErrServiceUnavailable
	}
	isAdmin := fresh.IsAdmin

	exchange, apiErr := s.newExchange(ctx, userID, isAdmin, time.Now().UTC())
	if apiErr != nil {
		return nil, apiErr
	}

	ud := baseUserData(fresh, isAdmin)
	ud["telegramId"] = payload.ID
	ud["hasTelegram"] = true
	s.mergeDecryptedMetadata(ctx, ud, fresh, true)
	s.RD.SetCachedUserProfile(ctx, userID, ud, s.Auth.ProfileCacheTTL)
	s.audit(ctx, "telegram_login_success", "userId", userID, "telegramId", payload.ID, "ip", ipFromCtx(ctx))

	return &AuthResult{Token: exchange.Token, RefreshToken: exchange.RefreshToken, User: ud}, nil
}

func strPtrVal(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func nullIfEmpty(v string) any {
	if v == "" {
		return nil
	}
	return v
}
