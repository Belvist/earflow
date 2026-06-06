package proxy

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"
)

func signPartyWebSocketTestToken(t *testing.T, secret string, claims partyWebSocketClaims) string {
	t.Helper()
	payload, err := json.Marshal(claims)
	if err != nil {
		t.Fatalf("marshal claims: %v", err)
	}
	payloadB64 := base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payloadB64))
	return payloadB64 + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func TestVerifyPartyWebSocketTokenAcceptsValidHMACTicket(t *testing.T) {
	secret := "test-party-secret"
	now := time.UnixMilli(1_800_000_000_000)
	token := signPartyWebSocketTestToken(t, secret, partyWebSocketClaims{
		V:       1,
		PartyID: "party-1",
		UserID:  "user-7",
		ExpMS:   now.Add(time.Minute).UnixMilli(),
		Nonce:   "nonce",
	})

	claims, err := verifyPartyWebSocketToken(secret, token, now)
	if err != nil {
		t.Fatalf("verifyPartyWebSocketToken returned error: %v", err)
	}
	if claims.PartyID != "party-1" || claims.UserID != "user-7" {
		t.Fatalf("claims = %+v, want party-1/user-7", claims)
	}
}

func TestAuthorizePartyWebSocketRequestInjectsUserHeaderFromWsToken(t *testing.T) {
	t.Setenv("PARTY_V2_WS_TOKEN_SECRET", "test-party-secret")
	t.Setenv("JWT_SECRET", "fallback-secret")

	token := signPartyWebSocketTestToken(t, "test-party-secret", partyWebSocketClaims{
		V:       1,
		PartyID: "party-1",
		UserID:  "user-7",
		ExpMS:   time.Now().Add(time.Minute).UnixMilli(),
		Nonce:   "nonce",
	})

	req := httptest.NewRequest("GET", "/ws/v2?wsToken="+token, nil)
	claims, ok := authorizePartyWebSocketRequest(req)
	if !ok {
		t.Fatal("authorizePartyWebSocketRequest returned false")
	}
	if claims.UserID != "user-7" {
		t.Fatalf("claims.UserID = %q, want user-7", claims.UserID)
	}
	if got := req.Header.Get(headerUserID); got != "user-7" {
		t.Fatalf("X-User-Id = %q, want user-7", got)
	}
	if got := req.Header.Get(headerUserIDLower); got != "user-7" {
		t.Fatalf("x-user-id = %q, want user-7", got)
	}
}

func TestVerifyPartyWebSocketTokenRejectsExpiredTicket(t *testing.T) {
	secret := "test-party-secret"
	now := time.UnixMilli(1_800_000_000_000)
	token := signPartyWebSocketTestToken(t, secret, partyWebSocketClaims{
		V:       1,
		PartyID: "party-1",
		UserID:  "user-7",
		ExpMS:   now.Add(-time.Second).UnixMilli(),
		Nonce:   "nonce",
	})

	if _, err := verifyPartyWebSocketToken(secret, token, now); err == nil {
		t.Fatal("verifyPartyWebSocketToken accepted an expired ticket")
	}
}
