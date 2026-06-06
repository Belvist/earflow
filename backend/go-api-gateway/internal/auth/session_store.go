package auth

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

type Session struct {
	AccessToken         string          `json:"accessToken"`
	RefreshToken        string          `json:"refreshToken"`
	User                json.RawMessage `json:"user"`
	CreatedAt           string          `json:"createdAt"`
	UpdatedAt           string          `json:"updatedAt"`
	LastCookieRefreshAt string          `json:"lastCookieRefreshAt,omitempty"`
}

type SessionStore struct {
	rdb       sessionKV
	keyPrefix string
	ttl       time.Duration
	cipher    *sessionCipher
}

type sessionKV interface {
	Get(ctx context.Context, key string) (string, error)
	SetEx(ctx context.Context, key string, value string, ttl time.Duration) error
	Del(ctx context.Context, key string) error
	Expire(ctx context.Context, key string, ttl time.Duration) error
}

type redisSessionKV struct {
	rdb *redis.Client
}

func (r redisSessionKV) Get(ctx context.Context, key string) (string, error) {
	return r.rdb.Get(ctx, key).Result()
}

func (r redisSessionKV) SetEx(ctx context.Context, key string, value string, ttl time.Duration) error {
	return r.rdb.SetEx(ctx, key, value, ttl).Err()
}

func (r redisSessionKV) Del(ctx context.Context, key string) error {
	return r.rdb.Del(ctx, key).Err()
}

func (r redisSessionKV) Expire(ctx context.Context, key string, ttl time.Duration) error {
	return r.rdb.Expire(ctx, key, ttl).Err()
}

func NewSessionStore(rdb *redis.Client, ttl time.Duration) (*SessionStore, error) {
	prefix := strings.TrimSpace(os.Getenv("SESSION_KEY_PREFIX"))
	if prefix == "" {
		prefix = "mp:sess:"
	}
	cipher, err := newSessionCipherFromEnv()
	if err != nil {
		return nil, err
	}
	return &SessionStore{rdb: redisSessionKV{rdb: rdb}, keyPrefix: prefix, ttl: ttl, cipher: cipher}, nil
}

func (s *SessionStore) Get(ctx context.Context, sid string) (*Session, error) {
	id := strings.TrimSpace(sid)
	if id == "" {
		return nil, nil
	}
	raw, err := s.rdb.Get(ctx, s.keyPrefix+id)
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	jsonBytes := []byte(raw)
	if s.cipher != nil {
		if pt, ok := s.cipher.decryptJSON(raw); ok {
			jsonBytes = pt
		} else if strings.HasPrefix(raw, sessionCipherPrefix) {
			return nil, nil
		}
	}

	var sess Session
	if err := json.Unmarshal(jsonBytes, &sess); err != nil {
		return nil, nil
	}
	if strings.TrimSpace(sess.AccessToken) == "" || strings.TrimSpace(sess.RefreshToken) == "" {
		return nil, nil
	}
	return &sess, nil
}

func (s *SessionStore) Set(ctx context.Context, sid string, sess Session) error {
	id := strings.TrimSpace(sid)
	if id == "" {
		return errors.New("missing sid")
	}
	if strings.TrimSpace(sess.AccessToken) == "" || strings.TrimSpace(sess.RefreshToken) == "" {
		return errors.New("invalid session")
	}

	b, err := json.Marshal(sess)
	if err != nil {
		return err
	}

	value := string(b)
	if s.cipher != nil {
		if enc, ok := s.cipher.encryptJSON(b); ok {
			value = enc
		} else {
			return errSessionCipherFailed
		}
	}

	ttl := s.ttl
	if ttl < time.Minute {
		return errors.New("invalid session ttl")
	}
	return s.rdb.SetEx(ctx, s.keyPrefix+id, value, ttl)
}

func (s *SessionStore) Delete(ctx context.Context, sid string) error {
	id := strings.TrimSpace(sid)
	if id == "" {
		return nil
	}
	return s.rdb.Del(ctx, s.keyPrefix+id)
}

func (s *SessionStore) Touch(ctx context.Context, sid string) error {
	id := strings.TrimSpace(sid)
	if id == "" {
		return nil
	}
	ttl := s.ttl
	if ttl < time.Minute {
		return errors.New("invalid session ttl")
	}
	err := s.rdb.Expire(ctx, s.keyPrefix+id, ttl)
	if err == redis.Nil {
		return nil
	}
	return err
}
