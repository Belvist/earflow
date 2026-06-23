package stateserver

import (
	"testing"
	"time"
)

func TestLoadConfig_inviteTTLAtLeastSessionTTL(t *testing.T) {
	t.Setenv("JWT_SECRET", "unit-test-secret-not-for-production")
	t.Setenv("PARTY_V2_SESSION_TTL_SECONDS", "7200")
	t.Setenv("PARTY_V2_INVITE_TTL_SECONDS", "3600")

	c := LoadConfig()

	if c.InviteTTLKey < c.SessionTTL {
		t.Fatalf("InviteTTLKey %s shorter than SessionTTL %s", c.InviteTTLKey, c.SessionTTL)
	}
	if c.InviteTTLLink < c.SessionTTL {
		t.Fatalf("InviteTTLLink %s shorter than SessionTTL %s", c.InviteTTLLink, c.SessionTTL)
	}
	if c.InviteTTLKey != 7200*time.Second {
		t.Fatalf("InviteTTLKey = %s, want 7200s (clamped to session)", c.InviteTTLKey)
	}
}
