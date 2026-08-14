package authn

import (
	"context"
	"strings"

	"github.com/earflow/music-platform/auth-core/internal/store"
)

// VerifyResult is the /api/verify payload: { valid, user }.
type VerifyResult struct {
	User map[string]any
}

// Verify mirrors Node /api/verify (access token → user, profile cache fast path).
func (s *Service) Verify(ctx context.Context, token string) (*VerifyResult, *APIError) {
	if strings.TrimSpace(token) == "" {
		return nil, ErrTokenMissing
	}
	claims, err := VerifyAccess(s.JWTSecret, s.JWTIssuer, s.JWTAudience, token)
	if err != nil {
		return nil, ErrInvalidJWT
	}
	if claims.Type != "" && claims.Type != "access" {
		return nil, ErrInvalidJWT
	}
	if claims.UserID <= 0 {
		return nil, ErrInvalidJWT
	}

	cached, err := s.RD.GetCachedUserProfile(ctx, claims.UserID)
	if err == nil && cached != nil {
		cachedIsAdmin := boolOf(cached["isAdmin"])
		isAdmin := s.resolveIsAdmin(ctx, claims.UserID, cachedIsAdmin)
		if cachedIsAdmin != isAdmin {
			cached["isAdmin"] = isAdmin
			s.RD.SetCachedUserProfile(ctx, claims.UserID, cached, s.Auth.ProfileCacheTTL)
		}
		return &VerifyResult{User: cached}, nil
	}

	user, err := s.PG.GetUserByID(ctx, claims.UserID)
	if err == store.ErrUserNotFound {
		return nil, &APIError{Status: 404, Message: "Пользователь не найден", Code: "USER_NOT_FOUND"}
	}
	if err != nil {
		return nil, ErrServiceUnavailable
	}

	effectiveIsAdmin := s.resolveIsAdmin(ctx, user.ID, user.IsAdmin)
	ud := baseUserData(user, effectiveIsAdmin)
	s.mergeDecryptedMetadata(ctx, ud, user, true)
	s.RD.SetCachedUserProfile(ctx, user.ID, ud, s.Auth.ProfileCacheTTL)

	return &VerifyResult{User: ud}, nil
}

// Profile mirrors Node GET /api/profile (Bearer access token).
func (s *Service) Profile(ctx context.Context, token string, bustCache bool) (map[string]any, *APIError) {
	token = strings.TrimPrefix(token, "Bearer ")
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, &APIError{Status: 401, Message: "Токен отсутствует", Code: "TOKEN_MISSING"}
	}
	claims, err := VerifyAccess(s.JWTSecret, s.JWTIssuer, s.JWTAudience, token)
	if err != nil {
		return nil, ErrInvalidJWT
	}
	if claims.Type != "access" {
		return nil, ErrInvalidJWT
	}
	if claims.UserID <= 0 {
		return nil, ErrInvalidJWT
	}

	if !bustCache {
		cached, cErr := s.RD.GetCachedUserProfile(ctx, claims.UserID)
		if cErr == nil && cached != nil {
			if _, hasPw := cached["hasPassword"]; hasPw {
				if _, hasTg := cached["hasTelegram"]; hasTg {
					cachedIsAdmin := boolOf(cached["isAdmin"])
					isAdmin := s.resolveIsAdmin(ctx, claims.UserID, cachedIsAdmin)
					if cachedIsAdmin != isAdmin {
						cached["isAdmin"] = isAdmin
						s.RD.SetCachedUserProfile(ctx, claims.UserID, cached, s.Auth.ProfileCacheTTL)
					}
					return cached, nil
				}
			}
		}
	}

	user, err := s.PG.GetUserByID(ctx, claims.UserID)
	if err == store.ErrUserNotFound {
		return nil, &APIError{Status: 404, Message: "Пользователь не найден", Code: "USER_NOT_FOUND"}
	}
	if err != nil {
		return nil, ErrServiceUnavailable
	}

	effectiveIsAdmin := s.resolveIsAdmin(ctx, user.ID, user.IsAdmin)
	ud := baseUserData(user, effectiveIsAdmin)
	ud["createdAt"] = nullableTime(user.CreatedAt)
	ud["lastLogin"] = nullableTime(user.LastLogin)

	emailRaw := ""
	if user.Email != nil {
		emailRaw = strings.TrimSpace(*user.Email)
	}
	if isValidEmail(emailRaw) {
		ud["email"] = emailRaw
	}

	s.mergeDecryptedMetadata(ctx, ud, user, false)

	hasEmail := false
	if _, ok := ud["email"]; ok {
		hasEmail = true
	}
	if !hasEmail && user.Salt != nil && user.EmailEncrypted != nil && strings.TrimSpace(*user.EmailEncrypted) != "" {
		if email := s.decryptEmail(ctx, *user.EmailEncrypted, *user.Salt); email != "" && isValidEmail(email) {
			ud["email"] = email
			looksHashed := hex64Str(emailRaw)
			hasHash := user.EmailHash != nil && strings.TrimSpace(*user.EmailHash) != ""
			if looksHashed || !hasHash {
				newHash := sha256Hex(strings.ToLower(email))
				updates := store.UpdateUserParams{
					Email:              &email,
					EmailHash:          &newHash,
					EmailEncryptedNull: true,
				}
				if err := s.PG.UpdateUser(ctx, user.ID, updates); err != nil {
					return nil, ErrServiceUnavailable
				}
			}
		}
	}

	s.RD.SetCachedUserProfile(ctx, user.ID, ud, s.Auth.ProfileCacheTTL)
	return ud, nil
}

func (s *Service) decryptEmail(ctx context.Context, metaRaw, saltHex string) string {
	var payload struct {
		Encrypted string `json:"encrypted"`
		IV        string `json:"iv"`
		AuthTag   string `json:"authTag"`
		V         int    `json:"v"`
	}
	if err := unmarshalJSON([]byte(metaRaw), &payload); err != nil {
		return ""
	}
	plain, err := decryptPayloadFields(
		s.EncryptionKey, saltHex, payload.V, payload.Encrypted, payload.IV, payload.AuthTag,
		s.Auth.EncryptionPbkdfIterations, s.Auth.PbkdfIterationsLegacy, s.Auth.EncryptionKeyLength,
	)
	if err != nil {
		return ""
	}
	var d struct {
		Value string `json:"value"`
	}
	if err := unmarshalJSON(plain, &d); err != nil {
		return ""
	}
	return strings.TrimSpace(d.Value)
}

func hex64Str(v string) bool {
	if len(v) != 64 {
		return false
	}
	for i := 0; i < len(v); i++ {
		c := v[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

func boolOf(v any) bool {
	b, _ := v.(bool)
	return b
}
