// Package redisx wraps go-redis with project-wide defaults and a single
// constructor so every caller shares the same pool + timeouts.
package redisx

import (
	"context"
	"fmt"
	"time"

	"github.com/earflow/music-platform/device-sync-service/internal/config"
	"github.com/redis/go-redis/v9"
)

// New builds a redis.UniversalClient from cfg. Ping is performed with a hard
// timeout so misconfiguration fails the container early instead of timing out
// the first real request.
func New(ctx context.Context, cfg *config.Config) (*redis.Client, error) {
	rdb := redis.NewClient(&redis.Options{
		Addr:         cfg.Redis.Addr,
		Password:     cfg.Redis.Password,
		DB:           cfg.Redis.DB,
		PoolSize:     cfg.Redis.PoolSize,
		MinIdleConns: cfg.Redis.MinIdleConns,
		DialTimeout:  cfg.Redis.DialTimeout,
		ReadTimeout:  cfg.Redis.ReadTimeout,
		WriteTimeout: cfg.Redis.WriteTimeout,
		// Be generous with context timeouts on initialisation — fail fast on
		// pathological environments but tolerate a cold Redis.
		MaxRetries: 3,
	})

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := rdb.Ping(pingCtx).Err(); err != nil {
		_ = rdb.Close()
		return nil, fmt.Errorf("redis ping: %w", err)
	}
	return rdb, nil
}
