import postgres from 'postgres';
import { createMetrics, metricsResponse, routeName } from './metrics';

function buildDatabaseUrl(): string {
    if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

    const host = process.env.DB_HOST || 'postgres';
    const port = process.env.DB_PORT || '5432';
    const name = process.env.DB_NAME || process.env.POSTGRES_DB || 'music_platform';
    const user = process.env.DB_USER || process.env.POSTGRES_USER || 'music_user';
    const password = process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || '';
    return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(name)}`;
}

function parseIntEnv(name: string, fallback: number, min: number, max: number): number {
    const raw = process.env[name];
    const value = Number.parseInt(String(raw ?? ''), 10);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
}

function parseBoolEnv(name: string, fallback: boolean): boolean {
    const raw = process.env[name];
    if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

const DATABASE_URL = buildDatabaseUrl();
const PORT = parseInt(process.env.PORT || '3010', 10);
const metrics = createMetrics();

const sql = postgres(DATABASE_URL, {
    max: parseIntEnv('DB_MAX_CONNECTIONS', 5, 1, 100),
    idle_timeout: parseIntEnv('DB_IDLE_TIMEOUT_SECONDS', 30, 1, 300),
    connect_timeout: parseIntEnv('DB_CONNECTION_TIMEOUT_SECONDS', 5, 1, 60),
    prepare: parseBoolEnv('DB_PREPARE', true),
});

function json(status: number, data: unknown, headers?: Record<string, string>): Response {
    const h = new Headers(headers);
    if (!h.has('content-type')) h.set('content-type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(data), { status, headers: h });
}

function readUserId(req: Request): number | null {
    const hdr = req.headers.get('x-user-id');
    if (!hdr) return null;
    const n = parseInt(hdr, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

async function getActiveSubscription(userId: number) {
    const rows = await sql`
        SELECT s.id, s.plan_id, s.status, s.started_at, s.expires_at, s.cancelled_at, s.provider, s.provider_id,
               p.slug as plan_slug, p.name as plan_name, p.price_cents, p.currency, p.interval, p.features
        FROM subscriptions s
        JOIN subscription_plans p ON p.id = s.plan_id
        WHERE s.user_id = ${userId} AND s.status = 'active' AND s.expires_at > NOW()
        ORDER BY s.expires_at DESC
        LIMIT 1
    `;
    return rows[0] || null;
}

async function getPlans() {
    return sql`SELECT id, slug, name, price_cents, currency, interval, features FROM subscription_plans WHERE is_active = TRUE ORDER BY price_cents ASC`;
}

async function createSubscription(userId: number, planSlug: string, provider?: string, providerId?: string) {
    const planRows = await sql`SELECT id, interval FROM subscription_plans WHERE slug = ${planSlug} AND is_active = TRUE`;
    if (!planRows.length) return null;
    const plan = planRows[0];

    const intervalMs: Record<string, number> = { month: 30, year: 365 };
    const days = intervalMs[plan.interval] || 30;

    const result = await sql`
        INSERT INTO subscriptions (user_id, plan_id, status, expires_at, provider, provider_id)
        VALUES (${userId}, ${plan.id}, 'active', NOW() + INTERVAL '${days} days', ${provider || null}, ${providerId || null})
        ON CONFLICT (user_id) WHERE status = 'active'
        DO UPDATE SET plan_id = ${plan.id}, expires_at = NOW() + INTERVAL '${days} days', provider = ${provider || null}, provider_id = ${providerId || null}, updated_at = NOW()
        RETURNING id, plan_id, status, started_at, expires_at
    `;
    return result[0] || null;
}

async function cancelSubscription(userId: number) {
    const result = await sql`
        UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
        WHERE user_id = ${userId} AND status = 'active'
        RETURNING id
    `;
    return result.length > 0;
}

const server = Bun.serve({
    port: PORT,
    async fetch(req) {
        const startedAt = performance.now();
        let route = 'unknown';
        let status = 500;
        try {
            const response = await (async () => {
                const url = new URL(req.url);
                route = routeName(url.pathname);

                if (req.method === 'OPTIONS') {
                    return new Response(null, {
                        status: 204,
                        headers: {
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
                            'Access-Control-Allow-Headers': 'Content-Type, X-User-Id',
                            'Access-Control-Max-Age': '86400',
                        },
                    });
                }

                if (req.method === 'GET' && url.pathname === '/health') {
                    return json(200, { status: 'ok' });
                }

                if (req.method === 'GET' && url.pathname === '/metrics') {
                    return metricsResponse(metrics);
                }

                if (req.method === 'GET' && url.pathname === '/api/subscriptions/plans') {
                    const plans = await getPlans();
                    return json(200, { plans });
                }

                if (req.method === 'GET' && url.pathname === '/api/subscriptions/me') {
                    const userId = readUserId(req);
                    if (!userId) return json(401, { error: 'Authentication required' });
                    const sub = await getActiveSubscription(userId);
                    if (!sub) {
                        return json(200, { subscription: null, plan: { slug: 'free', name: 'Free', features: { max_uploads: 5, max_playlists: 10, hq_audio: false, offline: false } } });
                    }
                    return json(200, {
                        subscription: {
                            id: sub.id,
                            status: sub.status,
                            startedAt: sub.started_at,
                            expiresAt: sub.expires_at,
                            cancelledAt: sub.cancelled_at,
                            provider: sub.provider,
                        },
                        plan: {
                            slug: sub.plan_slug,
                            name: sub.plan_name,
                            priceCents: sub.price_cents,
                            currency: sub.currency,
                            interval: sub.interval,
                            features: sub.features,
                        },
                    });
                }

                if (req.method === 'POST' && url.pathname === '/api/subscriptions/subscribe') {
                    const userId = readUserId(req);
                    if (!userId) return json(401, { error: 'Authentication required' });

                    let body: any = {};
                    try { body = await req.json(); } catch { }
                    const planSlug = String(body.planSlug || '').trim();
                    if (!planSlug) return json(400, { error: 'planSlug required' });

                    const sub = await createSubscription(userId, planSlug, body.provider, body.providerId);
                    if (!sub) return json(400, { error: 'Invalid plan' });

                    return json(200, { subscription: sub });
                }

                if (req.method === 'POST' && url.pathname === '/api/subscriptions/cancel') {
                    const userId = readUserId(req);
                    if (!userId) return json(401, { error: 'Authentication required' });
                    const ok = await cancelSubscription(userId);
                    return json(200, { cancelled: ok });
                }

                return json(404, { error: 'Not found' });
            })();
            status = response.status;
            return response;
        } catch {
            status = 500;
            return json(500, { error: 'Internal error' });
        } finally {
            metrics.recordHttp({
                method: req.method,
                route,
                status,
                durationSeconds: Math.max(0, performance.now() - startedAt) / 1000,
            });
        }
    },
});

console.log(`subscription-service listening on :${PORT}`);

process.on('SIGTERM', () => { try { sql.end(); } catch { } process.exit(0); });
