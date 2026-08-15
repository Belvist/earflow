package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
)

// Tg2faRecord is the pending Telegram confirmation code for a user.
type Tg2faRecord struct {
	Code      string    `json:"code"`
	ChatID    int64     `json:"chatId"`
	MessageID int64     `json:"messageId"`
	UserID    int64     `json:"userId"`
	CreatedAt time.Time `json:"createdAt"`
}

// SetTg2faCode stores the pending code with a TTL equal to the code lifetime.
func (r *RedisClient) SetTg2faCode(ctx context.Context, userID int64, rec Tg2faRecord, ttl time.Duration) error {
	payload, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	return r.c.Set(ctx, Tg2faKey(userID), payload, ttl).Err()
}

// GetTg2faCode returns the pending code record, if any.
func (r *RedisClient) GetTg2faCode(ctx context.Context, userID int64) (*Tg2faRecord, error) {
	raw, err := r.c.Get(ctx, Tg2faKey(userID)).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, nil
		}
		return nil, err
	}
	var rec Tg2faRecord
	if err := json.Unmarshal(raw, &rec); err != nil {
		return nil, err
	}
	return &rec, nil
}

// DelTg2faCode clears a pending code.
func (r *RedisClient) DelTg2faCode(ctx context.Context, userID int64) error {
	return r.c.Del(ctx, Tg2faKey(userID)).Err()
}

// Tg2faCodeTTL reports the remaining lifetime of a pending code.
func (r *RedisClient) Tg2faCodeTTL(ctx context.Context, userID int64) (time.Duration, error) {
	return r.c.TTL(ctx, Tg2faKey(userID)).Result()
}
