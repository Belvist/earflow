package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
)

func TestRevokeSubscriber_InvalidatesSessionOnEvent(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	secret := "test-secret-test-secret-test-secret-32"
	sid := "sid_12345678901234567890"
	jti := "jti-subscriber-01"
	userID := int64(9)

	m := newContractManager(t, mr)
	seedUnifiedSession(t, mr, secret, seededSession{SID: sid, JTI: jti, UserID: userID, Refresh: "r-1"})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	m.StartRevokeSubscriber(ctx)
	time.Sleep(50 * time.Millisecond)

	if code := serveProfile(t, m, sid); code != http.StatusOK {
		t.Fatalf("profile before event = %d, want 200", code)
	}

	ev := RevokeEvent{
		SID:          sid,
		UserID:       userID,
		SessionEpoch: 2,
		Reason:       "revoke_others",
		IssuedAt:     time.Now().UTC().Format(time.RFC3339Nano),
	}
	raw, _ := json.Marshal(ev)
	if err := m.rdb.Publish(ctx, revokePubSubChannel(), raw).Err(); err != nil {
		t.Fatalf("publish: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if code := serveProfile(t, m, sid); code == http.StatusUnauthorized {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("profile still 200 after revoke event")
}

func TestRevokeSubscriber_DuplicateEventIsIdempotent(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	m := newContractManager(t, mr)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	m.StartRevokeSubscriber(ctx)
	time.Sleep(30 * time.Millisecond)

	ev := RevokeEvent{
		SID:          "sid_aaaaaaaaaaaaaaaaaaaa",
		UserID:       1,
		SessionEpoch: 4,
		Reason:       "revoke_one",
		IssuedAt:     time.Now().UTC().Format(time.RFC3339Nano),
	}
	raw, _ := json.Marshal(ev)

	for i := 0; i < 3; i++ {
		if err := m.rdb.Publish(ctx, revokePubSubChannel(), raw).Err(); err != nil {
			t.Fatalf("publish %d: %v", i, err)
		}
	}
	time.Sleep(80 * time.Millisecond)

	if !m.isSessionLocallyRevoked(ev.SID) {
		t.Fatal("expected local revoke mark")
	}
}

func TestSessionAuthMiddleware_RejectsLocallyRevokedSid(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	secret := "test-secret-test-secret-test-secret-32"
	sid := "sid_bbbbbbbbbbbbbbbbbbbb"
	m := newContractManager(t, mr)
	seedUnifiedSession(t, mr, secret, seededSession{SID: sid, JTI: "jti-b", UserID: 3, Refresh: "r-b"})

	m.markSessionLocallyRevoked(sid, 2, "revoke_others")

	req := httptestNewRequestWithCookie(http.MethodGet, "/api/profile", sid)
	w := httptest.NewRecorder()
	chain := m.SessionAuthMiddleware()(http.HandlerFunc(m.handleProfile()))
	chain.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("profile with local tombstone = %d, want 401", w.Code)
	}
}
