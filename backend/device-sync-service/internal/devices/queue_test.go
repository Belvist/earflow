package devices

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/earflow/music-platform/device-sync-service/internal/config"
	"github.com/redis/go-redis/v9"
)

func makeQueueTestRegistry(t *testing.T) (*Registry, func()) {
	t.Helper()
	mr := miniredis.RunT(t)
	cfg := &config.Config{}
	cfg.Redis.Addr = mr.Addr()
	cfg.Redis.KeyPrefix = "test:"
	cfg.Device.MaxPerUser = 30
	cfg.Device.DeviceTTL = time.Minute
	cfg.Device.NowPlayingTTL = time.Hour
	cfg.Device.MaxCommandPayloadBytes = 4096
	cfg.Device.AllowedKinds = map[string]struct{}{"web": {}, "ios": {}, "android": {}}
	cfg.Transfer.AckTimeout = 100 * time.Millisecond
	cfg.Transfer.MaxRetries = 1
	cfg.Transfer.IdempotencyTTL = time.Hour
	cfg.Transfer.RecordTTL = time.Hour
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug}))
	r := NewRegistry(rdb, cfg, logger, nil)
	return r, func() { _ = rdb.Close(); mr.Close() }
}

func TestQueueSetIntent_StaleRevisionRejected(t *testing.T) {
	reg, cleanup := makeQueueTestRegistry(t)
	defer cleanup()
	ctx := context.Background()
	const uid = "u1"

	// Setup: register the device directly BEFORE SendCommand so that
	// normalizeUserID + loadDevice in SendCommand succeed and `activeID` can
	// be populated by StartTransfer (queue:set only applies against the
	// CURRENT active device — others are rejected).
	dev, err := reg.RegisterDevice(ctx, RegisterParams{
		UserID: uid, Name: "A", Kind: "web", Capabilities: &DeviceCapabilities{Platform: "web"},
	})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	did := dev.ID

	// Make it active via transfer (needs to be active for queue:set apply under cmd).
	resume := true
	if _, _, _, err := reg.StartTransfer(ctx, uid, did, &resume, "boot"); err != nil {
		t.Fatalf("bootstrap active: %v", err)
	}

	// First write creates queue with revision=1.
	if err := reg.SendCommand(ctx, uid, did, "", "queue:set", map[string]interface{}{
		"trackIds": []interface{}{"track-1", "track-2"},
		"index":    0.0,
	}, 0); err != nil {
		t.Fatalf("first queue:set: %v (user=%s device=%s)", err, uid, did)
	}

	// Read revision via rdb (we want it to be 1).
	raw, err := reg.rdb.Get(ctx, reg.keyQueue(uid)).Result()
	if err != nil {
		t.Fatalf("read queue: %v", err)
	}
	var pq PlaybackQueue
	if err := json.Unmarshal([]byte(raw), &pq); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if pq.Revision != 1 {
		t.Fatalf("expected revision=1, got %d", pq.Revision)
	}

	// Second write with matching revision succeeds (expectRev 1 == current rev 1).
	err = reg.SendCommand(ctx, uid, did, "", "queue:set", map[string]interface{}{
		"trackIds":      []interface{}{"track-3"},
		"index":         0.0,
		"queueRevision": float64(1),
	}, 0)
	if err != nil {
		t.Fatalf("matching revision write: %v", err)
	}

	// Now at revision 2. Third write with STALE revision 1 must fail (since
	// current rev is 2 after the previous write, and 1 != 2).
	err = reg.SendCommand(ctx, uid, did, "", "queue:set", map[string]interface{}{
		"trackIds":      []interface{}{"track-4"},
		"index":         0.0,
		"queueRevision": float64(1),
	}, 0)
	if err == nil {
		t.Fatal("expected ErrQueueStaleRev for truly stale revision")
	}
	if !errors.Is(err, ErrQueueStaleRev) {
		t.Fatalf("expected ErrQueueStaleRev, got %v", err)
	}
	if err == nil {
		t.Fatal("expected error from stale revision")
	}
	if !errors.Is(err, ErrQueueStaleRev) {
		t.Fatalf("expected ErrQueueStaleRev, got %v", err)
	}
}
