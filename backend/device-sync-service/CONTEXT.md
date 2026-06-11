# device-sync-service — service context card

**Stack:** Go 1.22 + chi router + Redis (main + Pub/Sub)
**Status:** production
**Code entrypoint:** `cmd/server/main.go`

## Назначение

Хранит и распространяет **playback state** пользователя для multi-device sync: список зарегистрированных устройств, какое из них сейчас active, что играет (now-playing snapshot + timeline), lease на audio output, transfer FSM при переключении между устройствами. По модели **Spotify Connect**: backend единственный источник правды, клиенты — receivers. См. `INV-DS-001`.

Не делает: не стримит аудио (это `direct-stream-service` / `ebap-hls-*`), не валидирует subscription tier (это `subscription-service`), не хранит historical playback (это `analytics-*`).

## Public API

| Method | Path | Auth | Назначение |
|---|---|---|---|
| GET | `/health`, `/ready` | none | liveness/readiness |
| GET | `/metrics` | none | Prometheus |
| POST | `/api/devices/register` | user JWT | регистрация нового device (или resume existing по `clientKey`) |
| POST | `/api/devices/heartbeat` | user JWT | продление TTL device |
| GET | `/api/devices/` | user JWT | список devices + текущий nowPlaying + lease |
| DELETE | `/api/devices/{deviceId}` | user JWT | удалить device |
| POST | `/api/devices/transfer/{deviceId}` | user JWT | начать transfer ownership на указанный device |
| GET | `/api/devices/transfer/status/{transferId}` | user JWT | статус transfer FSM |
| PUT | `/api/devices/now-playing` | user JWT | publish nowPlaying snapshot (только active device) |
| GET | `/api/devices/now-playing` | user JWT | прочитать nowPlaying |
| POST | `/api/devices/commands` | user JWT | intent API (`cmd:play|pause|next|prev|seek|set_volume|transfer`) |
| POST | `/api/devices/ws-ticket` | user JWT | one-shot ticket для последующего WS upgrade |
| GET | `/api/devices/ws?ticket=...` | ticket | WebSocket upgrade |

**WebSocket frames (server → client):**

```
init             — полный snapshot при подключении (включает playerState)
player_state     — единый union-frame {devices,nowPlaying,timeline,lease,transfer,volumeByDevice} с монотонным frameRev
devices:update   — изменения в наборе devices (registered/touched/removed) [deprecated 1 релиз]
devices:active   — сменился active device (содержит {deviceId, activeRevision}) [deprecated 1 релиз]
np:update        — nowPlaying snapshot обновился [deprecated 1 релиз]
timeline:update  — обновление позиции/состояния timeline [deprecated 1 релиз]
lease:update     — audio output lease изменился (SUSPENDED/REVOKED/...) [deprecated 1 релиз]
transfer:update  — phase transfer FSM (start/revoke_ack/activate_ack/reconciled/failed/expired) [deprecated 1 релиз]
cmd              — широковещательная команда (от controller к active device)
```

`player_state` публикуется автоматически после legacy device/now-playing/timeline/lease frames (см. `playerStateTriggerFrames` в `internal/devices/playerstate.go`), после сохранённой transfer phase/ack/retry/expire и после `cmd:set_volume`. `frameRev` — монотонный Redis counter (`user:{uid}:frame:rev`, Persist). Клиент отбрасывает кадры с `frameRev <= last`.

Frame ordering гарантирован per-user через single Redis Pub/Sub channel. Frontend применяет `player_state` атомарно; deprecated frames остаются fallback только пока соединение не получило полный `player_state` с `devices`.

## Owns (Redis keys)

Все keys префиксуются `cfg.Redis.KeyPrefix` (по умолчанию `earflow:dsync:`).

```
user:{uid}:devices              — Set<deviceId>, TTL DEVICE_TTL
device:{did}                    — Hash {name,kind,userAgent,ip,sessionId,lastSeenAt,clientKey,capabilities,userId,createdAt}, TTL DEVICE_TTL
user:{uid}:client-map:{ck}      — string deviceId (resume existing на том же browser), TTL DEVICE_TTL
user:{uid}:active               — string deviceId (current active), TTL DEVICE_TTL
user:{uid}:active:rev           — int64 monotonic revision (Persist'нут, не expire'ит)
user:{uid}:np                   — JSON nowPlaying snapshot, TTL NOW_PLAYING_TTL
user:{uid}:timeline             — JSON timeline snapshot, TTL NOW_PLAYING_TTL
user:{uid}:lease                — JSON lease state {holderDeviceId, deviceStates, lastChangedAt}
user:{uid}:lease:rev            — int64 monotonic
user:{uid}:output:{did}         — string local output state per device
transfer:{transferId}           — JSON TransferRecord, TTL Transfer.RecordTTL
user:{uid}:transfer:active      — string transferId (текущий in-flight)
transfers:active                — Set<transferId> (для retry worker)
user:{uid}:idempotency:{key}    — string transferId (POST /transfer dedupe)
user:{uid}:frame:rev            — int64 monotonic frameRev для player_state (Persist'нут)
user:{uid}:volume:{did}         — string float 0..1 per-device volume, TTL DEVICE_TTL
```

**Pub/Sub channel:** `{prefix}dsync:user:{uid}` (все WS-frames эмиттятся сюда).

## Reads (внешние зависимости как клиент)

```
go-api-gateway        — присылает X-User-Id только после session middleware (см. INV-SEC-003)
auth-service          — выпускает JWT, чьи issuer/audience валидируются в internal/auth
Redis (main cluster)  — single instance/replica, no sharding (per-user data fits in one shard)
```

Не зависит от: Postgres, MinIO, NATS, других музыкальных сервисов.

## Publishes

См. WebSocket frames выше. Дополнительно — Prometheus метрики (`internal/observability`):

```
dsync_devices_active_total       — counter
dsync_transfer_started_total     — counter
dsync_transfer_failed_total      — counter{reason}
dsync_transfer_reconcile_total   — counter{outcome}
dsync_reconcile_total            — counter{reason} (transfer worker)
```

## Dependencies (инфраструктура)

```
Required:
  - Redis (для KV + Pub/Sub)
  - JWT public key (от auth-service)
Optional (background workers):
  - transfer-worker goroutine — внутри сервиса, retry expired transfers
```

## Caveats / Gotchas

- **`cmd:play` от non-active device — это transfer intent.** Backend сам делает `StartTransfer` (см. `INV-DS-002`, `Registry.SendCommand`). Frontend не должен делать self-transfer.
- **`keyActive` имеет TTL = DEVICE_TTL** (по умолчанию ~10 мин). Если active device пропустит heartbeat — ownership сбрасывается, потребуется новый `StartTransfer` от любого живого device.
- **`keyActiveRevision` Persist'нут** — иначе при reset active мы потеряем монотонный counter и frontend может применить stale frames.
- **Transfer FSM имеет phases:** `started` → `revoke_sent` → `revoke_acked` → `activate_sent` → `activate_acked` → `reconciled`. Любая phase кроме `reconciled|expired|failed` блокирует следующий transfer от того же пользователя.
- **Idempotency-Key** на POST `/transfer/{deviceId}` дедуплицирует параллельные клики на UI кнопке "Передать".
- **Pause-relay vs transfer:** `cmd:pause` от non-active device идёт active'у как broadcast, **не меняя active**. См. тест `TestSendCommandPauseFromNonActiveDeviceIsRelayedToActiveWithoutTransfer`.

## Recent significant changes

- **2026-06-11** — `player_state` включает `devices`; frontend отключает fragmented fallback после полного unified frame; desktop status dot показывается только при connected + 2 present devices.
- **2026-05-27** — Этап 1: transfer-on-play на backend, удаление frontend authority. См. `docs/DECISIONS.md`.

## Tests

```bash
# из backend/device-sync-service/
go test ./...                                          # все unit-тесты
go test ./internal/devices -run TestSendCommand        # transfer FSM + intent API
go test ./internal/auth                                # ticket/jwt
go test ./internal/devices -run TestStartTransfer      # transfer FSM phases
```

Smoke (требует поднятого compose):

```bash
go run ./cmd/device-sync-smoke
```

## Где смотреть глубже

- Routes: `internal/httpapi/routes.go`
- Domain (state + key management): `internal/devices/registry.go`
- Transfer FSM: `internal/devices/transfer_fsm.go`, `internal/devices/transfer_worker.go`
- WebSocket layer: `internal/websocket/`
- Auth (JWT + ticket): `internal/auth/`
- Конфиг: `internal/config/`
- Архитектурная карта (вся платформа): `docs/earflow-architecture-map.md`
- Инварианты по DeviceSync: `docs/ARCHITECTURE_INVARIANTS.md` (`INV-DS-001`..`INV-DS-006`)
