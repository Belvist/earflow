package streamticket

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/earflow/music-platform/device-sync-service/internal/auth"
	"github.com/earflow/music-platform/device-sync-service/internal/config"
	"github.com/redis/go-redis/v9"
)

func TestVerifyOpaqueWSConnectTicket(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	cache := NewEpochCache()
	cfg := &config.Config{}
	cfg.StreamTicket.Accept = true

	v := NewVerifier(cfg, rdb, cache)
	if v == nil {
		t.Fatal("expected verifier")
	}

	rec := opaqueRecord{
		TicketType:   ticketTypeWSConnect,
		SID:          "sid-1",
		AuthDeviceID: "dev-pop-1",
		UserID:       "42",
		SessionEpoch: 1,
		DeviceEpoch:  1,
		Scope:        ticketScope{DeviceID: "dsync-device-1"},
		OneTime:      true,
	}
	raw, _ := json.Marshal(rec)
	mr.Set(opaqueKeyPrefix+"opaque12345678901234567890", string(raw))

	claims, err := v.verifyOpaqueWS(context.Background(), "opaque12345678901234567890")
	if err != nil {
		t.Fatalf("verify opaque: %v", err)
	}
	if claims.UserID != "42" || claims.DeviceID != "dsync-device-1" {
		t.Fatalf("claims mismatch: %+v", claims)
	}
	if mr.Exists(opaqueKeyPrefix + "opaque12345678901234567890") {
		t.Fatal("expected one-time ticket deleted")
	}
}

func TestVerifyUpgradeTicketLegacyJWT(t *testing.T) {
	secret := []byte("01234567890123456789012345678901")
	cfg := &config.Config{}
	cfg.WSTicketSecret = secret
	cfg.WSTicketTTL = time.Minute

	ticket, err := auth.CreateTicket(cfg, "7", "device-legacy", "user")
	if err != nil {
		t.Fatal(err)
	}

	claims, err := auth.VerifyTicket(cfg, ticket.Token)
	if err != nil {
		t.Fatal(err)
	}
	if claims.DeviceID != "device-legacy" {
		t.Fatalf("device id = %q", claims.DeviceID)
	}
}
