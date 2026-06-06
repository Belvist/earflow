package config

import "testing"

func setBaseEnv(t *testing.T) {
	t.Helper()
	t.Setenv("JWT_SECRET", "01234567890123456789012345678901")
	t.Setenv("REDIS_PASSWORD", "redis-password-for-tests")
}

func TestLoadRequiresDedicatedWSTicketSecretInProduction(t *testing.T) {
	setBaseEnv(t)
	t.Setenv("NODE_ENV", "production")
	t.Setenv("ALLOWED_ORIGINS", "https://earflow.example")
	t.Setenv("DEVICE_SYNC_WS_TICKET_SECRET", "")

	if _, err := Load(); err == nil {
		t.Fatal("expected production config to require DEVICE_SYNC_WS_TICKET_SECRET")
	}
}

func TestLoadRequiresAllowedOriginsInProduction(t *testing.T) {
	setBaseEnv(t)
	t.Setenv("NODE_ENV", "production")
	t.Setenv("DEVICE_SYNC_WS_TICKET_SECRET", "device-sync-ticket-secret-32-chars")
	t.Setenv("ALLOWED_ORIGINS", "")

	if _, err := Load(); err == nil {
		t.Fatal("expected production config to require ALLOWED_ORIGINS")
	}
}

func TestLoadAcceptsDeviceSyncProductionSecurityConfig(t *testing.T) {
	setBaseEnv(t)
	t.Setenv("NODE_ENV", "production")
	t.Setenv("DEVICE_SYNC_WS_TICKET_SECRET", "device-sync-ticket-secret-32-chars")
	t.Setenv("ALLOWED_ORIGINS", "https://earflow.example")
	t.Setenv("JWT_ISSUER", "earflow-auth")
	t.Setenv("JWT_AUDIENCE", "earflow-api")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("expected secure production config to load: %v", err)
	}
	if cfg.JWTIssuer != "earflow-auth" || cfg.JWTAudience != "earflow-api" {
		t.Fatalf("expected jwt issuer/audience to load, got %q/%q", cfg.JWTIssuer, cfg.JWTAudience)
	}
}
