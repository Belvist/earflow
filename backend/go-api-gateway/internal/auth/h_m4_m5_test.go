package auth

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
)

// TestM4SweepBumpsProofEpochAfterRestart: after a restart the local epoch
// floor is empty; the revocation sweep must populate it so a token issued at
// the old epoch is rejected immediately after catch-up (not just marked).
func TestM4SweepBumpsProofEpochAfterRestart(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	m := newContractManager(t, mr)
	m.proofEpochs = newProofEpochCache()

	sid := "sid_cccccccccccccccccccc"
	mr.SAdd("auth:sids:revoked", sid)
	mr.Set("auth:session:"+sid+":epoch", "3")

	// StartRevokeSubscriber seeds revokeMarks and, with the M-4 fix, performs
	// an IMMEDIATE reconcile on startup (before that, a restarted pod had an
	// empty epoch floor for up to one sweep interval ≈ 30s).
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	m.StartRevokeSubscriber(ctx)

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if m.isSessionLocallyRevoked(sid) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !m.isSessionLocallyRevoked(sid) {
		t.Fatal("sweep did not mark sid revoked")
	}
	if !m.proofEpochs.sessionEpochStale(sid, 2) {
		t.Fatal("sweep did not bump proof epoch floor — token at old epoch would pass")
	}
	if m.proofEpochs.sessionEpochStale(sid, 3) {
		t.Fatal("epoch 3 == floor 3 must not count as stale")
	}
}

// TestProofEpochCacheGCDropsStaleFloors: floors untouched past maxAge are
// dropped (dead weight: they only protect tokens issued before the bump, and
// those expire with the token TTL).
func TestProofEpochCacheGCDropsStaleFloors(t *testing.T) {
	c := newProofEpochCache()
	now := time.Now().UTC()

	c.bumpSessionEpoch("sid_new", 3)
	c.bumpDeviceEpoch("adev_new", 5)
	// Backdate to simulate staleness.
	c.sessions.Store("sid_old", proofEpochEntry{epoch: 3, at: now.Add(-48 * time.Hour)})
	c.devices.Store("adev_old", proofEpochEntry{epoch: 5, at: now.Add(-48 * time.Hour)})

	c.gc(now, 24*time.Hour)

	if _, ok := c.sessions.Load("sid_old"); ok {
		t.Fatal("stale session floor not evicted")
	}
	if _, ok := c.devices.Load("adev_old"); ok {
		t.Fatal("stale device floor not evicted")
	}
	if !c.sessionEpochStale("sid_new", 2) {
		t.Fatal("fresh session floor evicted")
	}
	if !c.deviceEpochStale("adev_new", 4) {
		t.Fatal("fresh device floor evicted")
	}
}
