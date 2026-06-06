# PEND-SEC-011 — Postgres SoT for auth (sessions / devices / refresh / events)

**Status:** prepared / code-ready — **not closed** until VPS rollout + checklist below

## Pre-acceptance review (strict)

| # | Question | Verdict (current code) |
|---|----------|------------------------|
| 1 | Migration idempotent? | **Yes** — `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` |
| 2 | Unique indexes? | **Yes** — PK on `sid`, `jti`, `auth_device_id`; partial indexes on active rows |
| 3 | No plain sid/jti in Postgres? | **No — blocker for strict hash-only policy** — see below |
| 4 | sid/jti stored as hash/HMAC? | **No** — stored as opaque lookup keys (same role as Redis keys today) |
| 5 | Internal API only `X-Service-Token`? | **Yes** — `ServiceKeyMiddleware` |
| 6 | Not exposed via public nginx? | **Yes** — security-service `expose:3074` only; no nginx route to `/internal/*` |
| 7 | PG fail on login → no break? | **Yes** — `UpsertSession` best-effort, `Warn` log; **no metric yet** |
| 8 | Revoke: Redis always cleaned? | **Yes (fixed)** — PG attempt, then **always** local Redis; Redis error wins |
| 9 | Backfill idempotent? | **Yes** — `ON CONFLICT DO UPDATE`; dry-run: `AUTH_PG_BACKFILL_DRY_RUN=1` |
| 10 | Rollback `AUTH_PG_SOT_MODE=off`? | **Yes** — instant revert to Redis-only |

### sid/jti in Postgres (decision)

| Variant | Policy | Status |
|---------|--------|--------|
| **A** | Raw opaque `sid` / `jti` / `auth_device_id` as PK (lookup + FK), same role as Redis keys; refresh JWT **not** in PG | **Accepted for VPS/staging rollout** (PEND-SEC-011) |
| **B** | `sid_hmac` / `jti_hmac` only at rest; drop raw columns | **Not in 011** — required before strict security sign-off / final prod if hash-only mandated |

SoT rows are high-entropy identifiers — **not** passwords. Compromise is documented; not a blocker to enable `dual_write` on VPS.

### Revoke fail-safe (critical)

```text
dual_write revoke:
  1. Try security internal (PG + Redis in security-service)
  2. Gateway ALWAYS runs local RevokeSessionFull on redis-auth
  3. Return Redis error if cleanup failed; else may return PG error (user already logged out in cache)
```

Logout must not leave `mp:sess` alive when security-service is down.  
**Blocked consumers:** PEND-SEC-012 (epoch pub/sub), PEND-SEC-013 (Proof Access Token)  
**Related:** `docs/AUTH_TARGET_ARCHITECTURE.md` §4–5, `docs/SECURITY_ROADMAP.md` §3

---

## Ownership

| Layer | Owner | Role |
|-------|--------|------|
| Postgres DDL | `database-service/database/migrations/003_auth_postgres_sot.sql` | apply via psql / deploy pipeline |
| PG repository | `security-service/internal/store/authpg/` | parameterized SQL only |
| Revoke orchestration | `security-service` `RevokeSessionFull` | **PG first**, then Redis (when enabled) |
| Login / device register dual-write | `go-api-gateway` → internal security API | phase 1b (after revoke path stable) |
| Hot API reads | `go-api-gateway` | **Redis cache only** — no PG SELECT per request |

---

## Schema (summary)

| Table | PK | Purpose |
|-------|-----|---------|
| `auth_sessions` | `sid` | Session SoT + `session_epoch` |
| `refresh_tokens` | `jti` | Refresh rotation SoT |
| `auth_devices` | `auth_device_id` | PoP device SoT + `device_epoch` |
| `security_events` | `id` | Append-only audit |

Migration file: `backend/database-service/database/migrations/003_auth_postgres_sot.sql`

---

## Rollout modes (`AUTH_PG_SOT_MODE`)

| Mode | PG writes | PG reads on API hot path | Redis |
|------|-----------|---------------------------|-------|
| `off` (default) | none | none | SoT (current prod) |
| `dual_write` | revoke + upsert on login/register | none | cache + legacy SoT |
| `pg_read` | dual_write | session list from PG, cache fill | cache |
| `pg_only` | all | controlled reads | cache optional |

**Forbidden:** `pg_read` / hot handlers doing `SELECT` on every authenticated `/api/*` request.

---

## Dual-write sequence

### Login / device register (phase 1b)

```text
1. Existing: auth-service tokens + gateway Redis session (unchanged)
2. Async or sync: POST security-service /internal/auth/v1/sessions/upsert (service token)
3. On PG failure: log + metric; do not fail login (until pg_only mode)
```

### Revoke (`RevokeSessionFull`) — implemented first

```text
1. BEGIN PG: bump session_epoch, revoke session + devices + refresh rows for sid
2. INSERT security_events (session_revoked)
3. COMMIT PG
4. Existing Redis RevokeSessionFull (best-effort, same as today)
5. On PG failure: fail revoke (fail secure)
```

---

## Backfill from Redis (manual / job)

Not run automatically in phase 1. Plan:

1. Deploy migration with `AUTH_PG_SOT_MODE=off`
2. Run one-off job: scan `auth:user_sids:*`, `auth:session:meta:*`, `auth:device:*` → upsert PG
3. Enable `dual_write`, monitor drift
4. Later: `pg_read` for security UI session list

Rollback: set `AUTH_PG_SOT_MODE=off`; Redis remains authoritative until re-backfill.

---

## Rollback

```sql
-- Only if no production dependency on PG SoT yet:
DROP TABLE IF EXISTS security_events;
DROP TABLE IF EXISTS auth_devices;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS auth_sessions;
```

Safer ops rollback: `AUTH_PG_SOT_MODE=off` without dropping tables.

---

## Hot path rules (mandatory)

| Path | Postgres |
|------|----------|
| `GET /api/profile`, catalog, stream metadata | **never** |
| PoP verify / proof nonce | Redis only (until PEND-SEC-013) |
| `GET /api/auth/sessions` | PG allowed in `pg_read`+ (security-service) |
| Login / register / revoke / device register | write-only dual-write |

---

## Tests

| Test | Location |
|------|----------|
| Revoke PG bumps epoch + sets `revoked_at` | `security-service/internal/store/authpg/store_test.go` (integration, `DATABASE_URL`) |
| Revoke contract Redis unchanged | existing `session_revoke_test.go` |
| Mode `off` skips PG | unit |

Server/CI: apply migration on staging Postgres before enabling `dual_write`.

---

## Internal API (gateway → security-service)

Requires `SERVICE_KEY_API_GATEWAY` on both services. Header: `X-Service-Token`.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/internal/auth/v1/sessions/upsert` | Login dual-write (PG only) |
| POST | `/internal/auth/v1/devices/upsert` | Device register dual-write |
| POST | `/internal/auth/v1/sessions/revoke` | PG-first + Redis revoke |

Gateway hooks: `handleAuthExchange`, `handleDeviceRegister`, `RevokeSessionFull` when `AUTH_PG_SOT_MODE=dual_write`.

## Server rollout

```bash
# 1. Migration
psql "$DATABASE_URL" -f backend/database-service/database/migrations/003_auth_postgres_sot.sql

# 2. Backfill (AUTH_PG_SOT_MODE=off)
bash scripts/backfill-auth-pg-sot.sh

# 3. Enable dual-write on api-gateway + security-service, recreate containers
# AUTH_PG_SOT_MODE=dual_write

# 4. Re-run PEND-SEC-001 e2e + spot-check revoke in UI
```

## Next steps (011 remaining)

- [ ] Metrics: `auth_pg_sot_write_total`, `auth_pg_sot_write_errors_total`
- [ ] `pg_read` for session list from Postgres
- [ ] PEND-SEC-012 epoch pub/sub on top of PG epochs
