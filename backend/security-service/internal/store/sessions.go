package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
)

// SessionInfo is a decoded representation of a refresh session.
type SessionInfo struct {
	SID          string
	JTI          string
	TTLSeconds   int64
	CreatedAt    string
	LastSeenAt   string
	IP           string
	UA           string
	MetaMissing  bool
}

type sessionMetaJSON struct {
	UserID     int64  `json:"userId"`
	CreatedAt  string `json:"createdAt"`
	LastSeenAt string `json:"lastSeenAt"`
	IP         string `json:"ip"`
	UA         string `json:"ua"`
}

// EnumerateUserSids returns all sids recorded in the per-user index.
// The index is best-effort; dead ones are cleaned up by ReadSessionInfo callers.
func (r *RedisClient) EnumerateUserSids(ctx context.Context, userID int64) ([]string, error) {
	sids, err := r.c.SMembers(ctx, UserSidsKey(userID)).Result()
	if errors.Is(err, redis.Nil) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return sids, nil
}

// ReadSessionInfo loads the refresh session by sid. Returns (nil, nil) when
// the sid is no longer active (expired / revoked).
func (r *RedisClient) ReadSessionInfo(ctx context.Context, sid string) (*SessionInfo, error) {
	if sid == "" {
		return nil, nil
	}

	jti, err := r.c.Get(ctx, SIDKey(sid)).Result()
	if errors.Is(err, redis.Nil) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if jti == "" {
		return nil, nil
	}

	ttl, err := r.c.TTL(ctx, SIDKey(sid)).Result()
	if err != nil {
		ttl = 0
	}

	info := &SessionInfo{
		SID:        sid,
		JTI:        jti,
		TTLSeconds: int64(ttl.Seconds()),
	}

	rawMeta, err := r.c.Get(ctx, SessionMetaKey(sid)).Result()
	if errors.Is(err, redis.Nil) {
		info.MetaMissing = true
		return info, nil
	}
	if err != nil {
		return info, nil
	}
	if rawMeta == "" {
		info.MetaMissing = true
		return info, nil
	}

	var meta sessionMetaJSON
	if jsonErr := json.Unmarshal([]byte(rawMeta), &meta); jsonErr == nil {
		info.CreatedAt = meta.CreatedAt
		info.LastSeenAt = meta.LastSeenAt
		info.IP = meta.IP
		info.UA = meta.UA
	}
	return info, nil
}

// SessionOwnedByUser returns true when session metadata userId matches.
func (r *RedisClient) SessionOwnedByUser(ctx context.Context, sid string, userID int64) bool {
	if sid == "" || userID <= 0 {
		return false
	}
	rawMeta, err := r.c.Get(ctx, SessionMetaKey(sid)).Result()
	if errors.Is(err, redis.Nil) || rawMeta == "" {
		return false
	}
	if err != nil {
		return false
	}
	var meta sessionMetaJSON
	if jsonErr := json.Unmarshal([]byte(rawMeta), &meta); jsonErr != nil {
		return false
	}
	return meta.UserID == userID
}

// RevokeSession removes all Redis state for sid (gateway mp:sess + auth refresh layer).
// Prefer RevokeSessionViaSoT when AuthSoT is configured.
func (r *RedisClient) RevokeSession(ctx context.Context, userID int64, sid, jti string) error {
	return r.RevokeSessionFull(ctx, sid, userID, jti)
}

// RevokeSessionViaSoT applies PG-first revoke when AuthSoT mode allows writes.
func RevokeSessionViaSoT(ctx context.Context, sot *AuthSoT, redis *RedisClient, userID int64, sid, jti string) error {
	if sot != nil {
		return sot.RevokeSessionFull(ctx, redis, sid, userID, jti)
	}
	if redis == nil {
		return nil
	}
	return redis.RevokeSessionFull(ctx, sid, userID, jti)
}

// RemoveUserSidFromIndex removes a single sid from the per-user set (cleanup).
func (r *RedisClient) RemoveUserSidFromIndex(ctx context.Context, userID int64, sid string) error {
	return r.c.SRem(ctx, UserSidsKey(userID), sid).Err()
}

// CleanupDeadSids removes stale index entries and orphaned gateway/auth keys.
func (r *RedisClient) CleanupDeadSids(ctx context.Context, userID int64, sids []string) {
	if len(sids) == 0 {
		return
	}
	_ = r.c.SRem(ctx, UserSidsKey(userID), toInterfaceSlice(sids)...).Err()
	for _, sid := range sids {
		_ = r.c.Del(ctx, SessionMetaKey(sid)).Err()
		_ = r.c.Del(ctx, SIDKey(sid)).Err()
		_ = r.c.Del(ctx, gatewaySessionKey(sid)).Err()
	}
}

// GatewaySessionExists reports whether mp:sess (gateway blob) is still present.
func (r *RedisClient) GatewaySessionExists(ctx context.Context, sid string) bool {
	if r == nil || sid == "" {
		return false
	}
	n, err := r.c.Exists(ctx, gatewaySessionKey(sid)).Result()
	return err == nil && n > 0
}

func toInterfaceSlice(in []string) []interface{} {
	out := make([]interface{}, len(in))
	for i, v := range in {
		out[i] = v
	}
	return out
}

// --- step-up ---------------------------------------------------------------

type StepUpStatus struct {
	OK         bool
	UserID     int64
	At         string
	TTLSeconds int64
}

type stepUpPayloadJSON struct {
	UserID int64  `json:"userId"`
	At     string `json:"at"`
}

// GetStepUpStatus reads the step-up marker for a sid.
func (r *RedisClient) GetStepUpStatus(ctx context.Context, sid string) (StepUpStatus, error) {
	raw, err := r.c.Get(ctx, StepUpKey(sid)).Result()
	if errors.Is(err, redis.Nil) {
		return StepUpStatus{OK: false}, nil
	}
	if err != nil {
		return StepUpStatus{OK: false}, err
	}
	var parsed stepUpPayloadJSON
	if jsonErr := json.Unmarshal([]byte(raw), &parsed); jsonErr != nil {
		return StepUpStatus{OK: false}, nil
	}
	if parsed.UserID <= 0 {
		return StepUpStatus{OK: false}, nil
	}
	ttl, _ := r.c.TTL(ctx, StepUpKey(sid)).Result()
	return StepUpStatus{
		OK:         true,
		UserID:     parsed.UserID,
		At:         parsed.At,
		TTLSeconds: int64(ttl.Seconds()),
	}, nil
}

// BumpStepUp refreshes the step-up marker for a sid.
func (r *RedisClient) BumpStepUp(ctx context.Context, sid string, userID int64, ttl time.Duration) error {
	payload, err := json.Marshal(stepUpPayloadJSON{UserID: userID, At: time.Now().UTC().Format(time.RFC3339)})
	if err != nil {
		return err
	}
	return r.c.Set(ctx, StepUpKey(sid), payload, ttl).Err()
}

// --- rate limiter ----------------------------------------------------------

type RateLimitResult struct {
	Blocked         bool
	RetryAfterSecs  int64
	CurrentAttempts int64
}

// IncrRateLimit atomically increments a counter with a sliding TTL window.
// If the counter exceeds max, the caller must reject the request. The TTL is
// set on the first increment so subsequent windows reset naturally.
func (r *RedisClient) IncrRateLimit(ctx context.Context, key string, max int, window time.Duration) (RateLimitResult, error) {
	current, err := r.c.Incr(ctx, key).Result()
	if err != nil {
		return RateLimitResult{}, err
	}
	if current == 1 {
		if err := r.c.Expire(ctx, key, window).Err(); err != nil {
			return RateLimitResult{CurrentAttempts: current}, err
		}
	}
	if max > 0 && current > int64(max) {
		ttl, _ := r.c.TTL(ctx, key).Result()
		secs := int64(ttl.Seconds())
		if secs <= 0 {
			secs = int64(window.Seconds())
		}
		return RateLimitResult{
			Blocked:         true,
			RetryAfterSecs:  secs,
			CurrentAttempts: current,
		}, nil
	}
	return RateLimitResult{Blocked: false, CurrentAttempts: current}, nil
}
