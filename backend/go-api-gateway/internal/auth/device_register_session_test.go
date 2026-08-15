package auth

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestRevokeStaleSessionForAuthDevice_ReplacesOldSID(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	userID := int64(42)
	oldSID := "sid_old123456789012345678"
	newSID := "sid_new123456789012345678"
	authDeviceID := "adev_1234567890123456789"

	mr.Set(authSIDKey(oldSID), "jti-old")
	mr.Set("mp:sess:"+oldSID, `{"user":{"id":42}}`)
	mr.SAdd(authUserSidsKey(userID), oldSID, newSID)

	devices := NewAuthDeviceStore(rdb, time.Hour)
	rec := AuthDeviceRecord{
		AuthDeviceID:  authDeviceID,
		SID:           oldSID,
		UserID:        userID,
		PublicKeySPKI: "c3Bp",
	}
	if err := devices.Save(context.Background(), rec); err != nil {
		t.Fatalf("save device: %v", err)
	}

	m := &SessionManager{
		devices:              devices,
		rdb:                  rdb,
		gatewaySessionPrefix: "mp:sess:",
	}

	m.revokeStaleSessionForAuthDevice(context.Background(), authDeviceID, newSID, userID)

	if mr.Exists(authSIDKey(oldSID)) {
		t.Fatal("expected old auth sid deleted")
	}
	if mr.Exists("mp:sess:" + oldSID) {
		t.Fatal("expected old gateway session deleted")
	}
	ok, _ := mr.SIsMember(authUserSidsKey(userID), oldSID)
	if ok {
		t.Fatal("expected old sid removed from user index")
	}
	okNew, _ := mr.SIsMember(authUserSidsKey(userID), newSID)
	if !okNew {
		t.Fatal("expected new sid to remain in user index")
	}
}

func TestRevokeStaleSessionForAuthDevice_SkipsSameSID(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	sid := "sid_same123456789012345678"
	authDeviceID := "adev_1234567890123456789"
	userID := int64(7)

	mr.Set(authSIDKey(sid), "jti-same")
	devices := NewAuthDeviceStore(rdb, time.Hour)
	_ = devices.Save(context.Background(), AuthDeviceRecord{
		AuthDeviceID:  authDeviceID,
		SID:           sid,
		UserID:        userID,
		PublicKeySPKI: "c3Bp",
	})

	m := &SessionManager{devices: devices, rdb: rdb, gatewaySessionPrefix: "mp:sess:"}
	m.revokeStaleSessionForAuthDevice(context.Background(), authDeviceID, sid, userID)

	if !mr.Exists(authSIDKey(sid)) {
		t.Fatal("expected current sid to remain")
	}
}
