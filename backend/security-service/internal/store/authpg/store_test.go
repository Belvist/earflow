package authpg_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/earflow/music-platform/security-service/internal/store/authpg"
	"github.com/jackc/pgx/v5/pgxpool"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set — integration test skipped")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

func TestRevokeSession_BumpsEpochAndSetsRevoked(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()

	ctx := context.Background()
	store := authpg.NewStore(pool)

	sid := "sid_test_pg_sot_revoke01"
	userID := int64(999001)
	jti := "jti_test_pg_sot_revoke01"

	_, _ = pool.Exec(ctx, `DELETE FROM security_events WHERE sid = $1`, sid)
	_, _ = pool.Exec(ctx, `DELETE FROM refresh_tokens WHERE sid = $1`, sid)
	_, _ = pool.Exec(ctx, `DELETE FROM auth_devices WHERE sid = $1`, sid)
	_, _ = pool.Exec(ctx, `DELETE FROM auth_sessions WHERE sid = $1`, sid)

	if err := store.UpsertSession(ctx, authpg.SessionUpsertParams{
		SID: sid, UserID: userID, RefreshJTI: jti,
	}); err != nil {
		t.Fatalf("upsert session: %v", err)
	}

	var epochBefore int64
	if err := pool.QueryRow(ctx, `SELECT session_epoch FROM auth_sessions WHERE sid = $1`, sid).Scan(&epochBefore); err != nil {
		t.Fatalf("read epoch: %v", err)
	}

	if err := store.RevokeSession(ctx, authpg.RevokeSessionParams{SID: sid, UserID: userID, JTI: jti}); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	var revokedAt any
	var epochAfter int64
	err := pool.QueryRow(ctx, `
		SELECT revoked_at, session_epoch FROM auth_sessions WHERE sid = $1
	`, sid).Scan(&revokedAt, &epochAfter)
	if err != nil {
		t.Fatalf("read after revoke: %v", err)
	}
	if revokedAt == nil {
		t.Fatal("expected revoked_at set")
	}
	if epochAfter != epochBefore+1 {
		t.Fatalf("session_epoch: got %d want %d", epochAfter, epochBefore+1)
	}
}

func TestParseMode_DefaultOff(t *testing.T) {
	t.Setenv("AUTH_PG_SOT_MODE", "")
	if authpg.ParseMode() != authpg.ModeOff {
		t.Fatalf("expected off")
	}
}
