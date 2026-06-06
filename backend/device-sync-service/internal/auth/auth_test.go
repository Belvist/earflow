package auth

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/earflow/music-platform/device-sync-service/internal/config"
	"github.com/golang-jwt/jwt/v5"
)

func signedAccessToken(t *testing.T, secret []byte, issuer, audience string) string {
	t.Helper()
	claims := jwt.MapClaims{
		"sub":      "user-1",
		"username": "Alice",
		"iat":      time.Now().Unix(),
		"exp":      time.Now().Add(time.Hour).Unix(),
		"iss":      issuer,
		"aud":      audience,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(secret)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return signed
}

func TestIdentifyBearerValidatesIssuerAndAudience(t *testing.T) {
	cfg := &config.Config{
		JWTSecret:   []byte("01234567890123456789012345678901"),
		JWTIssuer:   "earflow-auth",
		JWTAudience: "earflow-api",
	}
	req := httptest.NewRequest("GET", "/api/devices", nil)
	req.Header.Set("Authorization", "Bearer "+signedAccessToken(t, cfg.JWTSecret, "evil-issuer", "earflow-api"))

	if user, err := Identify(req, cfg); err == nil || user != nil {
		t.Fatalf("expected issuer mismatch to reject bearer token, user=%v err=%v", user, err)
	}
}

func TestIdentifyBearerAcceptsExpectedIssuerAndAudience(t *testing.T) {
	cfg := &config.Config{
		JWTSecret:   []byte("01234567890123456789012345678901"),
		JWTIssuer:   "earflow-auth",
		JWTAudience: "earflow-api",
	}
	req := httptest.NewRequest("GET", "/api/devices", nil)
	req.Header.Set("Authorization", "Bearer "+signedAccessToken(t, cfg.JWTSecret, "earflow-auth", "earflow-api"))

	user, err := Identify(req, cfg)
	if err != nil {
		t.Fatalf("expected token to identify user: %v", err)
	}
	if user == nil || user.ID != "user-1" {
		t.Fatalf("expected user-1, got %#v", user)
	}
}
