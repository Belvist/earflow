package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/earflow/music-platform/auth-core/internal/config"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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

func (p *Postgres) Ping(ctx context.Context) error {
	return p.pool.Ping(ctx)
}

// AuthUser is the full auth-relevant view of a users row, mirroring the column
// set the Node auth-service reads through database-service.
type AuthUser struct {
	ID               int64
	Email            *string
	EmailHash        *string
	Username         string
	PasswordHash     *string
	PhotoURL         *string
	IsAdmin          bool
	CreatedAt        *time.Time
	LastLogin        *time.Time
	Salt             *string
	EmailEncrypted   *string
	Metadata         *string
	TelegramID       *int64
	MFAEnabled       bool
	MFAEnabledAt     *time.Time
	MFARecoveryCodes *string
}

// ErrUserNotFound is returned when the user row is missing.
var ErrUserNotFound = errors.New("user not found")

// ErrUserConflict is returned on a unique-violation insert (duplicate email_hash).
var ErrUserConflict = errors.New("user already exists")

const authUserSelect = `
	id,
	email,
	email_hash,
	username,
	photo_url,
	COALESCE(is_admin, FALSE),
	created_at,
	last_login,
	salt,
	email_encrypted,
	metadata,
	telegram_id,
	COALESCE(mfa_enabled, FALSE),
	mfa_enabled_at,
	mfa_recovery_codes
`

func scanAuthUser(row pgx.Row) (*AuthUser, error) {
	var (
		u             AuthUser
		email         *string
		emailHash     *string
		photoURL      *string
		createdAt     *time.Time
		lastLogin     *time.Time
		salt          *string
		emailEnc      *string
		metadata      *string
		telegramID    *int64
		mfaEnabledAt  *time.Time
		recoveryCodes *string
	)
	if err := row.Scan(
		&u.ID,
		&email,
		&emailHash,
		&u.Username,
		&photoURL,
		&u.IsAdmin,
		&createdAt,
		&lastLogin,
		&salt,
		&emailEnc,
		&metadata,
		&telegramID,
		&u.MFAEnabled,
		&mfaEnabledAt,
		&recoveryCodes,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	u.Email = email
	u.EmailHash = emailHash
	u.PhotoURL = photoURL
	u.CreatedAt = createdAt
	u.LastLogin = lastLogin
	u.Salt = salt
	u.EmailEncrypted = emailEnc
	u.Metadata = metadata
	u.TelegramID = telegramID
	u.MFAEnabledAt = mfaEnabledAt
	u.MFARecoveryCodes = recoveryCodes
	return &u, nil
}

// GetUserByID loads the auth view of a user by primary key.
func (p *Postgres) GetUserByID(ctx context.Context, id int64) (*AuthUser, error) {
	q := "SELECT " + authUserSelect + " FROM users WHERE id = $1"
	row := p.pool.QueryRow(ctx, q, id)
	return scanAuthUser(row)
}

// GetUserByTelegram loads a user by telegram_id.
func (p *Postgres) GetUserByTelegram(ctx context.Context, telegramID int64) (*AuthUser, error) {
	q := "SELECT " + authUserSelect + " FROM users WHERE telegram_id = $1"
	row := p.pool.QueryRow(ctx, q, telegramID)
	return scanAuthUser(row)
}

// GetUserByEmailOrHash loads a user by a 64-char hex email_hash (lookup by
// hash or the plaintext email), otherwise by a case-insensitive plaintext email.
func (p *Postgres) GetUserByEmailOrHash(ctx context.Context, raw string) (*AuthUser, error) {
	isHash := len(raw) == 64
	for i := 0; i < len(raw); i++ {
		c := raw[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			isHash = false
			break
		}
	}
	var q string
	if isHash {
		q = "SELECT " + authUserSelect + " FROM users WHERE email_hash = $1 OR email = $1"
	} else {
		q = "SELECT " + authUserSelect + " FROM users WHERE lower(email) = lower($1)"
	}
	row := p.pool.QueryRow(ctx, q, raw)
	return scanAuthUser(row)
}

// CreateUser inserts a new user and returns the created auth view subset.
// Matches database-service POST /api/users column set.
func (p *Postgres) CreateUser(ctx context.Context, params CreateUserParams) (*AuthUser, error) {
	q := `
		INSERT INTO users (email, email_hash, password_hash, username, first_name, last_name, photo_url, email_encrypted, salt, metadata, telegram_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id, email, email_hash, username, photo_url, COALESCE(is_admin, FALSE), created_at, last_login, salt, email_encrypted, metadata, telegram_id, COALESCE(mfa_enabled, FALSE), mfa_enabled_at, mfa_recovery_codes
	`
	row := p.pool.QueryRow(ctx, q,
		params.Email,
		params.EmailHash,
		params.PasswordHash,
		params.Username,
		params.FirstName,
		params.LastName,
		params.PhotoURL,
		params.EmailEncrypted,
		params.Salt,
		params.Metadata,
		params.TelegramID,
	)
	user, scanErr := scanAuthUser(row)
	if scanErr != nil {
		var pgErr *pgconn.PgError
		if errors.As(scanErr, &pgErr) && pgErr.Code == "23505" {
			return nil, ErrUserConflict
		}
		return nil, scanErr
	}
	return user, nil
}

type CreateUserParams struct {
	Email          *string
	EmailHash      *string
	PasswordHash   *string
	Username       string
	FirstName      *string
	LastName       *string
	PhotoURL       *string
	EmailEncrypted *string
	Salt           *string
	Metadata       *string
	TelegramID     *int64
}

// UpdateUser applies the provided auth-field updates to a user. Any column with
// a non-nil pointer is written. Matches database-service PUT /api/users/:id.
func (p *Postgres) UpdateUser(ctx context.Context, id int64, params UpdateUserParams) error {
	updates := []string{}
	args := []any{}
	i := 1

	addField := func(col string, val any) {
		updates = append(updates, fmt.Sprintf("%s = $%d", col, i))
		args = append(args, val)
		i++
	}

	if params.LastLogin != nil {
		addField("last_login", *params.LastLogin)
	}
	if params.PasswordHash != nil {
		addField("password_hash", *params.PasswordHash)
	}
	if params.Metadata != nil {
		addField("metadata", *params.Metadata)
	}
	if params.TelegramID != nil {
		addField("telegram_id", *params.TelegramID)
	}
	if params.MFAEnabled != nil {
		addField("mfa_enabled", *params.MFAEnabled)
	}
	if params.MFASecretEncrypted != nil {
		addField("mfa_secret_encrypted", *params.MFASecretEncrypted)
	}
	if params.MFARecoveryCodes != nil {
		addField("mfa_recovery_codes", *params.MFARecoveryCodes)
	}
	if params.MFAEnabledAt != nil {
		addField("mfa_enabled_at", *params.MFAEnabledAt)
	}
	if params.Email != nil {
		addField("email", *params.Email)
	}
	if params.EmailHash != nil {
		addField("email_hash", *params.EmailHash)
	}
	if params.EmailEncrypted != nil {
		addField("email_encrypted", *params.EmailEncrypted)
	}
	if params.EmailEncryptedNull {
		addField("email_encrypted", nil)
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

type UpdateUserParams struct {
	LastLogin          *time.Time
	PasswordHash       *string
	Metadata           *string
	TelegramID         *int64
	MFAEnabled         *bool
	MFASecretEncrypted *string
	MFARecoveryCodes   *string
	MFAEnabledAt       *time.Time
	Email              *string
	EmailHash          *string
	EmailEncrypted     *string
	EmailEncryptedNull bool
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
