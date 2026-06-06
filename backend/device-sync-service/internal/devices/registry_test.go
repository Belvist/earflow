package devices

import "testing"

func TestIsStaleNowPlayingUpdateRejectsOlderClientEvents(t *testing.T) {
	prev := &NowPlaying{
		DeviceID:        "device-1",
		ClientSeq:       10,
		ClientEventAtMs: 2000,
	}

	if !isStaleNowPlayingUpdate(prev, "device-1", 1999, 11) {
		t.Fatal("expected older client event timestamp to be stale")
	}
	if isStaleNowPlayingUpdate(prev, "device-1", 2001, 1) {
		t.Fatal("expected newer client event timestamp to be accepted")
	}
}

func TestIsStaleNowPlayingUpdateRejectsRepeatedSequenceForSameEvent(t *testing.T) {
	prev := &NowPlaying{
		DeviceID:        "device-1",
		ClientSeq:       10,
		ClientEventAtMs: 2000,
	}

	if !isStaleNowPlayingUpdate(prev, "device-1", 2000, 10) {
		t.Fatal("expected repeated sequence to be stale")
	}
	if !isStaleNowPlayingUpdate(prev, "device-1", 2000, 9) {
		t.Fatal("expected lower sequence to be stale")
	}
	if isStaleNowPlayingUpdate(prev, "device-1", 2000, 11) {
		t.Fatal("expected higher sequence to be accepted")
	}
}

func TestIsStaleNowPlayingUpdateIgnoresOtherDeviceHistory(t *testing.T) {
	prev := &NowPlaying{
		DeviceID:        "device-1",
		ClientSeq:       10,
		ClientEventAtMs: 2000,
	}

	if isStaleNowPlayingUpdate(prev, "device-2", 1000, 1) {
		t.Fatal("expected other device history not to reject update")
	}
}

func TestNormalizeClientEventAtMsRejectsInvalidClockValues(t *testing.T) {
	const nowMs = int64(10_000)

	if got, ok := normalizeClientEventAtMs(0, nowMs); got != nowMs || ok {
		t.Fatalf("expected missing event timestamp to normalize to now and invalid, got %d %t", got, ok)
	}
	if got, ok := normalizeClientEventAtMs(nowMs+maxClientNowPlayingFutureSkewMs+1, nowMs); got != nowMs || ok {
		t.Fatalf("expected future-skewed event timestamp to normalize to now and invalid, got %d %t", got, ok)
	}
	if got, ok := normalizeClientEventAtMs(nowMs-maxClientNowPlayingEventAgeMs-1, nowMs); got != nowMs || ok {
		t.Fatalf("expected too-old event timestamp to normalize to now and invalid, got %d %t", got, ok)
	}
	if got, ok := normalizeClientEventAtMs(nowMs-1000, nowMs); got != nowMs-1000 || !ok {
		t.Fatalf("expected valid event timestamp to pass through, got %d %t", got, ok)
	}
}

func TestTransferRevokePayloadCarriesServerOwnership(t *testing.T) {
	np := &NowPlaying{
		DeviceID:      "device-new",
		TrackID:       "track-1",
		StateRevision: 12,
	}

	payload := transferRevokePayload("device-new", 7, np)

	if payload["reason"] != "transfer" {
		t.Fatalf("expected transfer reason, got %v", payload["reason"])
	}
	if payload["activeDeviceId"] != "device-new" {
		t.Fatalf("expected active device id in payload, got %v", payload["activeDeviceId"])
	}
	if payload["activeRevision"] != int64(7) {
		t.Fatalf("expected active revision in payload, got %v", payload["activeRevision"])
	}
	if payload["nowPlaying"] != np {
		t.Fatal("expected authoritative now-playing snapshot in payload")
	}
}

func TestNormalizeCommandPayloadValidatesSeekAndVolume(t *testing.T) {
	seek, err := normalizeCommandPayload("seek", map[string]interface{}{"positionSec": float64(42)})
	if err != nil {
		t.Fatalf("expected seek payload to validate: %v", err)
	}
	if seek["positionSec"] != float64(42) {
		t.Fatalf("expected normalized seek position, got %v", seek["positionSec"])
	}

	volume, err := normalizeCommandPayload("set_volume", map[string]interface{}{"volume": float64(0.75)})
	if err != nil {
		t.Fatalf("expected volume payload to validate: %v", err)
	}
	if volume["volume"] != float64(0.75) {
		t.Fatalf("expected normalized volume, got %v", volume["volume"])
	}
}

func TestNormalizeCommandPayloadRejectsUnsafeValues(t *testing.T) {
	if _, err := normalizeCommandPayload("seek", map[string]interface{}{"positionSec": float64(-1)}); err != ErrInvalidCommandPayload {
		t.Fatalf("expected negative seek to be rejected, got %v", err)
	}
	if _, err := normalizeCommandPayload("set_volume", map[string]interface{}{"volume": float64(2)}); err != ErrInvalidCommandPayload {
		t.Fatalf("expected out-of-range volume to be rejected, got %v", err)
	}
	if _, err := normalizeCommandPayload("transfer", nil); err != ErrUnknownCommand {
		t.Fatalf("expected server-only command to be rejected, got %v", err)
	}
}
