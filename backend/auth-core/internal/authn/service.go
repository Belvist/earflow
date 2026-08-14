package authn

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/earflow/music-platform/auth-core/internal/config"
	"github.com/earflow/music-platform/auth-core/internal/cryptoutil"
	"github.com/earflow/music-platform/auth-core/internal/store"
)

// UserReader is the subset of the user store the auth flow needs for reads.
type UserReader interface {
	GetUserByID(ctx context.Context, id int64) (*store.AuthUser, error)
}

// Service implements the Node auth-service behaviours (email register/login,
// telegram login, refresh rotation, verify, profile) against direct Postgres
// access and Redis session state.
type Service struct {
	PG *store.Postgres
	RD *store.RedisClient
	// Users is the read source for user rows (defaults to PG, overridable in tests).
	Users UserReader

	JWTSecret     []byte
	JWTIssuer     string
	JWTAudience   string
	EncryptionKey []byte
	Auth          config.AuthConfig
	decoySalt     string
}

func NewService(pg *store.Postgres, rd *store.RedisClient, cfg config.Config) *Service {
	decoySalt := cfg.Auth.DecoySalt
	if decoySalt == "" {
		if b, err := NewHexBytes(32); err == nil {
			decoySalt = b
		}
	}
	return &Service{
		PG:            pg,
		Users:         pg,
		RD:            rd,
		JWTSecret:     cfg.JWT.Secret,
		JWTIssuer:     cfg.JWT.Issuer,
		JWTAudience:   cfg.JWT.Audience,
		EncryptionKey: cfg.Crypto.EncryptionKey,
		Auth:          cfg.Auth,
		decoySalt:     decoySalt,
	}
}

// APIError is a client-facing error carrying an HTTP status.
type APIError struct {
	Status         int
	Message        string
	Code           string
	Recoverable    bool
	ReauthRequired bool
	RetryAfter     time.Duration
}

var (
	ErrServiceUnavailable = &APIError{Status: 503, Message: "Сервис временно недоступен", Code: "SERVICE_UNAVAILABLE"}
	ErrInvalidJWT         = &APIError{Status: 401, Message: "Недействительный токен", Code: "INVALID_TOKEN"}
	ErrTokenMissing       = &APIError{Status: 400, Message: "Токен отсутствует", Code: "TOKEN_MISSING"}
)

// AuthResult is the login/register/telegram exchange payload.
type AuthResult struct {
	Token        string
	RefreshToken string
	User         map[string]any
}

// RegisterEmail mirrors Node handleEmailRegister.
func (s *Service) RegisterEmail(ctx context.Context, email, password, firstName, username string) (*AuthResult, *APIError) {
	if email == "" || password == "" {
		return nil, &APIError{Status: 400, Message: "Email и пароль обязательны", Code: "EMAIL_PASSWORD_REQUIRED"}
	}
	if !isValidEmail(email) {
		return nil, &APIError{Status: 400, Message: "Неверный формат email", Code: "INVALID_EMAIL"}
	}
	if len(password) < 8 {
		return nil, &APIError{Status: 400, Message: "Пароль должен быть минимум 8 символов", Code: "PASSWORD_TOO_SHORT"}
	}
	if !hasLetterAndDigit(password) {
		return nil, &APIError{Status: 400, Message: "Пароль должен содержать буквы и цифры", Code: "PASSWORD_TOO_WEAK"}
	}

	normalized := strings.ToLower(strings.TrimSpace(email))
	emailHash := sha256Hex(normalized)

	safeFirstName := SanitizeProfileField(firstName)
	safeUsername := SanitizeUsername(username)
	if username != "" && safeUsername == nil {
		return nil, &APIError{Status: 400, Message: "Неверный username", Code: "INVALID_USERNAME"}
	}

	existing, err := s.PG.GetUserByEmailOrHash(ctx, emailHash)
	if err != nil && err != store.ErrUserNotFound {
		return nil, ErrServiceUnavailable
	}
	if existing != nil {
		return nil, &APIError{Status: 400, Message: "Email уже зарегистрирован", Code: "EMAIL_TAKEN"}
	}

	userSalt, err := NewHexBytes(32)
	if err != nil {
		return nil, ErrServiceUnavailable
	}
	passwordHash := cryptoutil.HashPassword(password, userSalt, s.Auth.PbkdfIterations, s.Auth.PbkdfKeyLength)

	var metadata *string
	if safeFirstName != nil {
		plain := marshalJSON(map[string]any{"firstName": *safeFirstName, "lastName": nil})
		enc, err := encryptJSON(s.EncryptionKey, userSalt, plain, s.Auth.EncryptionPbkdfIterations, s.Auth.EncryptionKeyLength)
		if err == nil {
			encRaw := string(marshalJSON(enc))
			metadata = &encRaw
		}
	}

	usernameValue := usernameDefault(normalized, safeUsername)
	user, err := s.PG.CreateUser(ctx, store.CreateUserParams{
		Email:        &normalized,
		EmailHash:    &emailHash,
		PasswordHash: &passwordHash,
		Username:     usernameValue,
		Salt:         &userSalt,
		Metadata:     metadata,
	})
	if err != nil {
		// UNIQUE-виолейшн (гонка двух параллельных регистраций одного email) —
		// эквивалент "уже зарегистрирован", не 503.
		if errors.Is(err, store.ErrUserConflict) {
			return nil, &APIError{Status: 400, Message: "Email уже зарегистрирован", Code: "EMAIL_TAKEN"}
		}
		return nil, ErrServiceUnavailable
	}
	s.audit(ctx, "register", "userId", user.ID, "emailHash", emailHash, "ip", ipFromCtx(ctx), "ua", uaFromCtx(ctx))

	exchange, apiErr := s.newExchange(ctx, user.ID, user.IsAdmin, time.Now().UTC())
	if apiErr != nil {
		return nil, apiErr
	}

	return &AuthResult{
		Token:        exchange.Token,
		RefreshToken: exchange.RefreshToken,
		User:         map[string]any{"id": user.ID, "username": user.Username},
	}, nil
}

// LoginEmail mirrors Node handleEmailLogin.
func (s *Service) LoginEmail(ctx context.Context, email, password string) (*AuthResult, *APIError) {
	if email == "" || password == "" {
		return nil, &APIError{Status: 400, Message: "Email и пароль обязательны", Code: "EMAIL_PASSWORD_REQUIRED"}
	}

	ip := ipFromCtx(ctx)

	normalized := strings.ToLower(strings.TrimSpace(email))
	emailHash := sha256Hex(normalized)

	if blocked, retry := s.RD.LoginLockoutStatus(ctx, emailHash); blocked {
		s.audit(ctx, "login_locked", "emailHash", emailHash, "ip", ip, "ua", uaFromCtx(ctx))
		return nil, &APIError{Status: 429, Message: "Слишком много неудачных попыток. Попробуйте позже.", Code: "LOGIN_LOCKED", RetryAfter: retry}
	}
	if blocked, _ := s.RD.CheckIPFailures(ctx, ip, s.Auth.AuthEndpointIPMax); blocked {
		s.audit(ctx, "login_ip_blocked", "ip", ip, "ua", uaFromCtx(ctx))
		return nil, &APIError{Status: 429, Message: "Слишком много попыток входа. Попробуйте позже.", Code: "LOGIN_RATE_LIMITED"}
	}

	user, err := s.PG.GetUserByEmailOrHash(ctx, emailHash)
	passwordMissing := err == store.ErrUserNotFound
	if err != nil && err != store.ErrUserNotFound {
		return nil, ErrServiceUnavailable
	}
	if user == nil || user.PasswordHash == nil || strings.TrimSpace(*user.PasswordHash) == "" || user.Salt == nil {
		s.burnDecoy(password)
		_ = s.RD.RecordIPFailure(ctx, ip, s.Auth.AuthEndpointIPMax, s.Auth.AuthEndpointIPWindow, s.Auth.AuthEndpointIPWindow)
		s.RD.RecordLoginFailure(ctx, emailHash, s.Auth.LoginFailMax, s.Auth.LoginFailWindow, s.Auth.LoginLockSeconds)
		s.audit(ctx, "login_fail", "emailHash", emailHash, "ip", ip, "ua", uaFromCtx(ctx))
		if passwordMissing {
			return nil, &APIError{Status: 401, Message: "Неверный email или пароль", Code: "INVALID_CREDENTIALS"}
		}
		return nil, &APIError{Status: 401, Message: "Неверный email или пароль", Code: "INVALID_CREDENTIALS"}
	}

	computed := cryptoutil.HashPassword(password, *user.Salt, s.Auth.PbkdfIterations, s.Auth.PbkdfKeyLength)
	matched := cryptoutil.ConstantTimeHexEquals(computed, *user.PasswordHash)
	needsRehash := false
	if !matched {
		legacy := cryptoutil.HashPassword(password, *user.Salt, s.Auth.PbkdfIterationsLegacy, s.Auth.PbkdfKeyLength)
		if !cryptoutil.ConstantTimeHexEquals(legacy, *user.PasswordHash) {
			_ = s.RD.RecordIPFailure(ctx, ip, s.Auth.AuthEndpointIPMax, s.Auth.AuthEndpointIPWindow, s.Auth.AuthEndpointIPWindow)
			s.RD.RecordLoginFailure(ctx, emailHash, s.Auth.LoginFailMax, s.Auth.LoginFailWindow, s.Auth.LoginLockSeconds)
			s.audit(ctx, "login_fail", "emailHash", emailHash, "ip", ip, "ua", uaFromCtx(ctx))
			return nil, &APIError{Status: 401, Message: "Неверный email или пароль", Code: "INVALID_CREDENTIALS"}
		}
		needsRehash = true
	}

	s.RD.ClearLoginFailures(ctx, emailHash)

	now := time.Now().UTC()
	updates := store.UpdateUserParams{LastLogin: &now}
	if needsRehash {
		newHash := cryptoutil.HashPassword(password, *user.Salt, s.Auth.PbkdfIterations, s.Auth.PbkdfKeyLength)
		updates.PasswordHash = &newHash
	}
	if err := s.PG.UpdateUser(ctx, user.ID, updates); err != nil {
		return nil, ErrServiceUnavailable
	}

	exchange, apiErr := s.newExchange(ctx, user.ID, user.IsAdmin, now)
	if apiErr != nil {
		return nil, apiErr
	}

	ud := baseUserData(user, user.IsAdmin)
	s.mergeDecryptedMetadata(ctx, ud, user, true)
	s.RD.SetCachedUserProfile(ctx, user.ID, ud, s.Auth.ProfileCacheTTL)
	s.audit(ctx, "login_success", "userId", user.ID, "ip", ip, "ua", uaFromCtx(ctx), "rehased", needsRehash)

	return &AuthResult{Token: exchange.Token, RefreshToken: exchange.RefreshToken, User: ud}, nil
}

// newExchange issues the refresh session + access token (Node common tail of
// login/register/telegram).
func (s *Service) newExchange(ctx context.Context, userID int64, isAdmin bool, now time.Time) (*AuthResult, *APIError) {
	sid, err := NewHexBytes(16)
	if err != nil {
		return nil, ErrServiceUnavailable
	}
	jti, err := NewHexBytes(16)
	if err != nil {
		return nil, ErrServiceUnavailable
	}

	refreshToken, err := IssueRefreshToken(s.JWTSecret, s.JWTIssuer, s.JWTAudience, s.Auth.RefreshJWTExpire, userID, sid, jti)
	if err != nil {
		return nil, ErrServiceUnavailable
	}
	ttl := s.refreshTTL(refreshToken)

	if err := s.RD.StoreRefreshSession(ctx, sid, jti, userID, isAdmin, ttl, now, ipFromCtx(ctx), uaFromCtx(ctx)); err != nil {
		return nil, ErrServiceUnavailable
	}

	accessToken, err := IssueAccessToken(s.JWTSecret, s.JWTIssuer, s.JWTAudience, s.Auth.AccessJWTExpire, userID, sid, isAdmin)
	if err != nil {
		return nil, ErrServiceUnavailable
	}

	return &AuthResult{Token: accessToken, RefreshToken: refreshToken}, nil
}

// refreshTTL estimates the refresh token TTL from its exp claim.
func (s *Service) refreshTTL(refreshToken string) time.Duration {
	claims := &RefreshClaims{}
	if err := parse(s.JWTSecret, s.JWTIssuer, s.JWTAudience, refreshToken, claims); err != nil {
		return s.Auth.RefreshJWTExpire
	}
	if claims.ExpiresAt != nil {
		d := time.Until(claims.ExpiresAt.Time)
		if d > 0 {
			return d
		}
	}
	return s.Auth.RefreshJWTExpire
}

func (s *Service) burnDecoy(password string) {
	if s.decoySalt == "" {
		return
	}
	pw := password
	if strings.TrimSpace(pw) == "" {
		pw = "decoy"
	}
	_ = cryptoutil.HashPassword(pw, s.decoySalt, s.Auth.PbkdfIterations, s.Auth.PbkdfKeyLength)
}

// audit appends a security/ops event to the Redis audit stream (fire-and-forget,
// never blocks request path). Fields are key/value pairs.
func (s *Service) audit(ctx context.Context, event string, fields ...any) {
	data := make(map[string]any, len(fields)/2)
	for i := 0; i+1 < len(fields); i += 2 {
		if k, ok := fields[i].(string); ok {
			data[k] = fields[i+1]
		}
	}
	s.RD.Audit(ctx, event, data)
}

// resolveIsAdmin loads the admin flag with a short cache (mirrors Node
// resolveIsAdminFromDb).
func (s *Service) resolveIsAdmin(ctx context.Context, userID int64, fallback bool) bool {
	if cached, ok := s.RD.GetCachedIsAdmin(ctx, userID); ok {
		return cached
	}
	user, err := s.Users.GetUserByID(ctx, userID)
	if err != nil {
		return fallback
	}
	s.RD.SetCachedIsAdmin(ctx, userID, user.IsAdmin, s.Auth.AdminFlagCacheTTL)
	return user.IsAdmin
}

func baseUserData(u *store.AuthUser, isAdmin bool) map[string]any {
	return map[string]any{
		"id":           u.ID,
		"username":     u.Username,
		"photoUrl":     nullableString(u.PhotoURL),
		"isAdmin":      isAdmin,
		"mfaEnabled":   u.MFAEnabled,
		"mfaEnabledAt": nullableTime(u.MFAEnabledAt),
		"hasPassword":  hasPassword(u),
		"hasTelegram":  hasTelegramAccount(u),
	}
}

func hasPassword(u *store.AuthUser) bool {
	return u.PasswordHash != nil && strings.TrimSpace(*u.PasswordHash) != ""
}

func hasTelegramAccount(u *store.AuthUser) bool {
	if u.TelegramID == nil {
		return false
	}
	return *u.TelegramID != 0
}

// mergeDecryptedMetadata decrypts users.metadata (Node encryptData payload for
// {firstName,lastName}) and adds the fields to the user map when present.
func (s *Service) mergeDecryptedMetadata(ctx context.Context, m map[string]any, u *store.AuthUser, sanitize bool) {
	if u.Metadata == nil || u.Salt == nil || strings.TrimSpace(*u.Metadata) == "" || s.EncryptionKey == nil {
		return
	}
	fn, ln := s.decryptNameMetadata(ctx, *u.Metadata, *u.Salt)
	if fn != "" {
		if sanitize {
			if v := SanitizeProfileField(fn); v != nil {
				m["firstName"] = *v
			}
		} else {
			m["firstName"] = fn
		}
	}
	if ln != "" {
		if sanitize {
			if v := SanitizeProfileField(ln); v != nil {
				m["lastName"] = *v
			}
		} else {
			m["lastName"] = ln
		}
	}
}

func (s *Service) decryptNameMetadata(ctx context.Context, metaRaw, saltHex string) (string, string) {
	var payload cryptoutil.EncryptedPayload
	if err := unmarshalJSON([]byte(metaRaw), &payload); err != nil {
		return "", ""
	}
	plain, err := cryptoutil.DecryptPayload(
		s.EncryptionKey, saltHex, payload,
		s.Auth.EncryptionPbkdfIterations, s.Auth.PbkdfIterationsLegacy, s.Auth.EncryptionKeyLength,
	)
	if err != nil {
		return "", ""
	}
	var d struct {
		FirstName string `json:"firstName"`
		LastName  string `json:"lastName"`
	}
	if err := unmarshalJSON(plain, &d); err != nil {
		return "", ""
	}
	return strings.TrimSpace(d.FirstName), strings.TrimSpace(d.LastName)
}

// --- helpers ----------------------------------------------------------------

type ctxKey string

var (
	clientIPKey ctxKey = "client_ip"
	clientUAKey ctxKey = "client_ua"
)

func WithClientMetadata(ctx context.Context, ip, ua string) context.Context {
	ctx = context.WithValue(ctx, clientIPKey, ip)
	ctx = context.WithValue(ctx, clientUAKey, ua)
	return ctx
}

func ipFromCtx(ctx context.Context) string {
	v, _ := ctx.Value(clientIPKey).(string)
	return v
}

func uaFromCtx(ctx context.Context) string {
	v, _ := ctx.Value(clientUAKey).(string)
	return v
}

var (
	emailRe       = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
	letterRe      = regexp.MustCompile(`[A-Za-z]`)
	digitRe       = regexp.MustCompile(`[0-9]`)
	usernameRe    = regexp.MustCompile(`^[A-Za-zА-Яа-яЁё0-9._-]{3,32}$`)
	unsafeCharsRe = regexp.MustCompile(`[<>\r\n]`)
)

func isValidEmail(v string) bool { return emailRe.MatchString(v) }

func hasLetterAndDigit(v string) bool {
	return letterRe.MatchString(v) && digitRe.MatchString(v)
}

// SanitizeProfileField mirrors Node sanitizeProfileField.
func SanitizeProfileField(value string) *string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	trimmed := strings.TrimSpace(value)
	trimmed = truncateRunes(trimmed, 64)
	trimmed = unsafeCharsRe.ReplaceAllString(trimmed, "")
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

// SanitizeUsername mirrors Node sanitizeUsername.
func SanitizeUsername(value string) *string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	normalized := strings.TrimPrefix(strings.TrimSpace(value), "@")
	normalized = strings.Map(func(r rune) rune {
		if r == ' ' || r == '\t' || r == '\n' || r == '\r' {
			return -1
		}
		return r
	}, normalized)
	normalized = truncateRunes(normalized, 32)
	normalized = unsafeCharsRe.ReplaceAllString(normalized, "")
	if !usernameRe.MatchString(normalized) {
		return nil
	}
	return &normalized
}

// truncateRunes limits a string by runes (not bytes) — Node .slice() truncates
// by UTF-16 code units, so Cyrillic usernames must not be split mid-rune.
func truncateRunes(s string, max int) string {
	runs := []rune(s)
	if len(runs) > max {
		return string(runs[:max])
	}
	return s
}

// usernameDefault mirrors Node's sha256(email).hex.substring(0,16).
func usernameDefault(emailHashOrEmail string, safeUsername *string) string {
	if safeUsername != nil {
		return *safeUsername
	}
	h := sha256.Sum256([]byte(emailHashOrEmail))
	return hex.EncodeToString(h[:8])
}

func sha256Hex(v string) string {
	h := sha256.Sum256([]byte(v))
	return hex.EncodeToString(h[:])
}

func nullableString(v *string) any {
	if v == nil {
		return nil
	}
	return *v
}

func nullableTime(v *time.Time) any {
	if v == nil {
		return nil
	}
	return v.UTC().Format(time.RFC3339)
}
