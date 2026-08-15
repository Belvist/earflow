package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/earflow/music-platform/security-service/internal/config"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Postgres struct {
	pool *pgxpool.Pool
}

func NewPostgres(ctx context.Context, cfg config.PostgresConfig) (*Postgres, error) {
	pgxCfg, err := pgxpool.ParseConfig(cfg.DSN())
	if err != nil {
		return nil, fmt.Errorf("parse db config: %w", err)
	}
	if pgxCfg.MaxConns <= 0 {
		pgxCfg.MaxConns = cfg.MaxConns
	}
	if pgxCfg.MinConns < 0 {
		pgxCfg.MinConns = cfg.MinConns
	}
	pgxCfg.ConnConfig.ConnectTimeout = cfg.ConnectTimeout
	pgxCfg.HealthCheckPeriod = 30 * time.Second

	pool, err := pgxpool.NewWithConfig(ctx, pgxCfg)
	if err != nil {
		return nil, fmt.Errorf("db connect: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, cfg.ConnectTimeout+time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("db ping: %w", err)
	}

	return &Postgres{pool: pool}, nil
}

func (p *Postgres) Close() {
	if p != nil && p.pool != nil {
		p.pool.Close()
	}
}

func (p *Postgres) Pool() *pgxpool.Pool {
	return p.pool
}

func (p *Postgres) Ping(ctx context.Context) error {
	return p.pool.Ping(ctx)
}

// User represents the subset of the users table needed by security-service.
// Fields are pointers where NULL is expected to distinguish unset values.
type User struct {
	ID                  int64
	Username            string
	Salt                string
	PasswordHash        *string
	MFAEnabled          bool
	MFAEnabledAt        *time.Time
	MFASecretEncrypted  *string
	MFARecoveryCodes    *string
	TelegramID          *int64
	EmailEncrypted      *string
	EmailCleartext      *string
}

// ErrUserNotFound is returned when the user row is missing.
var ErrUserNotFound = errors.New("user not found")

// GetUserByID loads the user record by primary key.
func (p *Postgres) GetUserByID(ctx context.Context, id int64) (*User, error) {
	const q = `
		SELECT
			id,
			COALESCE(username, ''),
			COALESCE(salt, ''),
			password_hash,
			COALESCE(mfa_enabled, FALSE),
			mfa_enabled_at,
			mfa_secret_encrypted,
			mfa_recovery_codes,
			telegram_id,
			email_encrypted,
			email
		FROM users
		WHERE id = $1
	`
	row := p.pool.QueryRow(ctx, q, id)

	var (
		u               User
		pwHash          *string
		mfaSecretEnc    *string
		recoveryCodes   *string
		telegramID      *int64
		emailEnc        *string
		emailClear      *string
		mfaEnabledAt    *time.Time
	)

	if err := row.Scan(
		&u.ID,
		&u.Username,
		&u.Salt,
		&pwHash,
		&u.MFAEnabled,
		&mfaEnabledAt,
		&mfaSecretEnc,
		&recoveryCodes,
		&telegramID,
		&emailEnc,
		&emailClear,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("get user by id: %w", err)
	}

	u.PasswordHash = pwHash
	u.MFAEnabledAt = mfaEnabledAt
	u.MFASecretEncrypted = mfaSecretEnc
	u.MFARecoveryCodes = recoveryCodes
	u.TelegramID = telegramID
	u.EmailEncrypted = emailEnc
	u.EmailCleartext = emailClear

	return &u, nil
}

// UpdatePasswordHash writes the new password hash for the user.
func (p *Postgres) UpdatePasswordHash(ctx context.Context, userID int64, newHash string) error {
	const q = `UPDATE users SET password_hash = $2 WHERE id = $1`
	tag, err := p.pool.Exec(ctx, q, userID, newHash)
	if err != nil {
		return fmt.Errorf("update password_hash: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrUserNotFound
	}
	return nil
}

// ClearTelegramID sets telegram_id = NULL for the user.
func (p *Postgres) ClearTelegramID(ctx context.Context, userID int64) error {
	const q = `UPDATE users SET telegram_id = NULL WHERE id = $1`
	tag, err := p.pool.Exec(ctx, q, userID)
	if err != nil {
		return fmt.Errorf("clear telegram_id: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrUserNotFound
	}
	return nil
}

// UpdateMFARecoveryCodes replaces the stored recovery code hashes.
func (p *Postgres) UpdateMFARecoveryCodes(ctx context.Context, userID int64, payload string) error {
	const q = `UPDATE users SET mfa_recovery_codes = $2 WHERE id = $1`
	tag, err := p.pool.Exec(ctx, q, userID, payload)
	if err != nil {
		return fmt.Errorf("update mfa_recovery_codes: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrUserNotFound
	}
	return nil
}

// UpdateUserParams holds optional MFA-related columns; only non-nil pointers
// are written. MFAEnabledFalse / MFASecretNull / MFAEnabledAtNull clear columns.
type UpdateUserParams struct {
	MFAEnabled            *bool
	MFAEnabledAt          *time.Time
	MFAEnabledAtNull      bool
	MFASecretEncrypted    *string
	MFASecretNull         bool
	MFARecoveryCodes      *string
	MFARecoveryCodesNull  bool
}

// UpdateUser applies the provided MFA-field updates to a user row.
func (p *Postgres) UpdateUser(ctx context.Context, id int64, params UpdateUserParams) error {
	updates := []string{}
	args := []any{}
	i := 1

	addField := func(col string, val any) {
		updates = append(updates, fmt.Sprintf("%s = $%d", col, i))
		args = append(args, val)
		i++
	}

	if params.MFAEnabled != nil {
		addField("mfa_enabled", *params.MFAEnabled)
	}
	if params.MFAEnabledAt != nil {
		addField("mfa_enabled_at", *params.MFAEnabledAt)
	}
	if params.MFAEnabledAtNull {
		addField("mfa_enabled_at", nil)
	}
	if params.MFASecretEncrypted != nil {
		addField("mfa_secret_encrypted", *params.MFASecretEncrypted)
	}
	if params.MFASecretNull {
		addField("mfa_secret_encrypted", nil)
	}
	if params.MFARecoveryCodes != nil {
		addField("mfa_recovery_codes", *params.MFARecoveryCodes)
	}
	if params.MFARecoveryCodesNull {
		addField("mfa_recovery_codes", nil)
	}

	if len(updates) == 0 {
		return nil
	}

	args = append(args, id)
	q := "UPDATE users SET " + joinUpdates(updates) + fmt.Sprintf(" WHERE id = $%d", i)
	tag, err := p.pool.Exec(ctx, q, args...)
	if err != nil {
		return fmt.Errorf("update user: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrUserNotFound
	}
	return nil
}

func joinUpdates(cols []string) string {
	out := ""
	for idx, c := range cols {
		if idx > 0 {
			out += ", "
		}
		out += c
	}
	return out
}

// HasPassword returns whether the stored password_hash is present and non-empty.
func (u *User) HasPassword() bool {
	if u == nil || u.PasswordHash == nil {
		return false
	}
	return len(*u.PasswordHash) > 0
}

// HasTelegram returns whether telegram_id is present and non-zero.
func (u *User) HasTelegram() bool {
	if u == nil || u.TelegramID == nil {
		return false
	}
	return *u.TelegramID != 0
}
