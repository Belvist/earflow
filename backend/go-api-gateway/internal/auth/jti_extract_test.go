package auth

import "testing"

func TestExtractJTIFromRefreshToken(t *testing.T) {
	// unsigned sample shape only — production tokens are RS256 from auth-service
	token := "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJ0ZXN0LWp0aS0xMjMifQ.sig"
	got := extractJTIFromRefreshToken(token)
	if got != "test-jti-123" {
		t.Fatalf("jti=%q", got)
	}
}

func TestExtractSIDFromRefreshToken(t *testing.T) {
	// base64url of {"sid":"node-sid-abc","jti":"jti-1"}
	token := "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzaWQiOiJub2RlLXNpZC1hYmMiLCJqdGkiOiJqdGktMSJ9.sig"
	if got := extractSIDFromRefreshToken(token); got != "node-sid-abc" {
		t.Fatalf("sid=%q", got)
	}
	if got := extractJTIFromRefreshToken(token); got != "jti-1" {
		t.Fatalf("jti=%q", got)
	}
	if got := extractSIDFromRefreshToken(""); got != "" {
		t.Fatalf("empty token sid=%q", got)
	}
}
