# Earflow SPOF Operations Runbook

This file is the operational source for the first SPOF cleanup pass. Do not put
real secrets in this document.

## Critical Runtime Path

| Layer | Runtime dependency | Why critical | Repo source |
| --- | --- | --- | --- |
| Edge | `nginx` | Public HTTP/HTTPS entrypoint | `docker-compose.yml`, `nginx/conf.d/*.conf` |
| UI | `frontend` | Main web app served behind nginx | `docker-compose.yml`, `frontend/nginx.conf` |
| API | `api-gateway` | Public API routing, auth cookies, CSRF, rate limits | `docker-compose.yml`, `backend/go-api-gateway/gateway.yaml` |
| Auth | `auth-service` | Login, refresh, profile session validation | `docker-compose.yml` |
| Data API | `database-service` | Songs, users, catalog reads | `docker-compose.yml`, `backend/database-service` |
| DB | `postgres` | Source of truth for users, songs, playlists, subscriptions | `docker-compose.yml`, `backend/*.sql` |
| Session store | `redis-auth` | Browser session and auth refresh state | `docker-compose.yml` |
| Cache/RL | `redis` | Gateway rate limits, response cache, service caches | `docker-compose.yml` |
| Object storage | `minio` | Audio, covers, EBAP/HLS media artifacts | `docker-compose.yml` |
| Search | `search-service`, `meilisearch` | Search API and index backend | `docker-compose.yml` |
| Media | `direct-stream-service`, `ebap-hls-adapter` | Playback sessions and HLS/direct stream control | `docker-compose.yml` |

## Immediate Secret Hygiene

1. Rotate all values that have ever appeared in terminal output, chat, logs, or repo files.
2. Keep real `.env`, `.env.production`, `k8s/secrets.local.yaml`, backup keys, and certbot material out of Git.
3. Use `.env.example`/secret manager values for templates only.
4. After rotation, restart every service that consumes the changed secret.

Minimum rotation set:

| Secret class | Consumers to restart |
| --- | --- |
| `JWT_SECRET`, JWT issuer/audience related keys | `api-gateway`, `artist-api-gateway`, `auth-service`, `security-service`, services verifying user JWT |
| `SESSION_ENCRYPTION_KEY` | `api-gateway`, `artist-api-gateway` |
| `REDIS_PASSWORD` | `redis`, `redis-auth`, gateways, services using Redis |
| `MINIO_ROOT_PASSWORD` / S3 keys | `minio`, `minio-init`, upload/media/workers using MinIO |
| media URL / HLS / direct-stream secrets | `direct-stream-service`, `ebap-hls-adapter`, EBAP workers |
| service JWT private/public keys and service keys | `database-service`, gateways, services using service tokens |

## Backup And Restore Drill

Run the full P0 drill:

```bash
./scripts/drill-critical-backups.sh
```

Run only one storage drill when needed:

```bash
RUN_MINIO=false ./scripts/drill-critical-backups.sh
RUN_POSTGRES=false ./scripts/drill-critical-backups.sh
```

Postgres backup:

```bash
./scripts/backup-postgres.sh daily
./scripts/backup-postgres.sh verify "$(find ./backups/postgres -type f -name '*.sql.gz*' | sort | tail -1)"
./scripts/drill-postgres-restore.sh
```

Successful drill result:

| Check | Expected |
| --- | --- |
| checksum | passes when `.sha256` exists |
| isolated container | temporary `music-postgres-restore-drill-*` starts |
| restore | `psql -v ON_ERROR_STOP=1` completes |
| schema | `users` and `songs` tables exist |
| data | row counts query succeeds |

MinIO backup:

```bash
./scripts/backup-minio.sh snapshot
./scripts/backup-minio.sh verify "$(find ./backups/minio -type f -name '*.tar.gz' | sort | tail -1)"
./scripts/drill-minio-restore.sh
```

Successful drill result:

| Check | Expected |
| --- | --- |
| checksum | passes when `.sha256` exists |
| archive | `tar -tzf` succeeds |
| isolated container | temporary `music-minio-restore-drill-*` starts |
| restore | every archived bucket is mirrored into isolated MinIO |
| readback | `mc ls --recursive` succeeds for every restored bucket |

## Runtime Verification

| Check | Command | Good result | Bad result means |
| --- | --- | --- | --- |
| public ports | `ss -lntp` | only `:80`, `:443` public; admin/debug ports on `127.0.0.1` | service is exposed outside nginx |
| frontend port | `ss -lntp \| grep 3004` | no public `0.0.0.0:3004` | frontend bypasses nginx |
| compose state | `docker compose ps` | critical services are `running`/healthy | repo/runtime drift or broken dependency |
| init mounts | `docker inspect music-postgres --format '{{json .Mounts}}'` | `00`, `01`, `02`, `03`, `04` init SQL files are mounted | empty restores miss schema |
| subscription API | `curl -sf http://127.0.0.1:8085/api/subscriptions/plans` via internal path/nginx tunnel | JSON plans response | frontend subscription page points to dead route |
| gateway cache | `curl -sD - -o /dev/null https://earflow.ru/api/artists/popular` twice | first `X-Cache: MISS`, second `X-Cache: HIT` | Redis response cache not active |
| cache invalidation | upload/edit then repeat cached route | `X-Cache: MISS` after mutation | stale catalog namespace |
| DB connection budget with PgBouncer | `docker compose -f docker-compose.yml -f docker-compose.pgbouncer.yml config --format json \| node scripts/check-db-connection-budget.js --budget=180` | exits 0 and `TOTAL` is within budget | app pools plus PgBouncer can exhaust Postgres |

## Redis / Redis Auth Minimum

| Dependency | Required now | Later HA step |
| --- | --- | --- |
| `redis` | AOF enabled, maxmemory policy understood, latency/memory alerts | Sentinel or managed Redis |
| `redis-auth` | AOF enabled, `noeviction`, session TTL alerting, memory alerting | Sentinel/managed Redis with session failover test |

Alert on:

| Metric | Alert condition |
| --- | --- |
| `redis_memory_used_bytes / redis_memory_max_bytes` | over 80% for 10 minutes |
| `redis_evicted_keys_total` on `redis-auth` | greater than 0 |
| Redis ping latency | p95 above 50 ms for 5 minutes |
| rejected connections | greater than 0 |

## Gateway Catalog Cache

| Route | Cache profile | Namespace | Invalidation |
| --- | --- | --- | --- |
| `/api/songs*` | `catalog_short` | `catalog` | upload, song edit/delete, likes/dislikes/eq |
| `/api/artists*` | `catalog_short` | `catalog` | artist mutations |
| `/api/albums*` | `catalog_short` | `catalog` | upload/artist mutations |
| `/api/playlists/discover` | `catalog_short` | `catalog` | playlist mutations; gateway cache key includes `X-User-Id`, anonymous requests share only anonymous seed cache |
| `/api/subscriptions/plans` | `catalog_medium` | `subscriptions` | plan admin changes, when implemented |

Expected headers:

| Header | Meaning |
| --- | --- |
| `X-Cache: MISS` | cacheable route, Redis key not found, response may be stored |
| `X-Cache: HIT` | response served from Redis |
| `X-Cache: BYPASS` | route/method/Redis/error/response policy prevents cache use |
