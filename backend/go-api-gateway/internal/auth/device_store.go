package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

type AuthDeviceRecord struct {
	AuthDeviceID  string `json:"authDeviceId"`
	SID           string `json:"sid"`
	UserID        int64  `json:"userId"`
	PublicKeySPKI string `json:"publicKeySpki"`
	CreatedAt     string `json:"createdAt"`
	LastSeenAt    string `json:"lastSeenAt"`
	UA            string `json:"ua,omitempty"`
	RevokedAt     string `json:"revokedAt,omitempty"`
}

type AuthDeviceStore struct {
	rdb *redis.Client
}

func NewAuthDeviceStore(rdb *redis.Client) *AuthDeviceStore {
	return &AuthDeviceStore{rdb: rdb}
}

func (s *AuthDeviceStore) Save(ctx context.Context, rec AuthDeviceRecord) error {
	if s == nil || s.rdb == nil {
		return errors.New("device store unavailable")
	}
	id := strings.TrimSpace(rec.AuthDeviceID)
	sid := strings.TrimSpace(rec.SID)
	if id == "" || sid == "" || rec.UserID <= 0 || strings.TrimSpace(rec.PublicKeySPKI) == "" {
		return errors.New("invalid device record")
	}
	b, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	pipe := s.rdb.TxPipeline()
	pipe.Set(ctx, authDeviceKey(id), string(b), 0)
	pipe.SAdd(ctx, authSidDevicesKey(sid), id)
	pipe.SAdd(ctx, fmt.Sprintf("%s%d", authUserDevicesPrefix, rec.UserID), id)
	_, err = pipe.Exec(ctx)
	return err
}

func (s *AuthDeviceStore) Get(ctx context.Context, authDeviceID string) (*AuthDeviceRecord, error) {
	if s == nil || s.rdb == nil {
		return nil, errors.New("device store unavailable")
	}
	id := strings.TrimSpace(authDeviceID)
	if id == "" {
		return nil, nil
	}
	raw, err := s.rdb.Get(ctx, authDeviceKey(id)).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var rec AuthDeviceRecord
	if err := json.Unmarshal([]byte(raw), &rec); err != nil {
		return nil, nil
	}
	return &rec, nil
}

func (s *AuthDeviceStore) Touch(ctx context.Context, authDeviceID, ua string) error {
	rec, err := s.Get(ctx, authDeviceID)
	if err != nil || rec == nil {
		return err
	}
	if strings.TrimSpace(rec.RevokedAt) != "" {
		return errors.New("device revoked")
	}
	rec.LastSeenAt = time.Now().UTC().Format(time.RFC3339)
	if ua != "" {
		rec.UA = ua
	}
	return s.Save(ctx, *rec)
}

func (s *AuthDeviceStore) Revoke(ctx context.Context, authDeviceID string) error {
	rec, err := s.Get(ctx, authDeviceID)
	if err != nil || rec == nil {
		return err
	}
	rec.RevokedAt = time.Now().UTC().Format(time.RFC3339)
	return s.Save(ctx, *rec)
}
