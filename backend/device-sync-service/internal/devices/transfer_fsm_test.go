package devices

import (
	"context"
	"encoding/json"
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

func TestSendCommandTransferOnPlayBootstrapsLocalNowPlaying(t *testing.T) {
	reg, cleanup := newTestRegistry(t)
	defer cleanup()
	ctx := context.Background()
	const userID = "user-local-play"
	deviceA := registerTestDevice(t, reg, userID, "A")
	deviceB := registerTestDevice(t, reg, userID, "B")

	resume := true
	if _, _, _, err := reg.StartTransfer(ctx, userID, deviceA, &resume, "boot"); err != nil {
		t.Fatalf("seed active device: %v", err)
	}
	if _, err := reg.PutNowPlaying(ctx, userID, &NowPlaying{
		TrackID:         "track-old",
		Title:           "Old Track",
		Artist:          "Old Artist",
		DurationSec:     300,
		IsPlaying:       true,
		PositionSec:     42,
		DeviceID:        deviceA,
		ClientSeq:       1,
		ClientEventAtMs: time.Now().UnixMilli(),
	}); err != nil {
		t.Fatalf("seed now playing: %v", err)
	}

	payload := map[string]interface{}{
		"nowPlaying": map[string]interface{}{
			"trackId":         "track-new",
			"title":           "New Track",
			"artist":          "New Artist",
			"durationSec":     float64(240),
			"isPlaying":       true,
			"positionSec":     float64(7),
			"clientSeq":       float64(2),
			"clientEventAtMs": float64(time.Now().UnixMilli()),
		},
	}
	if err := reg.SendCommand(ctx, userID, deviceB, "", "play", payload, 0); err != nil {
		t.Fatalf("play transfer with local nowPlaying payload: %v", err)
	}

	activeID, err := reg.rdb.Get(ctx, reg.keyActive(userID)).Result()
	if err != nil {
		t.Fatalf("read active key: %v", err)
	}
	if activeID != deviceB {
		t.Fatalf("expected active device to be B after transfer-on-play, got %q", activeID)
	}
	np, err := reg.GetNowPlaying(ctx, userID)
	if err != nil {
		t.Fatalf("read now playing: %v", err)
	}
	if np == nil {
		t.Fatal("expected bootstrapped nowPlaying")
	}
	if np.TrackID != "track-new" || np.DeviceID != deviceB || !np.IsPlaying {
		t.Fatalf("expected local play snapshot to become authoritative, got %+v", np)
	}
	if np.StateRevision <= 1 {
		t.Fatalf("expected state revision to advance from seeded snapshot, got %d", np.StateRevision)
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

func TestTransferFSMSkipsNoOpWhenTargetIsAlreadyActive(t *testing.T) {
	reg, cleanup := newTestRegistry(t)
	defer cleanup()
	ctx := context.Background()
	const userID = "user-noop"
	deviceA := registerTestDevice(t, reg, userID, "A")
	deviceB := registerTestDevice(t, reg, userID, "B")

	resume := true
	if _, _, _, err := reg.StartTransfer(ctx, userID, deviceA, &resume, "seed"); err != nil {
		t.Fatalf("seed active: %v", err)
	}
	beforeRev, err := reg.rdb.Get(ctx, reg.keyActiveRevision(userID)).Result()
	if err != nil {
		t.Fatalf("read active revision before: %v", err)
	}

	prev, activeRevision, transferRecord, err := reg.StartTransfer(ctx, userID, deviceA, &resume, "noop")
	if err != nil {
		t.Fatalf("noop transfer must not fail when device is already active: %v", err)
	}
	if prev != deviceA {
		t.Fatalf("expected previous active to stay A, got %q", prev)
	}
	if transferRecord == nil {
		t.Fatal("expected synthetic reconciled transfer record for noop path")
	}
	if transferRecord.Phase != TransferReconciled {
		t.Fatalf("expected reconciled phase for noop path, got %s", transferRecord.Phase)
	}
	if transferRecord.ToDeviceID != deviceA || transferRecord.FromDeviceID != deviceA {
		t.Fatalf("expected noop transfer scoped to A, got from=%s to=%s", transferRecord.FromDeviceID, transferRecord.ToDeviceID)
	}

	afterRev, err := reg.rdb.Get(ctx, reg.keyActiveRevision(userID)).Result()
	if err != nil {
		t.Fatalf("read active revision after: %v", err)
	}
	if beforeRev != afterRev {
		t.Fatalf("activeRevision must not change on noop TargetIsActive: before=%s after=%s", beforeRev, afterRev)
	}
	if activeRevision != transferRecord.ActiveRevision {
		t.Fatalf("returned revision must match record: returned=%d record=%d", activeRevision, transferRecord.ActiveRevision)
	}

	// still allows a real transfer to another device afterwards
	nextResume := false
	if _, _, transferRec, err := reg.StartTransfer(ctx, userID, deviceB, &nextResume, "real"); err != nil {
		t.Fatalf("real transfer after noop should work: %v", err)
	} else if transferRec == nil || transferRec.Phase == TransferReconciled {
		t.Fatalf("after noop, a real transfer must not be pre-reconciled, got phase=%v", transferRec)
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

// DECISIONS 2026-08-10 TrackSync: cmd:seek must project the new position into
// nowPlaying SoT BEFORE the active device's UI has a chance to publish
// np:update. This is what makes cross-device position reliable when the
// active device is a backgrounded mobile (WKWebView) whose own push may lag
// several seconds.
func TestSendCommandSeekProjectsPositionIntoNowPlayingState(t *testing.T) {
	reg, cleanup := newTestRegistry(t)
	defer cleanup()
	ctx := context.Background()
	const userID = "user-seek-sot"
	deviceA := registerTestDevice(t, reg, userID, "A")
	deviceB := registerTestDevice(t, reg, userID, "B")

	resume := true
	if _, _, _, err := reg.StartTransfer(ctx, userID, deviceA, &resume, "boot"); err != nil {
		t.Fatalf("seed active device: %v", err)
	}
	if _, err := reg.PutNowPlaying(ctx, userID, &NowPlaying{
		TrackID:         "track-1",
		Title:           "Song",
		Artist:          "Artist",
		DurationSec:     200,
		IsPlaying:       true,
		PositionSec:     30,
		DeviceID:        deviceA,
		ClientSeq:       1,
		ClientEventAtMs: time.Now().UnixMilli(),
	}); err != nil {
		t.Fatalf("seed now playing: %v", err)
	}

	before, err := reg.GetNowPlaying(ctx, userID)
	if err != nil || before == nil {
		t.Fatalf("read before: %v", err)
	}

	// Controller B seeks within owner's playback: positionSec=145
	if err := reg.SendCommand(ctx, userID, deviceB, "", "seek", map[string]interface{}{
		"positionSec": 145.0,
	}, 0); err != nil {
		t.Fatalf("seek command: %v", err)
	}

	after, err := reg.GetNowPlaying(ctx, userID)
	if err != nil || after == nil {
		t.Fatalf("read after: %v", err)
	}
	if after.PositionSec != 145 {
		t.Fatalf("expected positionSec=145 after seek, got %d", after.PositionSec)
	}
	if after.StateRevision <= before.StateRevision {
		t.Fatalf("expected state revision bump: before=%d after=%d", before.StateRevision, after.StateRevision)
	}
	if after.DeviceID != deviceA {
		t.Fatalf("device ownership must stay with A, got %q", after.DeviceID)
	}
	if after.TrackID != before.TrackID {
		t.Fatalf("trackId must not change on seek, got %q", after.TrackID)
	}
	if !after.IsPlaying {
		t.Fatal("isPlaying must be preserved on seek")
	}
}

// Seek from a non-active controller must NOT auto-applied if it races with
// no active device (server rejects with not-active). We only verify that
// attempt to "soak" SoT from a stale active does not corrupt state.
func TestSendCommandSeekDoesNotOverwriteWhenSentToStaleDevice(t *testing.T) {
	reg, cleanup := newTestRegistry(t)
	defer cleanup()
	ctx := context.Background()
	const userID = "user-seek-stale"
	deviceA := registerTestDevice(t, reg, userID, "A")
	deviceB := registerTestDevice(t, reg, userID, "B")

	resume := true
	if _, _, _, err := reg.StartTransfer(ctx, userID, deviceA, &resume, "boot"); err != nil {
		t.Fatalf("seed active device: %v", err)
	}
	if _, err := reg.PutNowPlaying(ctx, userID, &NowPlaying{
		TrackID:         "track-1",
		DurationSec:     200,
		IsPlaying:       true,
		PositionSec:     50,
		DeviceID:        deviceA,
		ClientSeq:       1,
		ClientEventAtMs: time.Now().UnixMilli(),
	}); err != nil {
		t.Fatalf("seed now playing: %v", err)
	}

	// controller B attempts to direct seek to device A explicitly (which IS active)
	// — this is fine. The body of recordSeekServerState is what's being exercised.
	if err := reg.SendCommand(ctx, userID, deviceB, deviceA, "seek", map[string]interface{}{
		"positionSec": 90.0,
	}, 0); err != nil {
		t.Fatalf("seek with explicit active target: %v", err)
	}

	np, err := reg.GetNowPlaying(ctx, userID)
	if err != nil || np == nil {
		t.Fatalf("read after: %v", err)
	}
	if np.PositionSec != 90 {
		t.Fatalf("expected positionSec=90, got %d", np.PositionSec)
	}
}

// DECISIONS 2026-08-10 TrackSync/#2: cmd:next/previous/seek/play/pause to
// the active device must piggyback the authoritative NowPlaying snapshot in
// the cmd frame. This closes the race where the receiver, acting on bare
// payload.nowPlaying == nil, would consult context state which could still
// hold the PREVIOUS track for a few WS roundtrips. With the snapshot inline,
// the receive-side apply path is idempotent and cannot apply a stale trackId.
func TestSendCommandNextPiggybacksNowPlayingSnapshot(t *testing.T) {
	reg, cleanup := newTestRegistry(t)
	defer cleanup()
	ctx := context.Background()
	const userID = "user-next-snapshot"
	deviceA := registerTestDevice(t, reg, userID, "A")
	deviceB := registerTestDevice(t, reg, userID, "B")

	resume := true
	if _, _, _, err := reg.StartTransfer(ctx, userID, deviceA, &resume, "boot"); err != nil {
		t.Fatalf("seed active: %v", err)
	}
	if _, err := reg.PutNowPlaying(ctx, userID, &NowPlaying{
		TrackID:         "track-going",
		Title:           "Going",
		Artist:          "Artist",
		DurationSec:     180,
		IsPlaying:       true,
		PositionSec:     45,
		DeviceID:        deviceA,
		ClientSeq:       1,
		ClientEventAtMs: time.Now().UnixMilli(),
	}); err != nil {
		t.Fatalf("seed nowPlaying: %v", err)
	}

	// Subscribe to user channel so we can inspect the cmd frame.
	sub := reg.rdb.Subscribe(ctx, reg.UserChannel(userID))
	defer sub.Close()
	ch := sub.Channel()

	if err := reg.SendCommand(ctx, userID, deviceB, "", "next", nil, 0); err != nil {
		t.Fatalf("next: %v", err)
	}

	// Expect at least one cmd frame with cmd=next whose payload carries nowPlaying.
	timeout := time.After(2 * time.Second)
	sawNextWithNp := false
	for !sawNextWithNp {
		select {
		case <-timeout:
			t.Fatal("no cmd frame with piggybacked nowPlaying within 2s")
		case msg, ok := <-ch:
			if !ok {
				t.Fatal("channel closed")
			}
			var ev Event
			if err := json.Unmarshal([]byte(msg.Payload), &ev); err != nil {
				continue
			}
			if ev.Type != "cmd" || ev.Cmd != "next" {
				continue
			}
			npRaw, has := ev.Payload["nowPlaying"]
			if !has || npRaw == nil {
				t.Fatalf("cmd.next payload must carry nowPlaying snapshot, got keys: %v", keysOf(ev.Payload))
			}
			enc, _ := json.Marshal(npRaw)
			var np NowPlaying
			if err := json.Unmarshal(enc, &np); err != nil {
				t.Fatalf("piggybacked nowPlaying decode: %v", err)
			}
			if np.TrackID != "track-going" {
				t.Fatalf("piggybacked nowPlaying must be the CURRENT track, got %q", np.TrackID)
			}
			if np.PositionSec < 45 {
				t.Fatalf("expected positionSec >= 45 (interpolated), got %d", np.PositionSec)
			}
			sawNextWithNp = true
		}
	}
}

func keysOf(m map[string]interface{}) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// cmd:pause must project IsPlaying=false into nowPlaying SoT.
func TestSendCommandPauseProjectsIsPlayingFalseIntoState(t *testing.T) {
	reg, cleanup := newTestRegistry(t)
	defer cleanup()
	ctx := context.Background()
	const userID = "user-pause-sot"
	deviceA := registerTestDevice(t, reg, userID, "A")
	deviceB := registerTestDevice(t, reg, userID, "B")

	resume := true
	if _, _, _, err := reg.StartTransfer(ctx, userID, deviceA, &resume, "boot"); err != nil {
		t.Fatalf("seed active: %v", err)
	}
	if _, err := reg.PutNowPlaying(ctx, userID, &NowPlaying{
		TrackID:         "track-pause-test",
		DurationSec:     200,
		IsPlaying:       true,
		PositionSec:     30,
		DeviceID:        deviceA,
		ClientSeq:       1,
		ClientEventAtMs: time.Now().UnixMilli(),
	}); err != nil {
		t.Fatalf("seed nowPlaying: %v", err)
	}

	if err := reg.SendCommand(ctx, userID, deviceB, "", "pause", nil, 0); err != nil {
		t.Fatalf("pause: %v", err)
	}

	np, err := reg.GetNowPlaying(ctx, userID)
	if err != nil || np == nil {
		t.Fatalf("read after: %v", err)
	}
	if np.IsPlaying {
		t.Fatalf("expected IsPlaying=false after pause intent, got %v", np.IsPlaying)
	}
	if np.PositionSec != 30 {
		t.Fatalf("positionSec must be preserved on pause, got %d", np.PositionSec)
	}
	if np.DeviceID != deviceA {
		t.Fatalf("deviceId remains A, got %q", np.DeviceID)
	}
}
