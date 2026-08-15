package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/redis/go-redis/v9"
)

const (
	authSIDKeyPrefix       = "auth:sid:"
	authRefreshKeyPrefix   = "auth:refresh:"
	authSessionMetaPrefix  = "auth:session:meta:"
	authUserSidsPrefix     = "auth:user_sids:"
	authStepUpPrefix       = "auth:mfa_stepup:"
	authGracePrefix        = "auth:grace:"
	authDevicePrefix       = "auth:device:"
	authSidDevicesPrefix   = "auth:sid_devices:"
	authUserDevicesPrefix  = "auth:user_auth_devices:"
	defaultGatewaySessPref = "mp:sess:"
)

// GatewaySessionKeyPrefix returns the Redis prefix for gateway session blobs.
func GatewaySessionKeyPrefix() string {
	p := strings.TrimSpace(os.Getenv("SESSION_KEY_PREFIX"))
	if p == "" {
		return defaultGatewaySessPref
	}
	return p
}

func gatewaySessionKey(prefix, sid string) string {
	return prefix + sid
}

func authSIDKey(sid string) string       { return authSIDKeyPrefix + sid }
func authRefreshKey(jti string) string   { return authRefreshKeyPrefix + jti }
func authSessionMetaKey(sid string) string {
	return authSessionMetaPrefix + sid
}
func authUserSidsKey(userID int64) string {
	return fmt.Sprintf("%s%d", authUserSidsPrefix, userID)
}
func authStepUpKey(sid string) string    { return authStepUpPrefix + sid }
func authGraceKey(jti string) string      { return authGracePrefix + jti }
func authDeviceKey(authDeviceID string) string {
	return authDevicePrefix + authDeviceID
}
func authSidDevicesKey(sid string) string { return authSidDevicesPrefix + sid }

// RevokeSessionFull removes all Redis state tied to a browser session id (best-effort).
// It clears gateway mp:sess, auth refresh/sid index, session meta, MFA step-up, grace tokens,
// and auth-device bindings when present.
func RevokeSessionFull(ctx context.Context, rdb *redis.Client, gatewayPrefix, sid string, userID int64, jti string) error {
	sid = strings.TrimSpace(sid)
	if sid == "" || rdb == nil {
		return nil
	}
	if gatewayPrefix == "" {
		gatewayPrefix = GatewaySessionKeyPrefix()
	}

	var firstErr error
	recordErr := func(err error) {
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}

	if strings.TrimSpace(jti) == "" {
		got, err := rdb.Get(ctx, authSIDKey(sid)).Result()
		if err != nil && err != redis.Nil {
			recordErr(err)
		} else if err == nil {
			jti = strings.TrimSpace(got)
		}
	}

	if userID <= 0 {
		if uid, err := readUserIDFromSessionMeta(ctx, rdb, sid); err != nil {
			recordErr(err)
		} else if uid > 0 {
			userID = uid
		}
	}

	if jti != "" {
		recordErr(rdb.Del(ctx, authRefreshKey(jti)).Err())
		recordErr(rdb.Del(ctx, authGraceKey(jti)).Err())
	}
	recordErr(rdb.Del(ctx, authSIDKey(sid)).Err())
	recordErr(rdb.Del(ctx, authSessionMetaKey(sid)).Err())
	recordErr(rdb.Del(ctx, authStepUpKey(sid)).Err())
	recordErr(rdb.Del(ctx, gatewaySessionKey(gatewayPrefix, sid)).Err())

	recordErr(revokeAuthDevicesForSID(ctx, rdb, sid, userID))

	if userID > 0 {
		recordErr(rdb.SRem(ctx, authUserSidsKey(userID), sid).Err())
	}

	return firstErr
}

// revokeNodeSession removes the auth-service session state tied to the
// auth-service session id (nodeSid) and its current refresh jti. These keys are
// owned by auth-service and are NOT addressed by the gateway sid, so they must
// be cleaned explicitly using claims extracted from the stored refresh token.
func revokeNodeSession(ctx context.Context, rdb *redis.Client, userID int64, nodeSid, nodeJti string) error {
	if rdb == nil {
		return nil
	}
	var firstErr error
	recordErr := func(err error) {
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}
	if strings.TrimSpace(nodeSid) != "" {
		recordErr(rdb.Del(ctx, authSIDKey(nodeSid)).Err())
		recordErr(rdb.Del(ctx, authSessionMetaKey(nodeSid)).Err())
		recordErr(rdb.Del(ctx, authStepUpKey(nodeSid)).Err())
		if userID > 0 {
			recordErr(rdb.SRem(ctx, authUserSidsKey(userID), nodeSid).Err())
		}
	}
	if strings.TrimSpace(nodeJti) != "" {
		recordErr(rdb.Del(ctx, authRefreshKey(nodeJti)).Err())
		recordErr(rdb.Del(ctx, authGraceKey(nodeJti)).Err())
	}
	return firstErr
}

func readUserIDFromSessionMeta(ctx context.Context, rdb *redis.Client, sid string) (int64, error) {
	raw, err := rdb.Get(ctx, authSessionMetaKey(sid)).Result()
	if err == redis.Nil {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	var meta struct {
		UserID int64 `json:"userId"`
	}
	if jsonErr := json.Unmarshal([]byte(raw), &meta); jsonErr != nil {
		return 0, nil
	}
	return meta.UserID, nil
}

func revokeAuthDevicesForSID(ctx context.Context, rdb *redis.Client, sid string, userID int64) error {
	var firstErr error
	recordErr := func(err error) {
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}

	deviceIDs, err := rdb.SMembers(ctx, authSidDevicesKey(sid)).Result()
	if err != nil && err != redis.Nil {
		return err
	}
	for _, id := range deviceIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		recordErr(rdb.Del(ctx, authDeviceKey(id)).Err())
		if userID > 0 {
			recordErr(rdb.SRem(ctx, fmt.Sprintf("%s%d", authUserDevicesPrefix, userID), id).Err())
		}
	}
	recordErr(rdb.Del(ctx, authSidDevicesKey(sid)).Err())
	return firstErr
}

// userIDFromGatewaySession extracts numeric user id from stored gateway session user JSON.
func userIDFromGatewaySession(sess *Session) int64 {
	if sess == nil || len(sess.User) == 0 {
		return 0
	}
	var u struct {
		ID     any `json:"id"`
		UserID any `json:"userId"`
	}
	if err := json.Unmarshal(sess.User, &u); err != nil {
		return 0
	}
	if v := parseInt64ID(u.UserID); v > 0 {
		return v
	}
	return parseInt64ID(u.ID)
}

func parseInt64ID(v any) int64 {
	switch t := v.(type) {
	case float64:
		return int64(t)
	case int64:
		return t
	case int:
		return int64(t)
	case string:
		s := strings.TrimSpace(t)
		if s == "" {
			return 0
		}
		n, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			return 0
		}
		return n
	default:
		return 0
	}
}
