package store

import (
	"context"
	"time"

	"github.com/earflow/music-platform/security-service/internal/store/authpg"
)

// AuthSoT coordinates Postgres SoT writes with Redis cache (PEND-SEC-011).
type AuthSoT struct {
	PG   *authpg.Store
	Mode authpg.Mode
}

// RevokeSessionFull attempts Postgres revoke first (when enabled), then always clears Redis,
// then publishes a revoke fan-out event (PEND-SEC-012, best-effort).
func (a *AuthSoT) RevokeSessionFull(ctx context.Context, redis *RedisClient, sid string, userID int64, jti, reason string) error {
	var sessionEpoch int64
	var pgErr error
	if a != nil && a.Mode.WritesEnabled() && a.PG != nil {
		sessionEpoch, pgErr = a.PG.RevokeSession(ctx, authpg.RevokeSessionParams{
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
	if redis != nil {
		_ = redis.PublishRevokeEvent(ctx, RevokeEvent{
			SID:          sid,
			UserID:       userID,
			SessionEpoch: sessionEpoch,
			Reason:       reason,
			IssuedAt:     time.Now().UTC().Format(time.RFC3339Nano),
		})
	}
	// PG revoke is best-effort during dual_write rollout (PEND-SEC-011): Redis is user-visible SoT.
	if pgErr != nil {
		return nil
	}
	return nil
}
