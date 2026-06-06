package proxy

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"
)

type partyWebSocketClaims struct {
	V       int    `json:"v"`
	PartyID string `json:"partyId"`
	UserID  string `json:"userId"`
	ExpMS   int64  `json:"expMs"`
	Nonce   string `json:"nonce"`
}

func authorizePartyWebSocketRequest(r *http.Request) (*partyWebSocketClaims, bool) {
	if r == nil {
		return nil, false
	}
	raw := strings.TrimSpace(r.URL.Query().Get("wsToken"))
	if raw == "" {
		raw = strings.TrimSpace(r.URL.Query().Get("ticket"))
	}
	if raw == "" {
		return nil, false
	}

	secret := strings.TrimSpace(os.Getenv("PARTY_V2_WS_TOKEN_SECRET"))
	if secret == "" {
		secret = strings.TrimSpace(os.Getenv("JWT_SECRET"))
	}

	claims, err := verifyPartyWebSocketToken(secret, raw, time.Now())
	if err != nil {
		return nil, false
	}

	r.Header.Set(headerUserID, claims.UserID)
	r.Header.Set(headerUserIDLower, claims.UserID)
	return claims, true
}

func verifyPartyWebSocketToken(secret string, token string, now time.Time) (*partyWebSocketClaims, error) {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return nil, errors.New("empty secret")
	}

	tok := strings.TrimSpace(token)
	dot := strings.LastIndex(tok, ".")
	if dot <= 0 || dot == len(tok)-1 || strings.Count(tok, ".") != 1 {
		return nil, errors.New("invalid format")
	}

	payloadB64 := tok[:dot]
	sigB64 := tok[dot+1:]
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payloadB64))
	expected := mac.Sum(nil)

	got, err := base64.RawURLEncoding.DecodeString(sigB64)
	if err != nil {
		return nil, err
	}
	if len(got) != len(expected) || subtle.ConstantTimeCompare(got, expected) != 1 {
		return nil, errors.New("bad signature")
	}

	payload, err := base64.RawURLEncoding.DecodeString(payloadB64)
	if err != nil {
		return nil, err
	}

	var claims partyWebSocketClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return nil, err
	}
	if claims.V != 1 || strings.TrimSpace(claims.PartyID) == "" || strings.TrimSpace(claims.UserID) == "" || strings.TrimSpace(claims.Nonce) == "" {
		return nil, errors.New("missing fields")
	}
	if claims.ExpMS <= 0 {
		return nil, errors.New("bad expiry")
	}
	if now.IsZero() {
		now = time.Now()
	}
	if now.UnixMilli() > claims.ExpMS {
		return nil, errors.New("expired")
	}
	claims.PartyID = strings.TrimSpace(claims.PartyID)
	claims.UserID = strings.TrimSpace(claims.UserID)
	claims.Nonce = strings.TrimSpace(claims.Nonce)
	return &claims, nil
}
