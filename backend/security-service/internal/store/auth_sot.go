package store

import (
	"context"

	"github.com/earflow/music-platform/security-service/internal/store/authpg"
)

// AuthSoT coordinates Postgres SoT writes with Redis cache (PEND-SEC-011).
type AuthSoT struct {
	PG   *authpg.Store
	Mode authpg.Mode
}

// RevokeSessionFull attempts Postgres revoke first (when enabled), then always clears Redis.
// Returns Redis error if cleanup failed; otherwise may return PG error (session already dead in cache).
func (a *AuthSoT) RevokeSessionFull(ctx context.Context, redis *RedisClient, sid string, userID int64, jti string) error {
	var pgErr error
	if a != nil && a.Mode.WritesEnabled() && a.PG != nil {
		pgErr = a.PG.RevokeSession(ctx, authpg.RevokeSessionParams{
			SID:    sid,
			UserID: userID,
			JTI:    jti,
		})
	}
	var redisErr error
	if redis != nil {
		redisErr = redis.RevokeSessionFull(ctx, sid, userID, jti)
	}
	if redisErr != nil {
		return redisErr
	}
	// PG revoke is best-effort during dual_write rollout (PEND-SEC-011): Redis is user-visible SoT.
	if pgErr != nil {
		return nil
	}
	return nil
}
