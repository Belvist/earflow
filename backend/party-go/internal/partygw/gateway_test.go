package partygw

import (
	"testing"
	"time"

	"github.com/earflow/music-platform/party-go/internal/wire"
)

func TestIsPingCommand(t *testing.T) {
	if !isPingCommand(map[string]any{"type": "ping"}) {
		t.Fatal("expected ping command to be detected")
	}
	if isPingCommand(map[string]any{"type": "snapshot"}) {
		t.Fatal("snapshot must not be treated as heartbeat ping")
	}
	if isPingCommand(nil) {
		t.Fatal("nil command must not be treated as heartbeat ping")
	}
}

func TestShouldEchoCommandReplyKeepsSnapshotsAndErrorsOnly(t *testing.T) {
	okReply, err := wire.Encode(map[string]any{
		"t": "reply",
		"payload": map[string]any{
			"ok":  true,
			"doc": map[string]any{"id": "p1"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	errReply, err := wire.Encode(map[string]any{
		"t":       "reply",
		"payload": map[string]any{"ok": false, "code": "NOT_AUTHORIZED"},
	})
	if err != nil {
		t.Fatal(err)
	}

	if shouldEchoCommandReply(map[string]any{"type": "playback_update"}, okReply) {
		t.Fatal("successful live updates should not echo full snapshots to sender")
	}
	if !shouldEchoCommandReply(map[string]any{"type": "snapshot"}, okReply) {
		t.Fatal("snapshot replies must be echoed")
	}
	if !shouldEchoCommandReply(map[string]any{"type": "playback_update"}, errReply) {
		t.Fatal("command errors must be echoed")
	}
}

func TestLoadUsesStateTouchIntervalOverride(t *testing.T) {
	t.Setenv("JWT_SECRET", "unit-test-secret-not-for-production")
	t.Setenv("PARTY_V2_STATE_TOUCH_INTERVAL_SECONDS", "17")

	cfg := Load()
	if cfg.StateTouchInterval != 17*time.Second {
		t.Fatalf("StateTouchInterval = %s, want 17s", cfg.StateTouchInterval)
	}
}

func TestLoadUsesDefaultStateTouchInterval(t *testing.T) {
	t.Setenv("JWT_SECRET", "unit-test-secret-not-for-production")

	cfg := Load()
	if cfg.StateTouchInterval != time.Minute {
		t.Fatalf("StateTouchInterval = %s, want 1m", cfg.StateTouchInterval)
	}
}
