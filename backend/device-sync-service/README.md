# device-sync-service (Go)

Spotify-Connect-style cross-device synchronization for Earflow.
**Server-authoritative**: every decision (who is active, who gets a command,
whose now-playing update wins) lives here. The frontend only transports
events.

Scale target: **100k+ DAU**, tens of thousands of concurrent WS sockets per
instance, horizontally scalable (Redis Pub/Sub — sticky sessions NOT required).

## Tech stack

| Concern | Choice |
|---|---|
| Language / runtime | Go 1.22, goroutines + non-blocking I/O |
| HTTP router | `github.com/go-chi/chi/v5` |
| WebSocket | `github.com/coder/websocket` (context-first API) |
| Redis client | `github.com/redis/go-redis/v9` |
| JWT | `github.com/golang-jwt/jwt/v5` |
| Metrics | `github.com/prometheus/client_golang` |
| Logging | `log/slog` (stdlib, JSON in prod) |
| Rate limiting | `golang.org/x/time/rate` + LRU eviction |

## Architecture

```
                ┌─────────────────────────────────────────────┐
                │               go-api-gateway                │
                └──────────────────┬──────────────────────────┘
                                   │
                 /api/devices/*    │    /ws/devices (WS)
                                   │
                                   ▼
                  ┌─────────────────────────────────┐
                  │   device-sync-service (Go)     │
                  │                                 │
                  │   chi router ─► REST handlers  │
                  │        │                        │
                  │        └──► Registry ──► Redis │
                  │                                 │
                  │   WS upgrade ─► per-user Hub ──┼──► SUBSCRIBE
                  │        │                        │
                  │    read/write pumps            │
                  └─────────────────────────────────┘
                                   │
                                   ▼
                              Redis (db=3)
                           Pub/Sub "dsync:events:user:<id>"
```

Key invariants:

1. **One source of truth** for "active device" in Redis `dsync:user:<id>:active`.
2. **Server routes directed commands**. A `cmd` with non-empty `to` reaches
   exactly one socket (`Hub.fanout`). Clients never filter themselves.
3. **`np:update` gated by active**. Incoming now-playing is dropped if the
   sending socket's `deviceId` is not the current active — re-checked on
   every frame, closing the transfer race.
4. **`stateRevision` dedup**. `PutNowPlaying` discards writes with a revision
   ≤ the current one.

## Endpoints

All `/api/devices/*` require an authenticated user (`X-User-Id` header from
gateway OR `Authorization: Bearer <JWT>`) and pass through the feature gate
(`DEVICE_SYNC_ENABLED`).

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/devices/register` | Register current device → `{deviceId}` |
| `POST` | `/api/devices/heartbeat` | Extend device TTL |
| `DELETE` | `/api/devices/:deviceId` | Revoke |
| `GET` | `/api/devices/` | List devices + current `nowPlaying` |
| `POST` | `/api/devices/transfer/:deviceId` | **Server** pauses prev active, resumes new one |
| `PUT` | `/api/devices/now-playing` | Active device pushes state |
| `GET` | `/api/devices/now-playing` | Authoritative snapshot |
| `POST` | `/api/devices/commands` | `play`/`pause`/`next`/`previous`/`seek`/`set_volume` |
| `POST` | `/api/devices/ws-ticket` | Short-lived HS256 ticket for `/ws/devices` |

WebSocket: `GET /ws/devices?ticket=<HS256>`

Server → client frames: `init`, `devices:update`, `devices:active`,
`np:update`, `cmd` (per-socket routed when `to` is set), `pong`.

Client → server frames: `ping`, `heartbeat`, `np:update`, `cmd`.

## Ops endpoints (bypass feature gate & auth)

| Path | Semantics |
|---|---|
| `GET /health` | Liveness: always 200 while the process is alive. Includes `enabled`. |
| `GET /ready` | Readiness: 200 iff Redis PING succeeds within 2s. |
| `GET /metrics` | Prometheus exposition. |

## Prometheus metrics

```
dsync_ws_connections_active          # gauge
dsync_ws_messages_total{direction,type}
dsync_ws_errors_total{reason}
dsync_cmd_total{cmd}
dsync_transfer_total
dsync_redis_pub_dropped_total
dsync_http_requests_total{method,route,status}
dsync_http_request_duration_seconds{method,route}   # histogram, 14 buckets
dsync_devices_active
```

## Configuration (env)

| Var | Default | Notes |
|---|---|---|
| `DEVICE_SYNC_ENABLED` | `false` | Master on/off. `false` → HTTP 503 + WS 503. |
| `PORT` | `3050` | |
| `NODE_ENV` | `development` | `production` enables HSTS, JSON logs. |
| `INSTANCE_ID` | hostname | Reported in every log line + `/health`. |
| `JWT_SECRET` | **required** ≥32 chars | HMAC for gateway-issued JWTs. |
| `DEVICE_SYNC_WS_TICKET_SECRET` | falls back to `JWT_SECRET` | **Use a distinct 64-hex value in prod.** |
| `WS_TICKET_TTL` | `60s` | Hard range: 10s–10m. |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` / `REDIS_DB` | `redis` / `6379` / — / `3` | Dedicated DB isolates keys from the Party (party-go) Redis usage. |
| `REDIS_POOL_SIZE` | `50` | Per instance. 50 × N replicas = pool to Redis. |
| `REDIS_MIN_IDLE` | `10` | Warm connections. |
| `MAX_DEVICES_PER_USER` | `30` | LRU-evicted by `lastSeenAt`. |
| `DEVICE_TTL_SECONDS` | `900` | 15 min no-heartbeat → pruned. |
| `NOW_PLAYING_TTL_SECONDS` | `3600` | |
| `WS_RATE_LIMIT_MESSAGES_PER_SECOND` | `8` | Per socket; exceeded → 4008 close. |
| `WS_READ_LIMIT_BYTES` | `4096` | Hard max per WS frame. |
| `WS_READ_TIMEOUT` | `60s` | |
| `WS_WRITE_TIMEOUT` | `10s` | |
| `WS_PING_INTERVAL` | `25s` | |
| `WS_WRITE_BUFFER` | `64` | Outbound channel depth per client. |
| `MAX_COMMAND_PAYLOAD_BYTES` | `2048` | Hard cap on `cmd.payload`. |
| `RATE_LIMIT_MAX_REQUESTS` | `120` | Per IP. |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_WINDOW` | `60000` / `60s` | Either accepted. |
| `ALLOWED_ORIGINS` | — | CSV allow-list for CORS & WS Origin. Required in prod. |
| `HTTP_READ_HEADER_TIMEOUT` | `10s` | Slowloris guard. |
| `HTTP_WRITE_TIMEOUT` | `15s` | Not applied to WS (library overrides). |
| `HTTP_IDLE_TIMEOUT` | `120s` | |
| `SHUTDOWN_TIMEOUT` | `30s` | Graceful drain budget. |

## Generating secrets

```bash
openssl rand -hex 32      # 64 hex chars = 256 bits
```

```powershell
$b = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
-join ($b | ForEach-Object { $_.ToString('x2') })
```

## Development

```bash
cd backend/device-sync-service
go mod tidy
go build ./...
go vet ./...

# Run locally (requires a reachable Redis):
DEVICE_SYNC_ENABLED=true \
JWT_SECRET=$(openssl rand -hex 32) \
DEVICE_SYNC_WS_TICKET_SECRET=$(openssl rand -hex 32) \
REDIS_HOST=127.0.0.1 \
ALLOWED_ORIGINS=http://localhost:3000 \
go run ./cmd/server
```

## Rollback

1. Prefer **feature off**:
   `DEVICE_SYNC_ENABLED=false` (backend) and
   `EARFLOW_DEVICE_SYNC_ENABLED=false` (frontend) → recompose the two services.
   Redis state stays and auto-expires.
2. **Stop the container**:
   `docker compose stop device-sync-service`. Gateway will 502 for users whose
   frontend has the flag on. Default build is unaffected.
3. **Revert and purge state**:
   `redis-cli -n 3 --scan --pattern 'dsync:*' | xargs redis-cli -n 3 del`.

## Why Go and not Node.js

- goroutines make tens of thousands of idle WS sockets cost ~2 KB each
  (vs. Node's `libuv` single-loop pressure);
- compile-time types cut the entire class of "typo in payload field"
  incidents that Node.js `.js` code pays for in prod;
- distroless binary → ~25 MB image, instant start, no runtime deps;
- native `context` cancellation in stdlib matches the shape of every
  per-socket lifecycle we manage.
