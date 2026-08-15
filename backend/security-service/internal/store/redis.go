package store

import (
	"context"
	"fmt"
	"time"

	"github.com/earflow/music-platform/security-service/internal/config"
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

// --- key builders -----------------------------------------------------------

func SIDKey(sid string) string         { return "auth:sid:" + sid }
func RefreshKey(jti string) string     { return "auth:refresh:" + jti }
func SessionMetaKey(sid string) string { return "auth:session:meta:" + sid }
func UserSidsKey(userID int64) string  { return fmt.Sprintf("auth:user_sids:%d", userID) }
func StepUpKey(sid string) string      { return "auth:mfa_stepup:" + sid }
func PasswordAttemptsKey(userID int64) string {
	return fmt.Sprintf("auth:password_attempts:%d", userID)
}
func StrengthAttemptsKey(userID int64) string {
	return fmt.Sprintf("auth:password_strength:%d", userID)
}
func MFAAttemptsKey(userID int64) string {
	return fmt.Sprintf("auth:mfa_attempts:%d", userID)
}

// Tg2faKey holds the pending Telegram confirmation code for a user.
func Tg2faKey(userID int64) string {
	return fmt.Sprintf("auth:tg2fa:%d", userID)
}

// Tg2faAttemptsKey is the per-user rate limiter for code verification.
func Tg2faAttemptsKey(userID int64) string {
	return fmt.Sprintf("auth:tg2fa_attempts:%d", userID)
}

// Tg2faResendKey is the per-user cooldown between code resends.
func Tg2faResendKey(userID int64) string {
	return fmt.Sprintf("auth:tg2fa_resend:%d", userID)
}

// Ping verifies the connection. Useful for /health.
func (r *RedisClient) Ping(ctx context.Context) error {
	return r.c.Ping(ctx).Err()
}
