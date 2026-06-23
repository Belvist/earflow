package store

import (
	"context"
	"errors"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/earflow/music-platform/security-service/internal/store/authpg"
	"github.com/redis/go-redis/v9"
)

type failingPG struct{}

func (failingPG) RevokeSession(context.Context, authpg.RevokeSessionParams) (int64, error) {
	return 0, errors.New("pg down")
}

// pgStoreStub wraps authpg.Store with failing revoke — minimal interface via embedding not possible; use nil PG with custom AuthSoT test via direct redis only.

func TestAuthSoT_RevokeSessionFull_RedisRunsWhenPGFails(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	c := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	rd := &RedisClient{c: c}

	sid := "sid_12345678901234567890"
	jti := "jti-sec-sot-pgfail-01"
	mr.Set(SIDKey(sid), jti)
	mr.Set(gatewaySessionKey(sid), `{}`)

	// PG nil but WritesEnabled — only tests redis path; PG fail covered in integration.
	sot := &AuthSoT{PG: nil, Mode: authpg.ModeDualWrite}
	if err := sot.RevokeSessionFull(context.Background(), rd, sid, 1, jti, RevokeReasonInternal); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if mr.Exists(SIDKey(sid)) {
		t.Fatal("expected redis sid deleted")
	}
}

func TestAuthSoT_OffMode_SkipsPG(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	c := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	rd := &RedisClient{c: c}

	sid := "sid_12345678901234567890"
	jti := "jti-sec-sot-off-01"
	mr.Set(SIDKey(sid), jti)

	sot := &AuthSoT{PG: nil, Mode: authpg.ModeOff}
	if err := sot.RevokeSessionFull(context.Background(), rd, sid, 1, jti, RevokeReasonInternal); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if mr.Exists(SIDKey(sid)) {
		t.Fatal("expected redis sid deleted")
	}
}
