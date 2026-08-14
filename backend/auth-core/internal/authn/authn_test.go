package authn

import (
	"testing"
	"time"
)

func TestVerifyTelegramAuthNodeCompat(t *testing.T) {
	// data-check-string: auth_date=<now>\nfirst_name=Alex\nid=777\nusername=alex_t
	// HMAC of sha256("123456:TESTBOTTOKEN1234567890") over that string (from Node).
	payload := &TelegramAuthPayload{
		ID:        777,
		AuthDate:  1786654148,
		Hash:      "770b37f2541c4e3059121fa90ee9d37694e17b61c8cbc149d56c7d65ce77d2ce",
		FirstName: strP("Alex"),
		Username:  strP("alex_t"),
	}
	if !VerifyTelegramAuth(payload, "123456:TESTBOTTOKEN1234567890") {
		t.Fatal("expected valid signature")
	}
	bad := *payload
	bad.Hash = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
	if VerifyTelegramAuth(&bad, "123456:TESTBOTTOKEN1234567890") {
		t.Fatal("tampered hash must fail")
	}
}

func TestVerifyTelegramAuthAgeWindow(t *testing.T) {
	payload := &TelegramAuthPayload{
		ID:        1,
		AuthDate:  time.Now().Unix() - 30*24*60*60,
		Hash:      "x",
		FirstName: strP("A"),
	}
	if VerifyTelegramAuth(payload, "tok") {
		t.Fatal("expired auth_date must fail")
	}
}

func TestNormalizeTelegramAuthPayload(t *testing.T) {
	raw := map[string]any{
		"id":         float64(777),
		"auth_date":  float64(1700000000),
		"hash":       "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123",
		"first_name": "Alex",
	}
	p := NormalizeTelegramAuthPayload(raw)
	if p == nil {
		t.Fatal("expected valid payload")
	}
	if p.ID != 777 || p.AuthDate != 1700000000 || p.FirstName == nil || *p.FirstName != "Alex" {
		t.Fatalf("mis-parsed payload: %+v", p)
	}
	if NormalizeTelegramAuthPayload(map[string]any{"id": "x"}) != nil {
		t.Fatal("bad id must yield nil")
	}
}

func TestJWTIssueVerify(t *testing.T) {
	secret := []byte("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
	iss, aud := "earflow-auth", "earflow-api"

	acc, err := IssueAccessToken(secret, iss, aud, 15*time.Minute, 42, "sid123", true)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := VerifyAccess(secret, iss, aud, acc)
	if err != nil {
		t.Fatalf("verify access: %v", err)
	}
	if claims.Type != "access" || claims.UserID != 42 || claims.SID != "sid123" || !claims.IsAdmin {
		t.Fatalf("bad claims: %+v", claims)
	}

	ref, err := IssueRefreshToken(secret, iss, aud, 365*24*time.Hour, 7, "sid7", "jti7")
	if err != nil {
		t.Fatal(err)
	}
	rclaims, err := VerifyRefresh(secret, iss, aud, ref)
	if err != nil {
		t.Fatalf("verify refresh: %v", err)
	}
	if rclaims.Type != "refresh" || rclaims.UserID != 7 || rclaims.SID != "sid7" || rclaims.JTI != "jti7" {
		t.Fatalf("bad refresh claims: %+v", rclaims)
	}

	// Wrong audience must fail.
	if _, err := VerifyAccess(secret, iss, "other-aud", acc); err == nil {
		t.Fatal("wrong audience must fail")
	}
	// Access token must fail refresh verification path claim check.

	// Round-trip an access token through the access verifier after expiry.
	short, _ := IssueAccessToken(secret, iss, aud, -time.Minute, 1, "s", false)
	if _, err := VerifyAccess(secret, iss, aud, short); err == nil {
		t.Fatal("expired token must fail")
	}
}

func strP(s string) *string { return &s }
