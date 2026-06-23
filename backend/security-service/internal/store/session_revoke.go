package store

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/redis/go-redis/v9"
)

const defaultGatewaySessPrefix = "mp:sess:"

func gatewaySessionKeyPrefix() string {
	p := strings.TrimSpace(os.Getenv("SESSION_KEY_PREFIX"))
	if p == "" {
		return defaultGatewaySessPrefix
	}
	return p
}

func gatewaySessionKey(sid string) string {
	return gatewaySessionKeyPrefix() + sid
}

func authGraceKey(jti string) string { return "auth:grace:" + jti }

func authDeviceKey(authDeviceID string) string { return "auth:device:" + authDeviceID }
func authSidDevicesKey(sid string) string     { return "auth:sid_devices:" + sid }
func authUserAuthDevicesKey(userID int64) string {
	return fmt.Sprintf("auth:user_auth_devices:%d", userID)
}

// RevokeSessionFull removes gateway mp:sess, auth refresh/sid, metadata, step-up, grace,
// and auth-device bindings for sid. Best-effort: returns first error but continues cleanup.
func (r *RedisClient) RevokeSessionFull(ctx context.Context, sid string, userID int64, jti string) error {
	sid = strings.TrimSpace(sid)
	if sid == "" {
		return nil
	}

	var firstErr error
	recordErr := func(err error) {
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}

	if strings.TrimSpace(jti) == "" {
		got, err := r.c.Get(ctx, SIDKey(sid)).Result()
		if err != nil && err != redis.Nil {
			recordErr(err)
		} else if err == nil {
			jti = strings.TrimSpace(got)
		}
	}

	if userID <= 0 {
		raw, err := r.c.Get(ctx, SessionMetaKey(sid)).Result()
		if err != nil && err != redis.Nil {
			recordErr(err)
		} else if err == nil && raw != "" {
			var meta sessionMetaJSON
			if jsonErr := json.Unmarshal([]byte(raw), &meta); jsonErr == nil {
				userID = meta.UserID
			}
		}
	}

	if jti != "" {
		recordErr(r.c.Del(ctx, RefreshKey(jti)).Err())
		recordErr(r.c.Del(ctx, authGraceKey(jti)).Err())
	}
	recordErr(r.c.Del(ctx, SIDKey(sid)).Err())
	recordErr(r.c.Del(ctx, SessionMetaKey(sid)).Err())
	recordErr(r.c.Del(ctx, StepUpKey(sid)).Err())
	recordErr(r.c.Del(ctx, gatewaySessionKey(sid)).Err())
	recordErr(r.revokeAuthDevicesForSID(ctx, sid, userID))

	if userID > 0 {
		recordErr(r.c.SRem(ctx, UserSidsKey(userID), sid).Err())
	}

	return firstErr
}

func (r *RedisClient) revokeAuthDevicesForSID(ctx context.Context, sid string, userID int64) error {
	var firstErr error
	recordErr := func(err error) {
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}

	deviceIDs, err := r.c.SMembers(ctx, authSidDevicesKey(sid)).Result()
	if err != nil && err != redis.Nil {
		return err
	}
	for _, id := range deviceIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		recordErr(r.c.Del(ctx, authDeviceKey(id)).Err())
		if userID > 0 {
			recordErr(r.c.SRem(ctx, authUserAuthDevicesKey(userID), id).Err())
		}
	}
	recordErr(r.c.Del(ctx, authSidDevicesKey(sid)).Err())
	return firstErr
}
