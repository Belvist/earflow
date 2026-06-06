CREATE TABLE IF NOT EXISTS subscription_plans (
    id            SERIAL PRIMARY KEY,
    slug          VARCHAR(64) NOT NULL UNIQUE,
    name          VARCHAR(128) NOT NULL,
    price_cents   INTEGER NOT NULL CHECK (price_cents >= 0),
    currency      CHAR(3) NOT NULL DEFAULT 'RUB',
    interval      VARCHAR(16) NOT NULL DEFAULT 'month',
    features      JSONB NOT NULL DEFAULT '{}',
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL,
    plan_id       INTEGER NOT NULL REFERENCES subscription_plans(id),
    status        VARCHAR(32) NOT NULL DEFAULT 'active',
    started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ NOT NULL,
    cancelled_at  TIMESTAMPTZ,
    provider      VARCHAR(32),
    provider_id   VARCHAR(256),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_id ON subscriptions(provider_id) WHERE provider_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_active_user ON subscriptions(user_id) WHERE status = 'active';

INSERT INTO subscription_plans (slug, name, price_cents, currency, interval, features) VALUES
    ('free',      'Free',       0,    'RUB', 'month', '{"max_uploads": 5, "max_playlists": 10, "hq_audio": false, "offline": false}'),
    ('premium',   'Premium',    14900, 'RUB', 'month', '{"max_uploads": 100, "max_playlists": 999, "hq_audio": true, "offline": true}'),
    ('artist_pro','Artist Pro', 29900, 'RUB', 'month', '{"max_uploads": 9999, "max_playlists": 999, "hq_audio": true, "offline": true, "artist_portal": true}')
ON CONFLICT (slug) DO NOTHING;
