package devices

import (
	"context"
	"testing"
)

func makeActiveDevice(t *testing.T, reg *Registry, userID, deviceID string) {
	t.Helper()
	ctx := context.Background()
	resume := true
	_, _, transfer, err := reg.StartTransfer(ctx, userID, deviceID, &resume, "")
	if err != nil {
		t.Fatalf("start transfer: %v", err)
	}
	if _, err := reg.HandleCmdAck(ctx, userID, CmdAck{
		TransferID:     transfer.TransferID,
		CommandID:      transfer.ActivateCommandID,
		DeviceID:       deviceID,
		Cmd:            CommandTransfer,
		Step:           transferStepActivate,
		Ok:             true,
		ActiveRevision: transfer.ActiveRevision,
	}); err != nil {
		t.Fatalf("ack transfer: %v", err)
	}
}

func TestGetPlayerStateUnifiesSnapshot(t *testing.T) {
	reg, cleanup := newTestRegistry(t)
	defer cleanup()
	ctx := context.Background()
	const userID = "user-ps"
	deviceA := registerTestDevice(t, reg, userID, "A")
	makeActiveDevice(t, reg, userID, deviceA)

	if _, err := reg.PutNowPlaying(ctx, userID, &NowPlaying{
		DeviceID:        deviceA,
		TrackID:         "track-1",
		Title:           "Track",
		DurationSec:     200,
		PositionSec:     10,
		IsPlaying:       true,
		ClientSeq:       1,
		ClientEventAtMs: 1,
	}); err != nil {
		t.Fatalf("put now playing: %v", err)
	}

	ps, err := reg.GetPlayerState(ctx, userID)
	if err != nil {
		t.Fatalf("get player state: %v", err)
	}
	if ps.ActiveDeviceID != deviceA {
		t.Fatalf("expected active device %q, got %q", deviceA, ps.ActiveDeviceID)
	}
	if ps.ActiveRevision <= 0 {
		t.Fatalf("expected positive active revision, got %d", ps.ActiveRevision)
	}
	if len(ps.Devices) != 1 || ps.Devices[0] == nil || ps.Devices[0].ID != deviceA || !ps.Devices[0].IsActive {
		t.Fatalf("expected active device in player_state devices, got %+v", ps.Devices)
	}
	if ps.NowPlaying == nil || ps.NowPlaying.TrackID != "track-1" {
		t.Fatalf("expected now playing track-1, got %+v", ps.NowPlaying)
	}
	if ps.NowPlaying.ActiveRevision != ps.ActiveRevision {
		t.Fatalf("expected nowPlaying.activeRevision %d, got %d", ps.ActiveRevision, ps.NowPlaying.ActiveRevision)
	}
	if ps.Timeline == nil || ps.Timeline.TrackID != "track-1" {
		t.Fatalf("expected timeline track-1, got %+v", ps.Timeline)
	}
	if ps.Lease == nil || ps.Lease.HolderDeviceID != deviceA {
		t.Fatalf("expected lease holder %q, got %+v", deviceA, ps.Lease)
	}
	if ps.FrameRev <= 0 {
		t.Fatalf("expected frame revision bumped by publishes, got %d", ps.FrameRev)
	}
}

func TestPlayerStateFrameRevisionMonotonic(t *testing.T) {
	reg, cleanup := newTestRegistry(t)
	defer cleanup()
	ctx := context.Background()
	const userID = "user-rev"
	deviceA := registerTestDevice(t, reg, userID, "A")
	makeActiveDevice(t, reg, userID, deviceA)

	first, err := reg.GetPlayerState(ctx, userID)
	if err != nil {
		t.Fatalf("get player state: %v", err)
	}
	if _, err := reg.PutNowPlaying(ctx, userID, &NowPlaying{
		DeviceID:        deviceA,
		TrackID:         "track-2",
		ClientSeq:       1,
		ClientEventAtMs: 1,
	}); err != nil {
		t.Fatalf("put now playing: %v", err)
	}
	second, err := reg.GetPlayerState(ctx, userID)
	if err != nil {
		t.Fatalf("get player state after update: %v", err)
	}
	if second.FrameRev <= first.FrameRev {
		t.Fatalf("expected frame revision to grow: %d -> %d", first.FrameRev, second.FrameRev)
	}
}

func TestSetVolumeCommandPersistsPerDeviceVolume(t *testing.T) {
	reg, cleanup := newTestRegistry(t)
	defer cleanup()
	ctx := context.Background()
	const userID = "user-vol"
	deviceA := registerTestDevice(t, reg, userID, "A")
	makeActiveDevice(t, reg, userID, deviceA)

	if err := reg.SendCommand(ctx, userID, deviceA, "", "set_volume", map[string]interface{}{"volume": float64(0.42)}, 0); err != nil {
		t.Fatalf("send set_volume: %v", err)
	}

	ps, err := reg.GetPlayerState(ctx, userID)
	if err != nil {
		t.Fatalf("get player state: %v", err)
	}
	if got := ps.VolumeByDevice[deviceA]; got != 0.42 {
		t.Fatalf("expected persisted volume 0.42 for %q, got %v (map %v)", deviceA, got, ps.VolumeByDevice)
	}
}
