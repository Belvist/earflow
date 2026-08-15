package auth

import (
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

// TestL20EmptyIssuerNoLongerRejectsTaggedTokens: when issuer is not configured
// but audience is, tokens carrying an issuer tag must still validate (the old
// code forced iss == "" and rejected them).
func TestL20EmptyIssuerNoLongerRejectsTaggedTokens(t *testing.T) {
	m := &SessionManager{
		jwtIssuer:   "",                // issuer NOT configured
		jwtAudience: "earflow-gateway", // audience configured
	}
	claims := jwt.MapClaims{"iss": "some-issuer", "aud": "earflow-gateway"}
	if !m.verifyIssuerAudience(claims) {
		t.Fatal("tagged token rejected with unconfigured issuer")
	}

	// Audience enforcement still applies.
	if m.verifyIssuerAudience(jwt.MapClaims{"iss": "some-issuer", "aud": "other"}) {
		t.Fatal("wrong audience accepted")
	}
}

// TestL20ConfiguredIssuerStillEnforced: when issuer IS configured, a mismatch
// must be rejected and a match accepted.
func TestL20ConfiguredIssuerStillEnforced(t *testing.T) {
	m := &SessionManager{
		jwtIssuer:   "earflow",
		jwtAudience: "earflow-gateway",
	}
	if m.verifyIssuerAudience(jwt.MapClaims{"iss": "evil", "aud": "earflow-gateway"}) {
		t.Fatal("wrong issuer accepted")
	}
	if !m.verifyIssuerAudience(jwt.MapClaims{"iss": "earflow", "aud": "earflow-gateway"}) {
		t.Fatal("correct issuer rejected")
	}
}
