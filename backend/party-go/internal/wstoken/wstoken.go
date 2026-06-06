// Package wstoken implements HMAC-SHA256 signed WebSocket access tokens
// (payload base64url . signature base64url) compatible with the former Node
// party-state / party-gateway services.
package wstoken

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// Claims is the v1 wire format for party WS.
type Claims struct {
	V       int    `json:"v"`
	PartyID string `json:"partyId"`
	UserID  string `json:"userId"`
	ExpMS   int64  `json:"expMs"`
	Nonce   string `json:"nonce"`
}

func b64urlEncode(b []byte) string {
	return base64.RawURLEncoding.EncodeToString(b)
}

func b64urlDecode(s string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(s)
}

// Sign creates token = b64url(JSON).b64url(HMAC-SHA256(secret, b64url(JSON))).
func Sign(secret string, c Claims) (string, error) {
	if secret == "" {
		return "", errors.New("empty secret")
	}
	if c.Nonce == "" {
		return "", errors.New("empty nonce")
	}
	payload, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	payloadB64 := b64urlEncode(payload)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payloadB64))
	sigB64 := b64urlEncode(mac.Sum(nil))
	return payloadB64 + "." + sigB64, nil
}

// Verify parses and checks token, including expiry.
func Verify(secret, token string) (*Claims, error) {
	if secret == "" {
		return nil, errors.New("empty secret")
	}
	t := strings.TrimSpace(token)
	dot := strings.LastIndex(t, ".")
	if dot <= 0 || dot == len(t)-1 {
		return nil, errors.New("invalid format")
	}
	payloadB64 := t[:dot]
	sigB64 := t[dot+1:]
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payloadB64))
	expected := mac.Sum(nil)
	got, err := b64urlDecode(sigB64)
	if err != nil {
		return nil, err
	}
	if len(got) != len(expected) || subtle.ConstantTimeCompare(got, expected) != 1 {
		return nil, errors.New("bad signature")
	}
	payload, err := b64urlDecode(payloadB64)
	if err != nil {
		return nil, err
	}
	var c Claims
	if err := json.Unmarshal(payload, &c); err != nil {
		return nil, err
	}
	if c.V != 1 {
		return nil, errors.New("bad v")
	}
	if c.PartyID == "" || c.UserID == "" || c.Nonce == "" {
		return nil, errors.New("missing fields")
	}
	if c.ExpMS <= 0 {
		return nil, errors.New("bad exp")
	}
	if time.Now().UnixMilli() > c.ExpMS {
		return nil, errors.New("expired")
	}
	return &c, nil
}

// RandomNonce returns 16 random bytes, base64url.
func RandomNonce() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return b64urlEncode(b), nil
}
