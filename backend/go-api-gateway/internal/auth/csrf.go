package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"strings"
)

func GenerateCSRFToken(sid string, secret string) (string, error) {
	nonceRaw := make([]byte, 16)
	_, err := rand.Read(nonceRaw)
	if err != nil {
		return "", err
	}
	nonce := base64.RawURLEncoding.EncodeToString(nonceRaw)
	sig := hmacSHA256Base64URL(secret, sid+"."+nonce)
	return nonce + "." + sig, nil
}

func VerifyCSRFToken(sid string, secret string, token string) bool {
	if sid == "" || secret == "" || token == "" {
		return false
	}
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return false
	}
	nonce, sig := parts[0], parts[1]
	if nonce == "" || sig == "" {
		return false
	}
	expected := hmacSHA256Base64URL(secret, sid+"."+nonce)
	if len(sig) != len(expected) {
		return false
	}
	return hmac.Equal([]byte(sig), []byte(expected))
}

func hmacSHA256Base64URL(secret string, data string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(data))
	sum := mac.Sum(nil)
	return base64.RawURLEncoding.EncodeToString(sum)
}
