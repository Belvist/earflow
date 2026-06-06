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
