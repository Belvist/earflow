package auth

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

type memKV struct {
	m map[string]string
}

func (k *memKV) Get(_ context.Context, key string) (string, error) {
	v, ok := k.m[key]
	if !ok {
		return "", redis.Nil
	}
	return v, nil
}

func (k *memKV) SetEx(_ context.Context, key string, value string, _ time.Duration) error {
	k.m[key] = value
	return nil
}

func (k *memKV) Del(_ context.Context, key string) error {
	delete(k.m, key)
	return nil
}

func (k *memKV) Expire(_ context.Context, _ string, _ time.Duration) error {
	return nil
}

func TestSessionStore_EncryptsOnSetAndDecryptsOnGet(t *testing.T) {
	t.Setenv("SESSION_ENCRYPTION_KEY", strings.Repeat("00", 32))
	c, err := newSessionCipherFromEnv()
	if err != nil {
		t.Fatalf("newSessionCipherFromEnv failed: %v", err)
	}
	if c == nil {
		t.Fatalf("expected cipher to be enabled")
	}

	kv := &memKV{m: map[string]string{}}
	s := &SessionStore{rdb: kv, keyPrefix: "mp:sess:", ttl: 10 * time.Minute, cipher: c}

	ctx := context.Background()
	sid := "sid_12345678901234567890"
	sess := Session{AccessToken: "a", RefreshToken: "r", User: json.RawMessage(`{"id":1}`), CreatedAt: "", UpdatedAt: ""}

	if err := s.Set(ctx, sid, sess); err != nil {
		t.Fatalf("Set failed: %v", err)
	}
	stored := kv.m["mp:sess:"+sid]
	if !strings.HasPrefix(stored, sessionCipherPrefix) {
		t.Fatalf("expected encrypted value with prefix, got %q", stored)
	}

	out, err := s.Get(ctx, sid)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if out == nil || out.AccessToken != "a" || out.RefreshToken != "r" {
		t.Fatalf("unexpected session: %+v", out)
	}
}

func TestSessionStore_BackwardCompatiblePlaintextRead(t *testing.T) {
	t.Setenv("SESSION_ENCRYPTION_KEY", strings.Repeat("00", 32))
	c, err := newSessionCipherFromEnv()
	if err != nil {
		t.Fatalf("newSessionCipherFromEnv failed: %v", err)
	}
	kv := &memKV{m: map[string]string{}}
	s := &SessionStore{rdb: kv, keyPrefix: "mp:sess:", ttl: 10 * time.Minute, cipher: c}

	ctx := context.Background()
	sid := "sid_12345678901234567890"

	kv.m["mp:sess:"+sid] = `{"accessToken":"a","refreshToken":"r","user":null,"createdAt":"","updatedAt":""}`

	out, err := s.Get(ctx, sid)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if out == nil || out.AccessToken != "a" || out.RefreshToken != "r" {
		t.Fatalf("unexpected session: %+v", out)
	}
}

func TestSessionStore_RejectsCorruptEncryptedPayload(t *testing.T) {
	t.Setenv("SESSION_ENCRYPTION_KEY", strings.Repeat("00", 32))
	c, err := newSessionCipherFromEnv()
	if err != nil {
		t.Fatalf("newSessionCipherFromEnv failed: %v", err)
	}
	kv := &memKV{m: map[string]string{}}
	s := &SessionStore{rdb: kv, keyPrefix: "mp:sess:", ttl: 10 * time.Minute, cipher: c}

	ctx := context.Background()
	sid := "sid_12345678901234567890"
	kv.m["mp:sess:"+sid] = sessionCipherPrefix + "not-base64"

	out, err := s.Get(ctx, sid)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if out != nil {
		t.Fatalf("expected nil session")
	}
}
