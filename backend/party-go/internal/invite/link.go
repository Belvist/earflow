// Package invite: signed invite link payloads (compatible with old party-service HMAC).
package invite

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

type linkPayload struct {
	P string `json:"p"`
	E int64  `json:"e"`
	S string `json:"s"`
}

func sign(secret, partyID string, expMs int64) string {
	data := fmt.Sprintf("%s:%d", partyID, expMs)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(data))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// VerifyLink decodes path payload (base64url JSON) and checks HMAC + expiry.
func VerifyLink(secret, b64 string) (partyID string, err error) {
	if secret == "" {
		return "", errors.New("empty secret")
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(b64))
	if err != nil {
		return "", errors.New("invalid payload")
	}
	var lp linkPayload
	if err := json.Unmarshal(raw, &lp); err != nil {
		return "", err
	}
	if lp.P == "" || lp.E <= 0 || lp.S == "" {
		return "", errors.New("invalid fields")
	}
	if time.Now().UnixMilli() > lp.E {
		return "", errors.New("INVITE_EXPIRED")
	}
	expected := sign(secret, lp.P, lp.E)
	eb, derr := base64.RawURLEncoding.DecodeString(expected)
	gb, gerr := base64.RawURLEncoding.DecodeString(lp.S)
	if derr != nil || gerr != nil {
		return "", errors.New("invalid signature")
	}
	if len(eb) != len(gb) || subtle.ConstantTimeCompare(eb, gb) != 1 {
		return "", errors.New("INVALID_SIGNATURE")
	}
	return lp.P, nil
}

// CreateLinkToken builds base64url JSON {p,e,s} for GET /api/party/join/:payload
func CreateLinkToken(secret, partyID string, ttl time.Duration) (payload string, expiresAt time.Time, err error) {
	if secret == "" {
		return "", time.Time{}, errors.New("empty secret")
	}
	expiresAt = time.Now().Add(ttl)
	expMs := expiresAt.UnixMilli()
	s := sign(secret, partyID, expMs)
	b, err := json.Marshal(linkPayload{P: partyID, E: expMs, S: s})
	if err != nil {
		return "", time.Time{}, err
	}
	return base64.RawURLEncoding.EncodeToString(b), expiresAt, nil
}
