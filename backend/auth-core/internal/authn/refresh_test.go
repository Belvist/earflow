package authn

import (
	"context"
	"net"
	"strconv"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/earflow/music-platform/auth-core/internal/config"
	"github.com/earflow/music-platform/auth-core/internal/store"
)

func mustAtoi(v string) int {
	n, err := strconv.Atoi(v)
	if err != nil {
		panic(err)
	}
	return n
}

type stubUserReader struct{}

func (stubUserReader) GetUserByID(ctx context.Context, id int64) (*store.AuthUser, error) {
	return nil, store.ErrUserNotFound
}

func testService(t *testing.T) (*Service, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	host, port, _ := net.SplitHostPort(mr.Addr())
	rd, err := store.NewRedis(context.Background(), config.RedisConfig{Host: host, Port: mustAtoi(port)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rd.Close() })

	cfg := config.Config{
		JWT: config.JWTConfig{
			Secret:   []byte("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),
			Issuer:   "earflow-auth",
			Audience: "earflow-api",
		},
		Auth: config.AuthConfig{
			AccessJWTExpire:           15 * time.Minute,
			RefreshJWTExpire:          365 * 24 * time.Hour,
			ProfileCacheTTL:           600 * time.Second,
			AdminFlagCacheTTL:         30 * time.Second,
			PbkdfIterations:           600000,
			PbkdfIterationsLegacy:     100000,
			PbkdfKeyLength:            64,
			EncryptionPbkdfIterations: 600000,
			EncryptionKeyLength:       32,
			GraceTTL:                  30 * time.Minute,
			LoginFailMax:              5,
			LoginFailWindow:           15 * time.Minute,
			LoginLockSeconds:          15 * time.Minute,
			AuthEndpointIPMax:         10,
			AuthEndpointIPWindow:      15 * time.Minute,
		},
	}
	s := &Service{
		RD:          rd,
		Users:       stubUserReader{},
		JWTSecret:   cfg.JWT.Secret,
		JWTIssuer:   cfg.JWT.Issuer,
		JWTAudience: cfg.JWT.Audience,
		Auth:        cfg.Auth,
		decoySalt:   "aa",
	}
	return s, mr
}

func TestRefreshRotationHappyPath(t *testing.T) {
	s, mr := testService(t)
	ctx := WithClientMetadata(context.Background(), "1.2.3.4", "test-ua")

	now := time.Now().UTC()
	if err := s.RD.StoreRefreshSession(ctx, "sid1", "jti1", 42, false, 30*24*time.Hour, now, "1.2.3.4", "test-ua"); err != nil {
		t.Fatal(err)
	}

	rt, err := IssueRefreshToken(s.JWTSecret, s.JWTIssuer, s.JWTAudience, 365*24*time.Hour, 42, "sid1", "jti1")
	if err != nil {
		t.Fatal(err)
	}

	res, apiErr := s.Refresh(ctx, rt)
	if apiErr != nil {
		t.Fatalf("refresh failed: %+v", apiErr)
	}
	if res.AccessToken == "" || res.RefreshToken == "" {
		t.Fatal("empty rotation result")
	}

	// Old jti must now resolve to the grace payload.
	claims, _ := VerifyRefresh(s.JWTSecret, s.JWTIssuer, s.JWTAudience, rt)
	if claims.JTI == "" {
		t.Fatal("bad jti")
	}
	grace, err := s.RD.GetGrace(ctx, claims.JTI)
	if err != nil || grace == nil {
		t.Fatalf("grace missing after rotation: %v", err)
	}
	if grace.AccessToken != res.AccessToken || grace.RefreshToken != res.RefreshToken {
		t.Fatal("grace payload mismatch")
	}

	// Reusing the old token after rotation returns the same grace pair.
	res2, apiErr2 := s.Refresh(ctx, rt)
	if apiErr2 != nil {
		t.Fatalf("second refresh failed: %+v", apiErr2)
	}
	if res2.AccessToken != res.AccessToken || res2.RefreshToken != res.RefreshToken {
		t.Fatal("grace replay mismatch")
	}

	// sid now points to the new jti.
	jti, err := s.RD.GetSIDJTI(ctx, "sid1")
	if err != nil || jti == "" {
		t.Fatalf("sid binding missing: %v", err)
	}
	if jti == "jti1" {
		t.Fatal("sid still bound to old jti")
	}

	_ = mr
}

func TestRefreshUnknownToken(t *testing.T) {
	s, _ := testService(t)
	ctx := context.Background()

	rt, _ := IssueRefreshToken(s.JWTSecret, s.JWTIssuer, s.JWTAudience, 365*24*time.Hour, 42, "sid-none", "jti-none")
	res, apiErr := s.Refresh(ctx, rt)
	if res != nil || apiErr == nil {
		t.Fatal("unknown sid should fail")
	}
	if apiErr.Status != 401 {
		t.Fatalf("expected 401, got %d", apiErr.Status)
	}
}

func TestRefreshMalformed(t *testing.T) {
	s, _ := testService(t)
	if _, apiErr := s.Refresh(context.Background(), ""); apiErr == nil || apiErr.Status != 400 {
		t.Fatal("empty token should be 400")
	}
	if _, apiErr := s.Refresh(context.Background(), "short"); apiErr == nil || apiErr.Status != 400 {
		t.Fatal("short token should be 400")
	}
	if _, apiErr := s.Refresh(context.Background(), "garbage-token-garbage-token-garbage-token-garbage-token"); apiErr == nil || apiErr.Status != 401 {
		t.Fatal("invalid signature should be 401")
	}
}
