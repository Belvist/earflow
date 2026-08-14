package authn

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"sort"
	"strings"
	"time"
)

// TelegramAuthPayload is the normalized Telegram login widget payload.
type TelegramAuthPayload struct {
	ID        int64
	AuthDate  int64
	Hash      string
	FirstName *string
	LastName  *string
	Username  *string
	PhotoURL  *string
}

// NormalizeTelegramAuthPayload validates shape and returns the payload or nil.
// Mirrors Node normalizeTelegramAuthPayload.
func NormalizeTelegramAuthPayload(raw map[string]any) *TelegramAuthPayload {
	if raw == nil {
		return nil
	}
	id := toInt64(raw["id"])
	authDate := toInt64(raw["auth_date"])
	hash := strings.TrimSpace(stringOf(raw["hash"]))

	if id <= 0 || authDate <= 0 {
		return nil
	}
	if len(hash) < 20 || len(hash) > 256 {
		return nil
	}

	return &TelegramAuthPayload{
		ID:        id,
		AuthDate:  authDate,
		Hash:      hash,
		FirstName: nullableStringPtr(raw["first_name"]),
		LastName:  nullableStringPtr(raw["last_name"]),
		Username:  nullableStringPtr(raw["username"]),
		PhotoURL:  nullableStringPtr(raw["photo_url"]),
	}
}

func buildTelegramDataCheckString(p map[string]string) string {
	keys := make([]string, 0, len(p))
	for k := range p {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for i, k := range keys {
		if i > 0 {
			b.WriteString("\n")
		}
		b.WriteString(k)
		b.WriteString("=")
		b.WriteString(p[k])
	}
	return b.String()
}

// VerifyTelegramAuth validates the Telegram login widget signature.
// Mirrors Node verifyTelegramAuth (data-check-string + HMAC-SHA256 of the bot
// token's SHA-256, with the 24h / +5min auth_date window).
func VerifyTelegramAuth(payload *TelegramAuthPayload, botToken string) bool {
	if payload == nil {
		return false
	}
	token := strings.TrimSpace(botToken)
	if len(token) >= 2 {
		q := token[0]
		if (q == '"' || q == '\'') && token[len(token)-1] == q {
			token = strings.TrimSpace(token[1 : len(token)-1])
		}
	}
	if token == "" {
		return false
	}

	nowSec := time.Now().Unix()
	authDate := payload.AuthDate
	if authDate <= 0 {
		return false
	}
	if authDate > nowSec+5*60 {
		return false
	}
	if nowSec-authDate > 24*60*60 {
		return false
	}

	fields := map[string]string{"id": itoa(payload.ID), "auth_date": itoa(authDate)}
	if payload.FirstName != nil {
		fields["first_name"] = *payload.FirstName
	}
	if payload.LastName != nil {
		fields["last_name"] = *payload.LastName
	}
	if payload.Username != nil {
		fields["username"] = *payload.Username
	}
	if payload.PhotoURL != nil {
		fields["photo_url"] = *payload.PhotoURL
	}

	dataCheck := buildTelegramDataCheckString(fields)
	secretKey := sha256.Sum256([]byte(token))
	mac := hmac.New(sha256.New, secretKey[:])
	mac.Write([]byte(dataCheck))
	expectedHex := hex.EncodeToString(mac.Sum(nil))

	got := strings.ToLower(strings.TrimSpace(payload.Hash))
	if len(expectedHex) != len(got) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expectedHex), []byte(got)) == 1
}

// NewHexBytes returns an n-byte random value as lowercase hex (like Node
// crypto.randomBytes(n).toString('hex')).
func NewHexBytes(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func stringOf(v any) string {
	if v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return itoa(int64(t))
	case int64:
		return itoa(t)
	case int:
		return itoa(int64(t))
	default:
		return ""
	}
}

func toInt64(v any) int64 {
	switch t := v.(type) {
	case float64:
		return int64(t)
	case int64:
		return t
	case int:
		return int64(t)
	case jsonNumber:
		n, _ := t.Int64()
		return n
	default:
		return 0
	}
}

func nullableStringPtr(v any) *string {
	if v == nil {
		return nil
	}
	s := strings.TrimSpace(stringOf(v))
	if s == "" {
		return nil
	}
	return &s
}

type jsonNumber interface{ Int64() (int64, error) }
