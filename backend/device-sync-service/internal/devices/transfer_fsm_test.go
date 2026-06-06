package devices

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/earflow/music-platform/device-sync-service/internal/config"
	"github.com/redis/go-redis/v9"
)

func newTestRegistry(t *testing.T) (*Registry, func()) {
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
	reg := NewRegistry(rdb, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	return reg, func() {
		_ = rdb.Close()
		mr.Close()
	}
}

func registerTestDevice(t *testing.T, reg *Registry, userID, name string) string {
	t.Helper()
	dev, err := reg.RegisterDevice(context.Background(), RegisterParams{
		UserID: userID,
		Name:   name,
		Kind:   "web",
		Capabilities: &DeviceCapabilities{
			Platform: "web",
		},
	})
	if err != nil {
		t.Fatalf("register device: %v", err)
	}
	return dev.ID
}

func TestTransferFSMReconcilesAfterRevokeAndActivateAck(t *testing.T) {
	reg, cleanup := newTestRegistry(t)
	defer cleanup()
	ctx := context.Background()
	const userID = "user-1"
	deviceA := registerTestDevice(t, reg, userID, "A")
	deviceB := registerTestDevice(t, reg, userID, "B")

	resume := true
	_, _, firstTransfer, err := reg.StartTransfer(ctx, userID, deviceA, &resume, "first")
	if err != nil {
		t.Fatalf("start first transfer: %v", err)
	}
	if _, err := reg.HandleCmdAck(ctx, userID, CmdAck{
		TransferID:     firstTransfer.TransferID,
		CommandID:      firstTransfer.ActivateCommandID,
		DeviceID:       deviceA,
		Cmd:            CommandTransfer,
		Step:           transferStepActivate,
		Ok:             true,
		ActiveRevision: firstTransfer.ActiveRevision,
	}); err != nil {
		t.Fatalf("ack first transfer: %v", err)
	}

	prev, _, transfer, err := reg.StartTransfer(ctx, userID, deviceB, &resume, "second")
	if err != nil {
		t.Fatalf("start second transfer: %v", err)
	}
	if prev != deviceA {
		t.Fatalf("expected previous active device A, got %q", prev)
	}
	if transfer.Phase != TransferRevokeSent {
		t.Fatalf("expected revoke_sent phase, got %s", transfer.Phase)
	}

	if _, err := reg.HandleCmdAck(ctx, userID, CmdAck{
		TransferID:     transfer.TransferID,
		CommandID:      transfer.RevokeCommandID,
		DeviceID:       deviceA,
		Cmd:            CommandRevokeAudio,
		Step:           transferStepRevoke,
		Ok:             true,
		ActiveRevision: transfer.ActiveRevision,
	}); err != nil {
		t.Fatalf("ack revoke: %v", err)
	}
	finalTransfer, err := reg.HandleCmdAck(ctx, userID, CmdAck{
		TransferID:     transfer.TransferID,
		CommandID:      transfer.ActivateCommandID,
		DeviceID:       deviceB,
		Cmd:            CommandTransfer,
		Step:           transferStepActivate,
		Ok:             true,
		ActiveRevision: transfer.ActiveRevision,
	})
	if err != nil {
		t.Fatalf("ack activate: %v", err)
	}
	if finalTransfer.Phase != TransferReconciled {
		t.Fatalf("expected reconciled transfer, got %s", finalTransfer.Phase)
	}

	lease, err := reg.GetOutputLease(ctx, userID)
	if err != nil {
		t.Fatalf("get lease: %v", err)
	}
	if lease.HolderDeviceID != deviceB {
		t.Fatalf("expected holder B, got %q", lease.HolderDeviceID)
	}
	if lease.DeviceStates[deviceA] != OutputStateRevoked {
		t.Fatalf("expected A revoked, got %s", lease.DeviceStates[deviceA])
	}
	if lease.DeviceStates[deviceB] != OutputStateActive {
		t.Fatalf("expected B active, got %s", lease.DeviceStates[deviceB])
	}
}

func TestTransferFSMIdempotencyReturnsExistingTransfer(t *testing.T) {
	reg, cleanup := newTestRegistry(t)
	defer cleanup()
	ctx := context.Background()
	const userID = "user-2"
	deviceA := registerTestDevice(t, reg, userID, "A")
	resume := true

	_, _, first, err := reg.StartTransfer(ctx, userID, deviceA, &resume, "same-key")
	if err != nil {
		t.Fatalf("start transfer: %v", err)
	}
	_, _, second, err := reg.StartTransfer(ctx, userID, deviceA, &resume, "same-key")
	if err != nil {
		t.Fatalf("repeat transfer: %v", err)
	}
	if first.TransferID != second.TransferID {
		t.Fatalf("expected idempotent transfer id %s, got %s", first.TransferID, second.TransferID)
	}
}

func TestSendCommandTransferOnPlayFromNonActiveDevice(t *testing.T) {
	reg, cleanup := newTestRegistry(t)
	defer cleanup()
	ctx := context.Background()
	const userID = "user-top"
	deviceA := registerTestDevice(t, reg, userID, "A")
	deviceB := registerTestDevice(t, reg, userID, "B")

	resume := true
	if _, _, _, err := reg.StartTransfer(ctx, userID, deviceA, &resume, "boot"); err != nil {
		t.Fatalf("seed active device: %v", err)
	}

	if err := reg.SendCommand(ctx, userID, deviceB, "", "play", nil, 0); err != nil {
		t.Fatalf("expected play from non-active device to trigger transfer-on-play, got error: %v", err)
	}

	activeID, err := reg.rdb.Get(ctx, reg.keyActive(userID)).Result()
	if err != nil {
		t.Fatalf("read active key: %v", err)
	}
	if activeID != deviceB {
		t.Fatalf("expected active device to be B after transfer-on-play, got %q", activeID)
	}
}

func TestSendCommandTransferOnPlayWhenNoActiveExists(t *testing.T) {
	reg, cleanup := newTestRegistry(t)
	defer cleanup()
	ctx := context.Background()
	const userID = "user-fresh"
	deviceA := registerTestDevice(t, reg, userID, "A")

	if err := reg.SendCommand(ctx, userID, deviceA, "", "play", nil, 0); err != nil {
		t.Fatalf("expected first play to bootstrap active device, got error: %v", err)
	}

	activeID, err := reg.rdb.Get(ctx, reg.keyActive(userID)).Result()
	if err != nil {
		t.Fatalf("read active key: %v", err)
	}
	if activeID != deviceA {
		t.Fatalf("expected active device to be A after bootstrap play, got %q", activeID)
	}
}

func TestSendCommandPauseFromNonActiveDeviceIsRelayedToActiveWithoutTransfer(t *testing.T) {
	reg, cleanup := newTestRegistry(t)
	defer cleanup()
	ctx := context.Background()
	const userID = "user-pause"
	deviceA := registerTestDevice(t, reg, userID, "A")
	deviceB := registerTestDevice(t, reg, userID, "B")

	resume := true
	if _, _, _, err := reg.StartTransfer(ctx, userID, deviceA, &resume, "boot"); err != nil {
		t.Fatalf("seed active device: %v", err)
	}

	if err := reg.SendCommand(ctx, userID, deviceB, "", "pause", nil, 0); err != nil {
		t.Fatalf("expected pause from non-active controller device to be relayed to active, got %v", err)
	}

	activeID, _ := reg.rdb.Get(ctx, reg.keyActive(userID)).Result()
	if activeID != deviceA {
		t.Fatalf("active device must not change on controller-relayed pause, got %q", activeID)
	}
}

func TestTransferFSMRejectsStaleAckRevision(t *testing.T) {
	reg, cleanup := newTestRegistry(t)
	defer cleanup()
	ctx := context.Background()
	const userID = "user-3"
	deviceA := registerTestDevice(t, reg, userID, "A")
	resume := true

	_, _, transfer, err := reg.StartTransfer(ctx, userID, deviceA, &resume, "ack")
	if err != nil {
		t.Fatalf("start transfer: %v", err)
	}
	if _, err := reg.HandleCmdAck(ctx, userID, CmdAck{
		TransferID:     transfer.TransferID,
		CommandID:      transfer.ActivateCommandID,
		DeviceID:       deviceA,
		Cmd:            CommandTransfer,
		Step:           transferStepActivate,
		Ok:             true,
		ActiveRevision: transfer.ActiveRevision + 1,
	}); err != ErrStaleRevision {
		t.Fatalf("expected stale revision error, got %v", err)
	}
}
