package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/earflow/music-platform/auth-core/internal/config"
	"github.com/redis/go-redis/v9"
)

type RedisClient struct {
	c *redis.Client
}

func NewRedis(ctx context.Context, cfg config.RedisConfig) (*RedisClient, error) {
	client := redis.NewClient(&redis.Options{
		Addr:         cfg.Addr(),
		Password:     cfg.Password,
		DB:           cfg.DB,
		DialTimeout:  cfg.DialTimeout,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		PoolSize:     cfg.PoolSize,
	})
	pingCtx, cancel := context.WithTimeout(ctx, cfg.DialTimeout+time.Second)
	defer cancel()
	if err := client.Ping(pingCtx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("redis ping: %w", err)
	}
	return &RedisClient{c: client}, nil
}

func (r *RedisClient) Close() error {
	return r.c.Close()
}

func (r *RedisClient) Client() *redis.Client {
	return r.c
}

func (r *RedisClient) Ping(ctx context.Context) error {
	return r.c.Ping(ctx).Err()
}

// --- key builders -----------------------------------------------------------

func SIDKey(sid string) string             { return "auth:sid:" + sid }
func RefreshKey(jti string) string         { return "auth:refresh:" + jti }
func GraceKey(jti string) string           { return "auth:grace:" + jti }
func SessionMetaKey(sid string) string     { return "auth:session:meta:" + sid }
func UserSidsKey(userID int64) string      { return fmt.Sprintf("auth:user_sids:%d", userID) }
func LoginLockKey(emailHash string) string { return "auth:login_lock:" + emailHash }
func LoginFailKey(emailHash string) string { return "auth:login_fail:" + emailHash }
func IsAdminKey(userID int64) string       { return fmt.Sprintf("auth:is_admin:%d", userID) }
func ProfileKey(userID int64) string       { return fmt.Sprintf("auth:profile:%d", userID) }
func IPFailKey(ip string) string           { return "auth:ip_fail:" + ip }

// --- session state ----------------------------------------------------------

// RefreshSession mirrors the JSON stored under auth:refresh:{jti}.
type RefreshSession struct {
	UserID  int64  `json:"userId"`
	SID     string `json:"sid"`
	IsAdmin bool   `json:"isAdmin"`
}

// GracePayload mirrors the JSON stored under auth:grace:{jti}.
type GracePayload struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
}

// StoreRefreshSession writes the session keys created at login/register/refresh:
// auth:refresh:{jti}, auth:sid:{sid}, session meta and the per-user sid index.
func (r *RedisClient) StoreRefreshSession(
	ctx context.Context,
	sid, jti string,
	userID int64,
	isAdmin bool,
	ttl time.Duration,
	createdAt time.Time,
	ip, ua string,
) error {
	if ttl <= 0 {
		ttl = 30 * 24 * time.Hour
	}
	sess := RefreshSession{UserID: userID, SID: sid, IsAdmin: isAdmin}
	raw, err := json.Marshal(sess)
	if err != nil {
		return err
	}

	pipe := r.c.TxPipeline()
	pipe.SetEx(ctx, RefreshKey(jti), raw, ttl)
	pipe.SetEx(ctx, SIDKey(sid), jti, ttl)
	meta := map[string]any{
		"userId":     userID,
		"createdAt":  createdAt.UTC().Format(time.RFC3339),
		"lastSeenAt": createdAt.UTC().Format(time.RFC3339),
		"ip":         ip,
		"ua":         ua,
	}
	metaRaw, _ := json.Marshal(meta)
	pipe.SetEx(ctx, SessionMetaKey(sid), metaRaw, ttl)
	pipe.SAdd(ctx, UserSidsKey(userID), sid)
	pipe.Expire(ctx, UserSidsKey(userID), ttl+24*time.Hour)
	_, err = pipe.Exec(ctx)
	return err
}

// GetSIDJTI returns the current jti bound to a Node-style sid, or "" when absent.
func (r *RedisClient) GetSIDJTI(ctx context.Context, sid string) (string, error) {
	v, err := r.c.Get(ctx, SIDKey(sid)).Result()
	if err == redis.Nil {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return v, nil
}

// GetRefreshSession loads the refresh session for a jti.
func (r *RedisClient) GetRefreshSession(ctx context.Context, jti string) (*RefreshSession, error) {
	raw, err := r.c.Get(ctx, RefreshKey(jti)).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var s RefreshSession
	if err := json.Unmarshal([]byte(raw), &s); err != nil {
		return nil, nil
	}
	return &s, nil
}

// DeleteRefreshKey removes auth:refresh:{jti} (used when a stale token is detected).
func (r *RedisClient) DeleteRefreshKey(ctx context.Context, jti string) error {
	return r.c.Del(ctx, RefreshKey(jti)).Err()
}

// GetGrace returns the grace payload for a rotated-out jti.
func (r *RedisClient) GetGrace(ctx context.Context, jti string) (*GracePayload, error) {
	raw, err := r.c.Get(ctx, GraceKey(jti)).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var g GracePayload
	if err := json.Unmarshal([]byte(raw), &g); err != nil {
		return nil, nil
	}
	return &g, nil
}

// TouchSessionMeta best-effort refreshes the session metadata TTL and client info.
func (r *RedisClient) TouchSessionMeta(ctx context.Context, sid string, ttl time.Duration, ip, ua string) {
	raw, err := r.c.Get(ctx, SessionMetaKey(sid)).Result()
	if err == redis.Nil {
		return
	}
	if err != nil || raw == "" {
		return
	}
	var meta map[string]any
	if err := json.Unmarshal([]byte(raw), &meta); err != nil {
		return
	}
	meta["lastSeenAt"] = time.Now().UTC().Format(time.RFC3339)
	meta["ip"] = ip
	meta["ua"] = ua
	next, _ := json.Marshal(meta)
	_ = r.c.SetEx(ctx, SessionMetaKey(sid), next, ttl).Err()
}

// AddUserSID index-alias the sid under the user's sid set (best-effort).
func (r *RedisClient) AddUserSID(ctx context.Context, userID int64, sid string, ttl time.Duration) {
	pipe := r.c.TxPipeline()
	pipe.SAdd(ctx, UserSidsKey(userID), sid)
	pipe.Expire(ctx, UserSidsKey(userID), ttl+24*time.Hour)
	_, _ = pipe.Exec(ctx)
}

// RemoveSessionMeta deletes the meta key and removes the sid from the user index.
func (r *RedisClient) RemoveSessionMeta(ctx context.Context, sid string, userID *int64) {
	_ = r.c.Del(ctx, SessionMetaKey(sid)).Err()
	if userID != nil {
		_ = r.c.SRem(ctx, UserSidsKey(*userID), sid).Err()
	}
}

// --- login lockout & brute-force ---------------------------------------------

// LoginLockoutStatus reports whether the email hash is currently locked.
func (r *RedisClient) LoginLockoutStatus(ctx context.Context, emailHash string) (locked bool, retryAfter time.Duration) {
	ttl, err := r.c.TTL(ctx, LoginLockKey(emailHash)).Result()
	if err != nil {
		return false, 0
	}
	if ttl > 0 {
		return true, ttl
	}
	return false, 0
}

// RecordLoginFailure increments the failure counter; returns the lock TTL
// (>=0) when the counter reached the threshold and the email is now locked.
func (r *RedisClient) RecordLoginFailure(
	ctx context.Context,
	emailHash string,
	failMax int,
	window, lock time.Duration,
) (lockedFor time.Duration) {
	counterKey := LoginFailKey(emailHash)

	locked, existing := r.LoginLockoutStatus(ctx, emailHash)
	if locked {
		return existing
	}

	count, err := r.c.Incr(ctx, counterKey).Result()
	if err != nil {
		return 0
	}
	if count == 1 {
		_ = r.c.Expire(ctx, counterKey, window).Err()
	}
	if count >= int64(failMax) {
		_ = r.c.SetEx(ctx, LoginLockKey(emailHash), "1", lock).Err()
		_ = r.c.Del(ctx, counterKey).Err()
		return lock
	}
	return 0
}

// ClearLoginFailures removes the failure counter and lock for an email.
func (r *RedisClient) ClearLoginFailures(ctx context.Context, emailHash string) {
	pipe := r.c.TxPipeline()
	pipe.Del(ctx, LoginFailKey(emailHash))
	pipe.Del(ctx, LoginLockKey(emailHash))
	_, _ = pipe.Exec(ctx)
}

// CheckIPFailures reports whether the client IP is blocked on auth endpoints.
func (r *RedisClient) CheckIPFailures(ctx context.Context, ip string, max int) (blocked bool, retryAfter time.Duration) {
	if ip == "" {
		return false, 0
	}
	ttl, err := r.c.TTL(ctx, IPFailKey(ip)).Result()
	if err != nil {
		return false, 0
	}
	if ttl > 0 {
		blocked = ttl > 0
	}
	return blocked, ttl
}

// RecordIPFailure increments the per-IP auth failure counter; returns lock TTL
// when the threshold is reached.
func (r *RedisClient) RecordIPFailure(
	ctx context.Context,
	ip string,
	max int,
	window, lock time.Duration,
) (lockedFor time.Duration) {
	if ip == "" {
		return 0
	}
	key := IPFailKey(ip)

	blocked, existing := r.CheckIPFailures(ctx, ip, max)
	if blocked {
		return existing
	}

	count, err := r.c.Incr(ctx, key).Result()
	if err != nil {
		return 0
	}
	if count == 1 {
		_ = r.c.Expire(ctx, key, window).Err()
	}
	if count >= int64(max) {
		_ = r.c.SetEx(ctx, key, "1", lock).Err()
		_ = r.c.Del(ctx, key).Err()
		return lock
	}
	return 0
}

// --- audit stream ------------------------------------------------------------

// auditKey holds a bounded list of security/ops events (fire-and-forget).
const auditKey = "auth:audit"

// Audit appends one security/ops event and bounds the stream:
// RPUSH + LTRIM(-10000) + EXPIRE(7d). Errors are swallowed — the audit lane must
// never block or fail the auth path.
func (r *RedisClient) Audit(ctx context.Context, event string, data map[string]any) {
	rec := map[string]any{
		"event": event,
		"ts":    time.Now().UTC().Format(time.RFC3339),
	}
	for k, v := range data {
		rec[k] = v
	}
	raw, err := json.Marshal(rec)
	if err != nil {
		return
	}
	pipe := r.c.TxPipeline()
	pipe.RPush(ctx, auditKey, raw)
	pipe.LTrim(ctx, auditKey, -10000, -1)
	pipe.Expire(ctx, auditKey, 7*24*time.Hour)
	_, _ = pipe.Exec(ctx)
}

// --- caches -----------------------------------------------------------------

func (r *RedisClient) GetCachedIsAdmin(ctx context.Context, userID int64) (bool, bool) {
	raw, err := r.c.Get(ctx, IsAdminKey(userID)).Result()
	if err != nil {
		return false, false
	}
	switch raw {
	case "1":
		return true, true
	case "0":
		return false, true
	default:
		return false, false
	}
}

func (r *RedisClient) SetCachedIsAdmin(ctx context.Context, userID int64, isAdmin bool, ttl time.Duration) {
	v := "0"
	if isAdmin {
		v = "1"
	}
	_ = r.c.SetEx(ctx, IsAdminKey(userID), v, ttl).Err()
}

func (r *RedisClient) GetCachedUserProfile(ctx context.Context, userID int64) (map[string]any, error) {
	raw, err := r.c.Get(ctx, ProfileKey(userID)).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return nil, nil
	}
	return m, nil
}

func (r *RedisClient) SetCachedUserProfile(ctx context.Context, userID int64, profile map[string]any, ttl time.Duration) {
	raw, err := json.Marshal(profile)
	if err != nil {
		return
	}
	_ = r.c.SetEx(ctx, ProfileKey(userID), raw, ttl).Err()
}
