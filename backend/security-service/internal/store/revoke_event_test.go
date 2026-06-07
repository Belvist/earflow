package store

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/earflow/music-platform/security-service/internal/store/authpg"
	"github.com/redis/go-redis/v9"
)

func TestPublishRevokeEvent_RoundTrip(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	c := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	rd := &RedisClient{c: c}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	sub := c.Subscribe(ctx, RevokePubSubChannel())
	defer func() { _ = sub.Close() }()
	ch := sub.Channel()

	ev := RevokeEvent{
		SID:          "sid_12345678901234567890",
		UserID:       42,
		SessionEpoch: 3,
		Reason:       RevokeReasonOthers,
		IssuedAt:     time.Now().UTC().Format(time.RFC3339Nano),
	}
	if err := rd.PublishRevokeEvent(ctx, ev); err != nil {
		t.Fatalf("publish: %v", err)
	}

	select {
	case msg := <-ch:
		var got RevokeEvent
		if err := json.Unmarshal([]byte(msg.Payload), &got); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if got.SID != ev.SID || got.UserID != ev.UserID || got.SessionEpoch != ev.SessionEpoch || got.Reason != ev.Reason {
			t.Fatalf("event mismatch: %+v", got)
		}
	case <-ctx.Done():
		t.Fatal("timeout waiting for pub/sub message")
	}
}

func TestAuthSoT_RevokeSessionFull_PublishesEvent(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	c := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	rd := &RedisClient{c: c}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	sub := c.Subscribe(ctx, RevokePubSubChannel())
	defer func() { _ = sub.Close() }()
	ch := sub.Channel()

	sid := "sid_12345678901234567890"
	jti := "jti-pub-01"
	mr.Set(SIDKey(sid), jti)

	sot := &AuthSoT{PG: nil, Mode: authpg.ModeOff}
	if err := sot.RevokeSessionFull(ctx, rd, sid, 7, jti, RevokeReasonOne); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	select {
	case msg := <-ch:
		var got RevokeEvent
		if err := json.Unmarshal([]byte(msg.Payload), &got); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if got.SID != sid || got.UserID != 7 || got.Reason != RevokeReasonOne {
			t.Fatalf("unexpected event: %+v", got)
		}
	case <-ctx.Done():
		t.Fatal("timeout waiting for revoke publish")
	}
}
