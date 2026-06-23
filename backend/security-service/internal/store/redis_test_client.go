package store

import "github.com/redis/go-redis/v9"

// RedisClientFromGoRedis wraps an existing go-redis client (unit tests only).
func RedisClientFromGoRedis(c *redis.Client) *RedisClient {
	if c == nil {
		return nil
	}
	return &RedisClient{c: c}
}
