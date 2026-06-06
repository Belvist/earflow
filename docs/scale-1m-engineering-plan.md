# Earflow Scale-to-1M Engineering Plan

This document is based on repository files only. It does not claim current
server runtime state unless the command is listed under verification.

## Load Model

`1M users` must be treated as a product-size goal, not as `1M concurrent`.
Until real analytics exist, use this planning model:

| Metric | Planning value | Why |
| --- | ---: | --- |
| Registered users | 1,000,000 | Product target |
| DAU | 50,000 to 150,000 | 5-15 percent of registered users |
| Concurrent web/API users | 5,000 to 30,000 | 10-20 percent of DAU during peaks |
| Concurrent listeners | 2,000 to 20,000 | Depends on media offload and object-storage throughput |
| API RPS | 1,000 to 10,000 | Depends on cache hit rate and polling |
| Media bandwidth | dominant cost | Audio/HLS must not be served from app CPU at scale |

## Verified Repo Facts

| Area | Fact | Source |
| --- | --- | --- |
| Compose services | 41 services are defined by `docker compose config --format json`. | `docker-compose.yml` |
| Fixed container names | All listed services except `api-gateway` currently have `container_name`; this blocks `docker compose up --scale service=N`. | `docker-compose.yml` |
| Gateway scaling | `api-gateway` has no `container_name` and has `deploy.replicas: ${API_GATEWAY_REPLICAS:-2}`. | `docker-compose.yml` |
| Edge | Public traffic enters through `nginx` on ports `80` and `443`. | `docker-compose.yml`, `nginx/nginx.conf` |
| Nginx upstreams | Nginx proxies to Docker DNS service names such as `api-gateway:3000`, `frontend:3004`, `artist-api-gateway:3000`. | `nginx/conf.d/60-upstreams.conf` |
| Nginx limits | Nginx has per-IP zones: `api_limit=100r/s`, `auth_limit=10r/s`, `upload_limit=5r/s`, `hls_limit=30r/s`, `media_limit=20r/s`. | `nginx/conf.d/70-rate-limits.conf` |
| Gateway routes | Main public API routing is table-driven. | `backend/go-api-gateway/gateway.yaml` |
| Artist gateway routes | Artist routes use a separate gateway table. | `backend/go-api-gateway/gateway.artist.yaml` |
| Gateway response cache | Redis response cache exists with `X-Cache: HIT/MISS/BYPASS`; TTL profiles are `catalog_short=60s`, `catalog_medium=5m`, `catalog_long=15m`. | `backend/go-api-gateway/internal/proxy/response_cache.go` |
| Cache invalidation | Gateway invalidates cache namespaces only after unsafe successful methods. | `backend/go-api-gateway/internal/proxy/reverse_proxy.go` |
| Stateful SPOF | `postgres`, `redis`, `redis-auth`, `minio`, `meilisearch`, `nats`, `nginx` are single services in compose. | `docker-compose.yml` |
| Postgres pools | Main Postgres HTTP clients now expose env-driven pool limits instead of hardcoded max connections. | `backend/database-service/database/db.js`, `backend/upload-service/lib/db/pool.js`, `backend/artist-service/lib/db/pool.js`, `backend/playlist-service/lib/database.js`, `backend/lyrics-service/lib/database.js`, `backend/subscription-service/src/server.ts`, `backend/direct-stream-service/src/db/songs.ts`, `docker-compose.yml` |
| PgBouncer layer | Optional compose overlay adds `pgbouncer` and routes high-value HTTP DB clients through it with smaller per-replica pools. | `docker-compose.pgbouncer.yml`, `infra/pgbouncer/Dockerfile`, `infra/pgbouncer/docker-entrypoint.sh` |
| Search | `search-service` uses Meilisearch plus Postgres outbox/indexer; `SEARCH_BACKFILL_ON_START` defaults true in compose. | `backend/search-service/internal/config/config.go`, `backend/search-service/internal/indexer/indexer.go`, `docker-compose.yml` |
| Recommendations | Recommendation service uses Postgres, Redis, Redis Streams, in-memory track cache, and ranking-service. | `backend/recommendations-service/config/index.js`, `backend/recommendations-service/lib/database.js`, `backend/recommendations-service/lib/redis.js` |
| Media | Direct streaming reads Postgres, Redis optional cache, and MinIO/S3. | `backend/direct-stream-service/src/main.ts`, `backend/direct-stream-service/src/config.ts` |
| EBAP status | `backend/ebap-streaming-service` is legacy EBAP v3 code and is not in current compose; live EBAP services are `ebap-hls-adapter`, `ebap-encoder-worker`, and `ebap-hls-packager-worker`. | `docker-compose.yml`, `nginx/nginx.conf`, `backend/ebap-streaming-service/*` |
| Upload | Upload storage is MinIO-only by config path, but compose still mounts local upload paths. | `backend/upload-service/lib/storage.js`, `docker-compose.yml` |
| Monitoring | Prometheus targets are mostly static service names; replicas are not explicitly discovered per-container. | `monitoring/prometheus/prometheus.yml` |
| K8s manifests | K8s folder is partial/stale and does not represent the full current service map. | `k8s/README.md`, `k8s/*.yaml` |

## Main Blockers To "Just Add Containers"

| Blocker | Why it blocks scale | Required fix |
| --- | --- | --- |
| Fixed `container_name` | Docker Compose refuses multiple replicas when a service has a fixed container name. | Remove/generate without `container_name` for stateless services. |
| Single Postgres | App replicas multiply DB connections and writes still hit one primary. | PgBouncer first, then read replicas/HA primary. |
| No DB pool budget | Current defaults can exceed Postgres connections quickly: e.g. 10 app replicas x 30-50 pool each. | Centralize per-service `DB_MAX_CONNECTIONS`, add PgBouncer, enforce max connection budget. |
| Single Redis/redis-auth | Sessions, cache, rate limits, device/party/reco state depend on one Redis process. | Persistence/alerts now, Sentinel/managed Redis next. |
| Single MinIO | Audio/covers/HLS are product core; one MinIO is media SPOF. | Backup drill now, distributed MinIO/S3-compatible external storage next. |
| Single Meili | Search-service replicas still depend on one search index. | Meili HA or managed search; split indexer from query serving. |
| Search startup work | Scaling search-service can trigger repeated startup backfill/index setup if unguarded. | Guard setup/backfill with Postgres advisory locks; keep full split into query/indexer roles as P2. |
| Static Prometheus targets | Metrics can hide per-replica failures. | Docker service discovery or cAdvisor-derived dashboards per container. |
| Single nginx | One edge container owns public ports. | External LB or multiple edge nodes with VRRP/cloud LB. |
| Media on app path | App/MinIO can become bandwidth bottleneck. | Object-storage optimization and internal media edge/cache for covers/audio/HLS segments. |

## Implemented P0 Repo Change

| Change | Files | Purpose |
| --- | --- | --- |
| Scalable compose renderer | `scripts/render-scalable-compose.js`, `scripts/render-scalable-compose.sh`, `scripts/render-scalable-compose.ps1` | Generates a compose JSON from current config and removes `container_name` only for scalable stateless services. |
| Stateless scaling wrapper | `scripts/scale-stateless.sh`, `scripts/scale-stateless.ps1` | Runs the generated compose with `--scale service=N`; refuses stateful/edge services. |
| Gateway scaling wrapper | `scripts/scale-gateway.sh`, `scripts/scale-gateway.ps1` | Delegates to stateless scaling and checks health through nginx instead of the non-published `localhost:3000`. |
| Search startup lock | `backend/search-service/internal/indexer/indexer.go` | Prevents duplicate Meili settings/backfill startup work when `search-service` has multiple replicas. |
| Ranking healthcheck | `backend/ranking-service/cmd/ranking-service/main.go`, `docker-compose.yml` | Distroless ranking image can now healthcheck itself with `/ranking-service --healthcheck`. |
| Legacy EBAP cleanup | `backend/go-api-gateway/internal/config/config.go`, `backend/go-api-gateway/internal/proxy/reverse_proxy.go`, `backend/integration-tests/Dockerfile`, `docker-compose.yml` | Stops treating removed `ebap-streaming-service` as a required upstream/test dependency. |
| DB pool env knobs | `backend/database-service/database/db.js`, `backend/artist-service/lib/db/pool.js`, `backend/upload-service/lib/db/pool.js`, `backend/playlist-service/lib/database.js`, `backend/lyrics-service/lib/database.js`, `backend/subscription-service/src/server.ts`, `backend/direct-stream-service/src/config.ts`, `backend/direct-stream-service/src/db/songs.ts`, `docker-compose.yml` | Makes per-replica Postgres pool sizes configurable through env without changing current defaults. |
| Optional PgBouncer mode | `docker-compose.pgbouncer.yml`, `infra/pgbouncer/*` | Adds transaction-pool mode for scalable app replicas; services using `postgres.js` set `DB_PREPARE=false` in the overlay. |
| Generated file ignored | `.gitignore` | Prevents committing generated compose because `docker compose config` may include interpolated env values. |
| Party smoke/load runner | `scripts/party-smoke-load.*`, `docs/party-smoke-load-tests.md` | Runs real Party room lifecycle tests with host, guests, WS propagation, queue operations and leave/end flow; wrapper can run directly or inside compose network. |
| Gateway internal header regression | `backend/go-api-gateway/internal/httpx/middleware/headers_test.go` | Locks the public boundary: client-supplied user/service/internal/upload-context headers are stripped before route policy and upstream proxying. |
| Gateway unsafe timeout policy | `backend/go-api-gateway/gateway.yaml`, `backend/go-api-gateway/gateway.artist.yaml`, `backend/go-api-gateway/internal/config/gateway_yaml_test.go` | Every unsafe/auth-only route now has an explicit timeout; large Artist Portal track upload has a protected 180s budget. |

## How To Use The New Scalable Mode

Generate and validate scalable compose:

```bash
./scripts/render-scalable-compose.sh
docker compose -f docker-compose.scalable.generated.json config --quiet
```

Scale stateless services:

```bash
./scripts/scale-stateless.sh api-gateway=4 frontend=2 auth-service=2 database-service=2 search-service=2
```

Scale stateless services with the optional PgBouncer layer:

```bash
COMPOSE_FILES=docker-compose.yml:docker-compose.pgbouncer.yml ./scripts/scale-stateless.sh \
  api-gateway=4 frontend=2 database-service=3 artist-service=3 upload-service=2
```

If `DB_PASSWORD` contains URL-reserved characters, set a URL-encoded
`PGBOUNCER_DATABASE_URL` for `playlist-service` instead of relying on the
default interpolation in `docker-compose.pgbouncer.yml`.

PowerShell equivalent:

```powershell
.\scripts\render-scalable-compose.ps1
.\scripts\scale-stateless.ps1 api-gateway=4 frontend=2 auth-service=2 database-service=2
.\scripts\scale-stateless.ps1 -ComposeFiles docker-compose.yml,docker-compose.pgbouncer.yml api-gateway=4 frontend=2 database-service=3
```

Do not scale these with the stateless script:

```text
postgres redis redis-auth minio meilisearch nats nginx pgbouncer certbot nginx-cert-reloader minio-init portainer pgadmin track-processor audio-features-worker reco-offline-worker
```

Default scalable service set:

```text
api-gateway artist-api-gateway frontend artist-frontend auth-service database-service search-service artist-service artist-portal-service security-service recommendations-service ranking-service playlist-service lyrics-service subscription-service device-sync-service party-gateway-service direct-stream-service ebap-hls-adapter upload-service reco-feedback-worker-go transcode-worker ebap-encoder-worker ebap-hls-packager-worker metadata-parser-service import-service
```

## P0 Backlog

| Item | Goal | Risk | Files/env | Verify |
| --- | --- | --- | --- | --- |
| Use scalable compose generation | Make stateless services scale without changing production compose. | Generated compose contains resolved env; do not commit it. | `scripts/render-scalable-compose.*`, `.gitignore` | `docker compose -f docker-compose.scalable.generated.json config --quiet` |
| Add DB pool budget | Prevent replica count from exhausting Postgres. | Too-high pools create DB outage under scale. | implemented for API services, ranking/search/reco workers, metadata/import, EBAP/HLS workers; LISTEN/NOTIFY workers stay direct with small pools | `select application_name, count(*) from pg_stat_activity group by 1 order by 2 desc;` under load |
| Put PgBouncer before app replicas | Allow more app containers without opening hundreds of Postgres sessions. | Without it, scaling app tier makes DB worse; transaction pooling is not valid for LISTEN/NOTIFY workers. | `docker-compose.pgbouncer.yml`, `infra/pgbouncer`, `DB_PREPARE=false` for pgx clients behind PgBouncer | p95 stable while app replicas increase; PgBouncer `SHOW POOLS;` has bounded server connections |
| Keep search startup work single-owner | Allow multiple search API replicas without duplicate startup setup/backfill. | Multiple backfills can overload Postgres/Meili. | `backend/search-service/internal/indexer/indexer.go`; uses transaction-level advisory locks so it is safe behind transaction PgBouncer; optional `SEARCH_BACKFILL_ON_START=false`, `SEARCH_SETUP_INDEXES=false` on pure query replicas | logs show only one replica owns setup/backfill; query replicas stay healthy |
| Keep cache on catalog reads | Reduce DB/search pressure. | Stale data if invalidation misses mutations. | `backend/go-api-gateway/gateway.yaml`, `response_cache.go` | repeated GET shows `X-Cache: HIT` |
| Runtime critical backup drills | Prove recovery for Postgres and MinIO. | Backups without restore are not recovery. | `scripts/backup-*.sh`, `scripts/drill-*.sh`, `scripts/drill-critical-backups.sh` | full drill completes on isolated containers |

## P1 Backlog

| Item | Goal | Risk | Files/env | Verify |
| --- | --- | --- | --- | --- |
| Redis/redis-auth HA | Keep sessions/rate/cache alive through Redis failure. | Single Redis outage logs users out and breaks cache/queues. | compose/infra docs, `REDIS_*`, `REDIS_AUTH_*`, `REDIS_RL_*` | failover drill keeps `/api/profile` and cache alive |
| MinIO HA or external S3 | Remove media SPOF. | Audio/covers/HLS unavailable on MinIO failure. | `MINIO_*`, upload/media/worker env | object read/write works after node loss |
| Meili HA/managed search | Keep search available through search-index failure. | Search empty/503 if Meili dies. | `MEILI_URL`, `search-service` deployment | search p95/error rate stable during one replica failure |
| NATS HA | Party/device event bus resilience. | Party/device sync breaks on NATS failure. | `NATS_URL`, party compose | websocket/session tests pass after one NATS node loss |
| Per-replica metrics | See which container is failing. | Static targets hide one bad replica. | `monitoring/prometheus/prometheus.yml`, Grafana dashboards | dashboard labels include container/instance |

## P2 Backlog

| Item | Goal | Risk | Files/env | Verify |
| --- | --- | --- | --- | --- |
| Split search query and indexer roles | Query replicas scale independently from indexing. | Current service mixes read API and indexer. | `search-service` compose/env, possible new `search-indexer` service | query replicas have indexer disabled; one indexer owns outbox |
| Internal media edge/cache | Remove app bandwidth bottleneck for covers/audio/HLS inside controlled Earflow infrastructure. | Without a media edge, app and MinIO bandwidth dominate first. | nginx media routes, MinIO buckets, stream URLs | app bandwidth stays flat while media requests grow |
| K8s/Swarm migration | Native service discovery and rolling deployments. | Current k8s folder is partial/stale. | `k8s/*` or new Helm chart | full stack deploys from manifests |
| Autoscaling rules | Scale by queue/RPS/latency, not manually. | Manual scale reacts late. | monitoring/infra | replicas track SLO signals |

## Verification Checklist

| Command | Good result | Bad result means |
| --- | --- | --- |
| `docker compose config --format json | node scripts/render-scalable-compose.js > /tmp/scale.json` | exits 0 | renderer is broken or compose invalid |
| `docker compose -f /tmp/scale.json config --quiet` | exits 0 | generated compose cannot be deployed |
| `docker compose -f /tmp/scale.json up -d --scale api-gateway=4` | four gateway containers start | fixed name/port/dependency still blocks scale |
| `docker compose -f /tmp/scale.json up -d --scale frontend=2` | two frontend containers start | fixed name or host port still blocks scale |
| `COMPOSE_FILES=docker-compose.yml:docker-compose.pgbouncer.yml ./scripts/render-scalable-compose.sh /tmp/scale-pool.json` | exits 0 | PgBouncer overlay cannot be rendered |
| `docker compose -f /tmp/scale-pool.json config --quiet` | exits 0 | generated pooled compose cannot be deployed |
| `docker compose -f docker-compose.yml -f docker-compose.pgbouncer.yml up -d pgbouncer` | PgBouncer becomes healthy | DB credentials/config or PgBouncer image broken |
| `docker compose -f docker-compose.yml -f docker-compose.pgbouncer.yml config --format json \| node scripts/check-db-connection-budget.js --budget=180` | total estimate stays within budget | app scale/pool settings can exhaust Postgres |
| `./scripts/drill-critical-backups.sh` | fresh Postgres and MinIO backups verify and restore into isolated containers | backup exists but recovery is unproven |
| `docker compose -f docker-compose.yml -f docker-compose.pgbouncer.yml exec pgbouncer psql -h 127.0.0.1 -p 6432 -U "$DB_USER" -d pgbouncer -c "show pools;"` | shows pool rows | PgBouncer accepts health but admin console access is broken |
| `curl -sD - -o /dev/null https://earflow.ru/api/version` | `200` | edge/gateway broken |
| `curl -sD - -o /dev/null https://earflow.ru/api/songs` twice | second call can be `X-Cache: HIT` when route response is cacheable | gateway cache/Redis/headers prevent caching |
| `docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select count(*) from pg_stat_activity;"` | stays under planned pool budget | app replicas exhaust DB connections |
| `docker compose exec redis redis-cli ${REDIS_PASSWORD:+-a "$REDIS_PASSWORD"} ping` | `PONG` | cache/rate/reco state unavailable |
| `docker compose exec redis-auth redis-cli ${REDIS_PASSWORD:+-a "$REDIS_PASSWORD"} ping` | `PONG` | auth/session store unavailable |
| `PARTY_TEST_ROOMS=10 PARTY_TEST_GUESTS=10 PARTY_TEST_UPDATES=20 PARTY_TEST_CONCURRENCY=5 ./scripts/party-smoke-load.sh` | `failed=0` and p95 WS propagation latency is acceptable | party REST/WS/NATS/state path loses events or stalls |

## Target End State For 1M Product Scale

| Layer | Minimum scalable shape |
| --- | --- |
| Edge | 2+ nginx/edge nodes behind external LB, TLS at edge, static/media cache controlled by Earflow infrastructure |
| App | Stateless services without fixed container names, scaled by RPS/p95 |
| Gateway | 3+ replicas, Redis-backed rate/cache/session support, route metrics |
| DB | Postgres primary + replica + PgBouncer + tested backup/restore |
| Redis | Separate HA Redis for cache/rate/reco and HA redis-auth for sessions |
| Media | MinIO distributed or external S3-compatible storage; HLS/audio/covers served through controlled media edge/cache |
| Search | Search API replicas separated from one/few indexer workers; Meili HA/managed search |
| Queue/events | NATS HA, Redis Streams consumer groups with lag alerts |
| Observability | Per-route p95/p99/error/cache, per-replica metrics, queue lag, DB pool, Redis latency |
