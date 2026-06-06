-- PEND-SEC-011: Postgres SoT for auth sessions, devices, refresh tokens, security events.
-- Apply: psql $DATABASE_URL -f backend/database-service/database/migrations/003_auth_postgres_sot.sql
-- Rollback: see docs/AUTH_POSTGRES_SOT.md § Rollback

BEGIN;

CREATE TABLE IF NOT EXISTS auth_sessions (
    sid              TEXT PRIMARY KEY,
    user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_jti      TEXT,
    session_epoch    BIGINT NOT NULL DEFAULT 1 CHECK (session_epoch >= 1),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at       TIMESTAMPTZ,
    ip               INET,
    user_agent       TEXT,
    CONSTRAINT auth_sessions_sid_len CHECK (char_length(sid) BETWEEN 20 AND 128)
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active
    ON auth_sessions (user_id)
    WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS refresh_tokens (
    jti              TEXT PRIMARY KEY,
    sid              TEXT NOT NULL REFERENCES auth_sessions(sid) ON DELETE CASCADE,
    user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_epoch    BIGINT NOT NULL DEFAULT 1 CHECK (session_epoch >= 1),
    expires_at       TIMESTAMPTZ NOT NULL,
    revoked_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_sid
    ON refresh_tokens (sid);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_active
    ON refresh_tokens (user_id)
    WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_devices (
    auth_device_id   TEXT PRIMARY KEY,
    sid              TEXT NOT NULL REFERENCES auth_sessions(sid) ON DELETE CASCADE,
    user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key_spki  TEXT NOT NULL,
    device_epoch     BIGINT NOT NULL DEFAULT 1 CHECK (device_epoch >= 1),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at       TIMESTAMPTZ,
    user_agent       TEXT,
    CONSTRAINT auth_devices_id_len CHECK (char_length(auth_device_id) BETWEEN 20 AND 128)
);

CREATE INDEX IF NOT EXISTS idx_auth_devices_sid
    ON auth_devices (sid);

CREATE INDEX IF NOT EXISTS idx_auth_devices_user_active
    ON auth_devices (user_id)
    WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS security_events (
    id               BIGSERIAL PRIMARY KEY,
    user_id          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    sid              TEXT,
    auth_device_id   TEXT,
    event_type       TEXT NOT NULL,
    payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_events_user_created
    ON security_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_events_type_created
    ON security_events (event_type, created_at DESC);

COMMENT ON TABLE auth_sessions IS 'SoT browser session (sid). Redis mp:sess is cache; epoch for PEND-SEC-012.';
COMMENT ON TABLE auth_devices IS 'SoT PoP device keys bound to sid.';
COMMENT ON TABLE refresh_tokens IS 'SoT refresh rotation by jti.';
COMMENT ON TABLE security_events IS 'Append-only audit trail (login, revoke, proof failures).';

COMMIT;
