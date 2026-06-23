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

// ActiveAuthDeviceRow is a non-revoked PoP device row for list UI.
type ActiveAuthDeviceRow struct {
	AuthDeviceID string
	SID          string
	UserAgent    string
	CreatedAt    time.Time
	LastSeenAt   time.Time
}

// ListActiveAuthDevices returns non-revoked auth_devices for a user (PG SoT).
func (s *Store) ListActiveAuthDevices(ctx context.Context, userID int64) ([]ActiveAuthDeviceRow, error) {
	if s == nil || s.pool == nil || userID <= 0 {
		return nil, errors.New("authpg store unavailable")
	}
	rows, err := s.pool.Query(ctx, `
		SELECT auth_device_id, sid, COALESCE(user_agent, ''), created_at, last_seen_at
		FROM auth_devices
		WHERE user_id = $1 AND revoked_at IS NULL
		ORDER BY last_seen_at DESC NULLS LAST, created_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list auth_devices: %w", err)
	}
	defer rows.Close()
	out := make([]ActiveAuthDeviceRow, 0, 8)
	for rows.Next() {
		var row ActiveAuthDeviceRow
		if err := rows.Scan(&row.AuthDeviceID, &row.SID, &row.UserAgent, &row.CreatedAt, &row.LastSeenAt); err != nil {
			return nil, err
		}
		row.AuthDeviceID = strings.TrimSpace(row.AuthDeviceID)
		row.SID = strings.TrimSpace(row.SID)
		if row.AuthDeviceID == "" {
			continue
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// ListActiveSessionSIDs returns non-revoked session ids for a user (PG SoT read for dual_write revoke/list).
func (s *Store) ListActiveSessionSIDs(ctx context.Context, userID int64) ([]string, error) {
	if s == nil || s.pool == nil || userID <= 0 {
		return nil, errors.New("authpg store unavailable")
	}
	rows, err := s.pool.Query(ctx, `
		SELECT sid FROM auth_sessions
		WHERE user_id = $1 AND revoked_at IS NULL
		ORDER BY last_seen_at DESC NULLS LAST, created_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list auth_sessions: %w", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var sid string
		if err := rows.Scan(&sid); err != nil {
			return nil, err
		}
		sid = strings.TrimSpace(sid)
		if sid != "" {
			out = append(out, sid)
		}
	}
	return out, rows.Err()
}

// ActiveSessionRow is a minimal PG session row for list/revoke when Redis cache is stale.
type ActiveSessionRow struct {
	SID        string
	RefreshJTI string
	IP         string
	UserAgent  string
	CreatedAt  time.Time
	LastSeenAt time.Time
}

// GetActiveSession loads a non-revoked session row by sid.
func (s *Store) GetActiveSession(ctx context.Context, sid string) (*ActiveSessionRow, error) {
	if s == nil || s.pool == nil {
		return nil, errors.New("authpg store unavailable")
	}
	sid = strings.TrimSpace(sid)
	if sid == "" {
		return nil, nil
	}
	var row ActiveSessionRow
	var jti, ip, ua *string
	var createdAt, lastSeenAt time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT sid, refresh_jti, ip::text, user_agent, created_at, last_seen_at
		FROM auth_sessions
		WHERE sid = $1 AND revoked_at IS NULL
	`, sid).Scan(&row.SID, &jti, &ip, &ua, &createdAt, &lastSeenAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get auth_sessions: %w", err)
	}
	if jti != nil {
		row.RefreshJTI = strings.TrimSpace(*jti)
	}
	if ip != nil {
		row.IP = strings.TrimSpace(*ip)
	}
	if ua != nil {
		row.UserAgent = strings.TrimSpace(*ua)
	}
	row.CreatedAt = createdAt
	row.LastSeenAt = lastSeenAt
	return &row, nil
}

// RevokeSession marks session, devices, and refresh tokens revoked and bumps epochs (PG-first revoke).
// Returns the new session_epoch (0 when sid row absent).
func (s *Store) RevokeSession(ctx context.Context, p RevokeSessionParams) (int64, error) {
	if s == nil || s.pool == nil {
		return 0, errors.New("authpg store unavailable")
	}
	sid := strings.TrimSpace(p.SID)
	if sid == "" {
		return 0, nil
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var sessionEpoch int64
	const qSession = `
		UPDATE auth_sessions
		SET revoked_at = COALESCE(revoked_at, NOW()),
		    session_epoch = session_epoch + 1
		WHERE sid = $1
		RETURNING session_epoch
	`
	err = tx.QueryRow(ctx, qSession, sid).Scan(&sessionEpoch)
	if errors.Is(err, pgx.ErrNoRows) {
		sessionEpoch = 0
	} else if err != nil {
		return 0, fmt.Errorf("revoke auth_sessions: %w", err)
	}

	const qDevices = `
		UPDATE auth_devices
		SET revoked_at = COALESCE(revoked_at, NOW()),
		    device_epoch = device_epoch + 1
		WHERE sid = $1
	`
	if _, err := tx.Exec(ctx, qDevices, sid); err != nil {
		return 0, fmt.Errorf("revoke auth_devices: %w", err)
	}

	const qRefresh = `
		UPDATE refresh_tokens
		SET revoked_at = COALESCE(revoked_at, NOW()),
		    session_epoch = session_epoch + 1
		WHERE sid = $1
	`
	if _, err := tx.Exec(ctx, qRefresh, sid); err != nil {
		return 0, fmt.Errorf("revoke refresh_tokens: %w", err)
	}

	if jti := strings.TrimSpace(p.JTI); jti != "" {
		const qJTI = `
			UPDATE refresh_tokens
			SET revoked_at = COALESCE(revoked_at, NOW()),
			    session_epoch = session_epoch + 1
			WHERE jti = $1
		`
		if _, err := tx.Exec(ctx, qJTI, jti); err != nil {
			return 0, fmt.Errorf("revoke refresh jti: %w", err)
		}
	}

	payload := map[string]any{"sid": sid}
	if p.UserID > 0 {
		payload["userId"] = p.UserID
	}
	if err := s.appendEventTx(ctx, tx, p.UserID, sid, "", EventSessionRevoked, payload); err != nil {
		return sessionEpoch, err
	}
	if err := tx.Commit(ctx); err != nil {
		return sessionEpoch, err
	}
	return sessionEpoch, nil
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

// ProofEpochLookup holds epoch counters for proof access token issuance (PEND-SEC-013).
type ProofEpochLookup struct {
	SessionEpoch   int64
	DeviceEpoch    int64
	SessionRevoked bool
	DeviceRevoked  bool
}

// LookupProofEpochs reads session/device epochs from Postgres SoT for proof token exchange.
func (s *Store) LookupProofEpochs(ctx context.Context, sid, authDeviceID string) (ProofEpochLookup, error) {
	if s == nil || s.pool == nil {
		return ProofEpochLookup{}, errors.New("authpg store unavailable")
	}
	sid = strings.TrimSpace(sid)
	authDeviceID = strings.TrimSpace(authDeviceID)
	if sid == "" {
		return ProofEpochLookup{}, errors.New("empty sid")
	}

	var out ProofEpochLookup
	if authDeviceID == "" {
		err := s.pool.QueryRow(ctx, `
			SELECT session_epoch, revoked_at IS NOT NULL
			FROM auth_sessions
			WHERE sid = $1
		`, sid).Scan(&out.SessionEpoch, &out.SessionRevoked)
		if errors.Is(err, pgx.ErrNoRows) {
			return ProofEpochLookup{}, nil
		}
		return out, err
	}

	err := s.pool.QueryRow(ctx, `
		SELECT
			s.session_epoch,
			s.revoked_at IS NOT NULL,
			COALESCE(d.device_epoch, 0),
			COALESCE(d.revoked_at IS NOT NULL, false)
		FROM auth_sessions s
		LEFT JOIN auth_devices d ON d.sid = s.sid AND d.auth_device_id = $2
		WHERE s.sid = $1
	`, sid, authDeviceID).Scan(&out.SessionEpoch, &out.SessionRevoked, &out.DeviceEpoch, &out.DeviceRevoked)
	if errors.Is(err, pgx.ErrNoRows) {
		return ProofEpochLookup{}, nil
	}
	return out, err
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
