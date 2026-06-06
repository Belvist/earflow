package store

import (
	"context"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestSecurityRevokeSessionFullMatchesGatewayContract(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	c := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	r := &RedisClient{c: c}

	sid := "sid_12345678901234567890"
	jti := "jti-sec-01"
	userID := int64(42)
	devID := "adev_12345678901234567890"

	mr.Set(SIDKey(sid), jti)
	mr.Set(RefreshKey(jti), `{}`)
	mr.Set(SessionMetaKey(sid), `{"userId":42}`)
	mr.Set(gatewaySessionKey(sid), `{"accessToken":"a","refreshToken":"r"}`)
	mr.SAdd(UserSidsKey(userID), sid)
	mr.Set(authDeviceKey(devID), `{"authDeviceId":"`+devID+`"}`)
	mr.SAdd(authSidDevicesKey(sid), devID)
	mr.SAdd(authUserAuthDevicesKey(userID), devID)

	if err := r.RevokeSessionFull(context.Background(), sid, userID, jti); err != nil {
		t.Fatal(err)
	}

	for _, key := range []string{
		SIDKey(sid),
		RefreshKey(jti),
		SessionMetaKey(sid),
		gatewaySessionKey(sid),
		authSidDevicesKey(sid),
		authDeviceKey(devID),
	} {
		if mr.Exists(key) {
			t.Fatalf("expected deleted: %s", key)
		}
	}
	if ok, _ := mr.SIsMember(UserSidsKey(userID), sid); ok {
		t.Fatal("sid still indexed for user")
	}
}
