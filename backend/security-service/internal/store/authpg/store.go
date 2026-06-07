package authpg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	EventSessionRevoked = "session_revoked"
	EventDeviceUpsert   = "auth_device_upsert"
	EventSessionUpsert  = "session_upsert"
)

// Store is the Postgres SoT for auth sessions/devices (PEND-SEC-011).
type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store {
	if pool == nil {
		return nil
	}
	return &Store{pool: pool}
}

type SessionUpsertParams struct {
	SID        string
	UserID     int64
	RefreshJTI string
	IP         string
	UserAgent  string
}

type DeviceUpsertParams struct {
	AuthDeviceID  string
	SID           string
	UserID        int64
	PublicKeySPKI string
	UserAgent     string
}

type RevokeSessionParams struct {
	SID    string
	UserID int64
	JTI    string
}

// UpsertSession inserts or refreshes an active session row (login dual-write).
func (s *Store) UpsertSession(ctx context.Context, p SessionUpsertParams) error {
	if s == nil || s.pool == nil {
		return errors.New("authpg store unavailable")
	}
	sid := strings.TrimSpace(p.SID)
	if sid == "" || p.UserID <= 0 {
		return errors.New("invalid session upsert params")
	}
	ip := parseOptionalInet(p.IP)
	jti := strings.TrimSpace(p.RefreshJTI)
	ua := strings.TrimSpace(p.UserAgent)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const qSession = `
		INSERT INTO auth_sessions (sid, user_id, refresh_jti, created_at, last_seen_at, ip, user_agent)
		VALUES ($1, $2, NULLIF($3, ''), NOW(), NOW(), $4, NULLIF($5, ''))
		ON CONFLICT (sid) DO UPDATE SET
			user_id = EXCLUDED.user_id,
			refresh_jti = COALESCE(NULLIF(EXCLUDED.refresh_jti, ''), auth_sessions.refresh_jti),
			last_seen_at = NOW(),
			ip = COALESCE(EXCLUDED.ip, auth_sessions.ip),
			user_agent = COALESCE(NULLIF(EXCLUDED.user_agent, ''), auth_sessions.user_agent),
			revoked_at = NULL
	`
	if _, err := tx.Exec(ctx, qSession, sid, p.UserID, jti, ip, ua); err != nil {
		return fmt.Errorf("upsert auth_sessions: %w", err)
	}

	if jti != "" {
		const qRefresh = `
			INSERT INTO refresh_tokens (jti, sid, user_id, expires_at, created_at)
			VALUES ($1, $2, $3, NOW() + INTERVAL '365 days', NOW())
			ON CONFLICT (jti) DO UPDATE SET
				sid = EXCLUDED.sid,
				user_id = EXCLUDED.user_id,
				revoked_at = NULL
		`
		if _, err := tx.Exec(ctx, qRefresh, jti, sid, p.UserID); err != nil {
			return fmt.Errorf("upsert refresh_tokens: %w", err)
		}
	}

	if err := s.appendEventTx(ctx, tx, p.UserID, sid, "", EventSessionUpsert, map[string]any{"sid": sid}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// UpsertDevice registers or updates a PoP device row.
func (s *Store) UpsertDevice(ctx context.Context, p DeviceUpsertParams) error {
	if s == nil || s.pool == nil {
		return errors.New("authpg store unavailable")
	}
	id := strings.TrimSpace(p.AuthDeviceID)
	sid := strings.TrimSpace(p.SID)
	if id == "" || sid == "" || p.UserID <= 0 || strings.TrimSpace(p.PublicKeySPKI) == "" {
		return errors.New("invalid device upsert params")
	}
	const q = `
		INSERT INTO auth_devices (auth_device_id, sid, user_id, public_key_spki, created_at, last_seen_at, user_agent)
		VALUES ($1, $2, $3, $4, NOW(), NOW(), NULLIF($5, ''))
		ON CONFLICT (auth_device_id) DO UPDATE SET
			sid = EXCLUDED.sid,
			user_id = EXCLUDED.user_id,
			public_key_spki = EXCLUDED.public_key_spki,
			last_seen_at = NOW(),
			user_agent = COALESCE(NULLIF(EXCLUDED.user_agent, ''), auth_devices.user_agent),
			revoked_at = NULL
	`
	if _, err := s.pool.Exec(ctx, q, id, sid, p.UserID, p.PublicKeySPKI, p.UserAgent); err != nil {
		return fmt.Errorf("upsert auth_devices: %w", err)
	}
	return s.AppendEvent(ctx, p.UserID, sid, id, EventDeviceUpsert, map[string]any{"authDeviceId": id})
}

// RevokeSession marks session, devices, and refresh tokens revoked and bumps epochs (PG-first revoke).
func (s *Store) RevokeSession(ctx context.Context, p RevokeSessionParams) error {
	if s == nil || s.pool == nil {
		return errors.New("authpg store unavailable")
	}
	sid := strings.TrimSpace(p.SID)
	if sid == "" {
		return nil
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const qSession = `
		UPDATE auth_sessions
		SET revoked_at = COALESCE(revoked_at, NOW()),
		    session_epoch = session_epoch + 1
		WHERE sid = $1
	`
	if _, err := tx.Exec(ctx, qSession, sid); err != nil {
		return fmt.Errorf("revoke auth_sessions: %w", err)
	}

	const qDevices = `
		UPDATE auth_devices
		SET revoked_at = COALESCE(revoked_at, NOW()),
		    device_epoch = device_epoch + 1
		WHERE sid = $1
	`
	if _, err := tx.Exec(ctx, qDevices, sid); err != nil {
		return fmt.Errorf("revoke auth_devices: %w", err)
	}

	const qRefresh = `
		UPDATE refresh_tokens
		SET revoked_at = COALESCE(revoked_at, NOW()),
		    session_epoch = session_epoch + 1
		WHERE sid = $1
	`
	if _, err := tx.Exec(ctx, qRefresh, sid); err != nil {
		return fmt.Errorf("revoke refresh_tokens: %w", err)
	}

	if jti := strings.TrimSpace(p.JTI); jti != "" {
		const qJTI = `
			UPDATE refresh_tokens
			SET revoked_at = COALESCE(revoked_at, NOW()),
			    session_epoch = session_epoch + 1
			WHERE jti = $1
		`
		if _, err := tx.Exec(ctx, qJTI, jti); err != nil {
			return fmt.Errorf("revoke refresh jti: %w", err)
		}
	}

	payload := map[string]any{"sid": sid}
	if p.UserID > 0 {
		payload["userId"] = p.UserID
	}
	if err := s.appendEventTx(ctx, tx, p.UserID, sid, "", EventSessionRevoked, payload); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// AppendEvent inserts an audit row (append-only).
func (s *Store) AppendEvent(ctx context.Context, userID int64, sid, authDeviceID, eventType string, payload map[string]any) error {
	if s == nil || s.pool == nil {
		return errors.New("authpg store unavailable")
	}
	return appendSecurityEvent(ctx, s.pool, userID, sid, authDeviceID, eventType, payload)
}

func (s *Store) appendEventTx(ctx context.Context, tx pgx.Tx, userID int64, sid, authDeviceID, eventType string, payload map[string]any) error {
	return appendSecurityEvent(ctx, tx, userID, sid, authDeviceID, eventType, payload)
}

func appendSecurityEvent(ctx context.Context, exec interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}, userID int64, sid, authDeviceID, eventType string, payload map[string]any) error {
	if payload == nil {
		payload = map[string]any{}
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	var uid any
	if userID > 0 {
		uid = userID
	}
	const q = `
		INSERT INTO security_events (user_id, sid, auth_device_id, event_type, payload, created_at)
		VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), $4, $5::jsonb, NOW())
	`
	_, err = exec.Exec(ctx, q, uid, strings.TrimSpace(sid), strings.TrimSpace(authDeviceID), eventType, string(raw))
	if err != nil {
		return fmt.Errorf("insert security_events: %w", err)
	}
	return nil
}

// SessionEpoch returns current session_epoch for sid (read for admin/debug only, not hot path).
func (s *Store) SessionEpoch(ctx context.Context, sid string) (int64, error) {
	sid = strings.TrimSpace(sid)
	if sid == "" {
		return 0, errors.New("empty sid")
	}
	var epoch int64
	err := s.pool.QueryRow(ctx, `SELECT session_epoch FROM auth_sessions WHERE sid = $1`, sid).Scan(&epoch)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return epoch, err
}

func parseOptionalInet(ip string) any {
	ip = strings.TrimSpace(ip)
	if ip == "" {
		return nil
	}
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return nil
	}
	return parsed
}

// Ping verifies connectivity (health).
func (s *Store) Ping(ctx context.Context) error {
	if s == nil || s.pool == nil {
		return errors.New("authpg store unavailable")
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	return s.pool.Ping(ctx)
}
