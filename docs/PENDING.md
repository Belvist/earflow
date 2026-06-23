# Pending — известный архитектурный долг и нереализованные задачи

**Назначение:** единый список того, что **мы знаем что не сделано** или сделано временно. Альтернатива разбросанным `TODO` / `FIXME` в коде.

**Правила:**
- Запись добавляется когда обнаружен gap, временное решение, или отложенная фича.
- Запись удаляется когда задача выполнена (с упоминанием в `DECISIONS.md`).
- AI-агент **должен** проверить этот файл перед добавлением `// TODO` в код. Любой `TODO` в коде — это нарушение; место для него здесь.

**Формат:** `[ID] Область — Описание — Priority — Notes`.

---

### PEND-IOS-001 — Native iOS app scaffold and verification

**Priority:** high
**Status:** scaffold present (2026-06-23); full verification gate not closed

Контекст: native iOS направление — SwiftUI listener app в `ios-app/`. **Scaffold добавлен:** XcodeGen `project.yml`, `Earflow.xcodeproj`, Auth/Network/Playback foundations.

**Что сделано (Phase 0–1 partial):**
- `ios-app/` SwiftUI project + `docs/IOS_APP.md` + `ios-app/CONTEXT.md`
- `AuthActor`, Keychain, P-256 proof signer, proof token cache
- `GatewayClient` (gateway-only, retry, log redaction)
- `PlaybackActor`, HLS session via `/api/ebap-hls/v1/session`
- DeviceSync / Analytics skeletons
- `npm run verify:ios-native` / `scripts/verify-ios-native.sh`
- Unit tests: canonical proof string, state enums

**Что не сделано:**
- Не выполнены генерация проекта (`xcodegen generate` или эквивалент), `xcodebuild build` и `xcodebuild test`.
- Не выполнены smoke/UI-тесты на iOS Simulator.
- Не выполнен запуск на реальном iPhone, TestFlight или macOS CI runner.
- Не реализована полноценная auth-цепочка: login, Keychain/Secure Enclave proof signing, Proof Access Token exchange, refresh/revoke flow.
- Не реализованы `AVPlayer`, stream/ws ticket consume, background audio и lock screen controls.
- Не реализован native DeviceSync client (`player_state`, WS ticket, transfer/seek/volume consistency).
- Не реализованы реальные catalog/search/library/profile screens поверх gateway API.
- Не реализованы и не проверены App Intents для системных поверхностей iOS.
- Не выполнена gesture QA: mini tap/open, swipe up, horizontal swipe, dismiss during snap, scroll handoff, rapid open/close, multi-touch/race cases.
- Не выполнен security audit: отсутствие логирования токенов/тикетов, full proof для чувствительных операций, invalidate/revoke сценарии.

**Gate для закрытия:**
1. На macOS с Xcode и iOS Simulator создать или восстановить native iOS проект.
2. Зафиксировать воспроизводимую команду верификации (`npm run verify:ios-native` или documented equivalent).
3. Получить PASS для build/test на Simulator.
4. Получить PASS для smoke-сценария на реальном iPhone или TestFlight.
5. Проверить gesture ownership против `docs/GESTURE_ARCHITECTURE.md`, `docs/MOBILE_PLAYER_SHEET_DESIGN.md` и `INV-GESTURE-*` / `INV-SHEET-*`.

**Blocks:** любые заявления “native iOS app готово”, “можно тестировать на iPhone”, “gesture-поведение безопасно проверено” или “App Intents готовы”.

### PEND-WAVE-001 — Server-side waveform peaks for hero / seek UI

**Priority:** medium
**Status:** in progress (API + transcode-worker; backfill `waveform_status=pending` on existing catalog)

**Implemented:** `waveform_peaks` JSONB on `songs`, generation in `transcode-worker` (ffmpeg), `GET /api/songs/:id/waveform`, frontend `useTrackWaveformPeaks` → API only.

**Remaining:** one-time backfill for tracks uploaded before migration (`UPDATE songs SET waveform_status='pending' WHERE waveform_peaks IS NULL AND is_available`).

---

## Streaming / Home UI (closed)

## DeviceSync / Playback

Порядок закрытия Spotify-parity записан ниже: live verification → automated two-client gate → server-owned queue/session → удаление legacy frames → audio output selector.

### PEND-DS-001 — ~~Этап 2: единый `player_state` frame~~ — закрыто 2026-06-11

Реализовано: `player_state` union-frame с `devices`, `nowPlaying`, `timeline`, `lease`, `transfer`, `activeDeviceId`, `activeRevision`, `volumeByDevice` и монотонным `frameRev`; init/list включает `playerState`; frontend читает unified frame и отключает fragmented fallback после полного frame. Legacy frames оставлены deprecated на 1 релиз. См. `DECISIONS.md` 2026-06-11 и `backend/device-sync-service/CONTEXT.md`.

### PEND-DS-002 — ~~Volume per-device на backend~~ — закрыто 2026-06-11

Реализовано: `cmd:set_volume` персистит `user:{uid}:volume:{did}` (TTL `DEVICE_TTL`) и публикуется в `player_state.volumeByDevice`. См. `DECISIONS.md` 2026-06-11 и `backend/device-sync-service/CONTEXT.md`.

### PEND-DS-004 — Prod two-device Spotify parity verification

**Priority:** critical
**Status:** not closed

Кодовый путь для Spotify-style DeviceSync подготовлен: backend-owned `player_state`, transfer-on-play, `payload.nowPlaying` bootstrap для local play, per-device volume. Но “уровень Spotify” нельзя закрывать без live матрицы на двух реальных клиентах (Windows desktop + iPhone/Safari/PWA) после VPS deploy.

**Нужно проверить на prod/staging:**
1. Fresh pair: оба устройства online, active пустой → tap play на iPhone → Windows получает `player_state` с тем же `trackId`, `deviceId=iPhone`, `isPlaying=true`, позицией без старого snapshot.
2. Reverse: tap play на Windows при active iPhone → iPhone получает revoke/suspend, Windows active, второй клиент видит новый трек.
3. Passive controls: pause/play/seek/next/previous с non-active клиента управляют active device без self-transfer, кроме `cmd:play` ownership intent.
4. Volume: `set_volume` меняет только targeted active/per-device volume и не ломает playback state.
5. Reconnect: reload одного клиента, sleep/wake телефона, краткий WS reconnect → нет duplicate audio, active не мигает, `frameRev` монотонный.
6. Negative security: non-owned/expired device id не может публиковать nowPlaying или command; protected routes остаются через gateway/PoP.

**Evidence to attach before closing:** DevTools WS frames или server logs с `player_state.frameRev`, `activeDeviceId`, `nowPlaying.trackId`, `transfer.phase`; команды деплоя и commit hash.

### PEND-DS-005 — Server-owned queue/session context

**Priority:** high
**Status:** not started

Сейчас DeviceSync синхронизирует текущий track/timeline и часть queue metadata (`queueSource`, `queueName`), но не владеет полноценной очередью как Spotify Connect. `next/previous` исполняются на active device, а passive client не получает backend-owned queue cursor/list.

**Что нужно:**
- Ввести backend-owned playback session/queue snapshot: source type, ordered track ids, current index, shuffle/repeat, queue revision.
- `cmd:next|previous` должен менять session на backend или требовать ack от active с новым snapshot; не держать разные очереди на клиентах.
- Frontend должен показывать passive queue как projection server session, без локального пересчёта ownership/order.
- Добавить tests на stale queue revision, transfer с queue continuity, local play replacing queue.

### PEND-DS-006 — Удалить deprecated fragmented frames после soak

**Priority:** medium
**Status:** waiting for prod soak

`player_state` уже является основным frame, но legacy `np:update`, `devices:active`, `devices:update`, `timeline:update`, `lease:update`, `transfer:update` ещё оставлены как fallback на один релиз. После подтверждённого prod soak нужно удалить fallback paths, чтобы не осталось двух параллельных state channels.

**Что нужно:**
- Зафиксировать prod soak без WS regressions.
- Удалить fragmented fallback из `useDeviceSync.js`.
- Упростить backend publish path: новые поля только через `player_state`.
- Обновить `CONTEXT.md`, `DECISIONS.md`, tests.

### PEND-DS-007 — Automated two-client DeviceSync e2e harness

**Priority:** high
**Status:** not started

Ручная проверка телефона/ПК нужна, но недостаточна. Нужен Playwright/mocked-audio e2e harness с двумя browser contexts под одним user/session, чтобы ловить regressions до VPS.

**Что нужно:**
- Два клиента с разными `clientKey/deviceId`, один backend stack или test double device-sync-service.
- Проверки: local play bootstrap, transfer button, passive pause/seek/next, reconnect, stale frame rejection, volumeByDevice.
- Артефакты: WS frame log + screenshot DevicesPanel/player bar.
- Встроить в `verify:player-mobile`/`validate:ai` как optional gate или отдельный `verify:device-sync`.

### PEND-DS-003 — Audio output device selector (Spotify-style "Этот компьютер — AirPods Pro")

**Priority:** low
**Status:** not started

Это **отдельная** от DeviceSync фича. У Spotify desktop показывает текущий OS audio output (AirPods, динамики). У нас этого нет — мы играем в системный default output.

**Что нужно:**
- Web Audio API позволяет `setSinkId(deviceId)` на HTMLMediaElement (Chrome 110+).
- UI селектор output device — отдельный из DeviceSync output.
- Не путать с `device` из DeviceSync — это **независимый** концепт.

---

## Mobile player sheet

### PEND-SHEET-001 — ~~Фаза `SNAPPING`~~ — закрыто 2026-06-04

Реализовано: `PLAYER_SHEET_PHASE.SNAPPING`, `INV-SHEET-011`, e2e `player-gestures-contract.spec.js` (dismiss during snap).

---

## Frontend

### PEND-FE-001 — `useDeviceSync.js` всё ещё ~1100 строк

**Priority:** medium
**Status:** частично разгружен в Этапе 1 (-15KB)

После Этапа 1 hook уменьшился, но всё ещё содержит много reconnect/heartbeat/visibility/online логики, которую можно вынести в отдельный модуль `frontend/src/hooks/deviceSyncTransport.js`. Это сделает основной hook читаемым.

**Blocks by:** ~~PEND-DS-001~~ разблокировано 2026-06-11 — `player_state` внедрён. Теперь можно выносить transport/reconnect/visibility логику из `useDeviceSync.js` без изменения public hook contract.

---

## Social

### PEND-SOCIAL-001 — Shared feed cache invalidation before database-service horizontal scale

**Priority:** medium
**Status:** not started

Social feed now uses a short process-local public-page cache in `database-service` plus viewer overlay per request. This reduces repeated DB reads without moving ownership to React. If `database-service` is scaled to multiple replicas or social traffic becomes high, move feed page cache/invalidation to Redis or NATS-backed namespace invalidation so create/delete/reaction updates invalidate all replicas.

**Do not:** cache viewer-specific DTOs in shared cache; expose `author.id`/`handle`; reintroduce full feed reload after every like.

### PEND-SOCIAL-002 — Finish verification and VPS rollout for social privacy/perf pass

**Priority:** high
**Status:** **closed locally (2026-06-23)** — verification ladder PASS; VPS deploy checklist below

**Verified:**
- `npm --prefix backend/database-service run test:social` — 9/9 PASS (incl. state machine + pickCreatePostFields)
- `CI=true npm --prefix frontend test -- --watchAll=false --runInBand --runTestsByPath src/components/SocialPage.test.js` — 4/4 PASS
- `npm --prefix frontend run build` — PASS
- `npm run validate:ai` — 0 errors
- `go test ./internal/auth/ -run TestGatewayYAMLSocial` — PASS
- Gateway route `social` in `gateway.yaml`; API client methods wired in `frontend/src/api/client.js`
- Backend-SOT: `POST_STATUS`, `pickCreatePostFields`, `INV-SOCIAL-004`; frontend renderer-only

**VPS deploy (ops, not auto-closed here):**
```bash
git pull origin main
psql "$DATABASE_URL" -f backend/database-service/database/migrations/004_social_feed.sql   # if not applied
psql "$DATABASE_URL" -f backend/database-service/database/migrations/005_social_feed_likes_count.sql
docker compose build --no-cache frontend api-gateway database-service
docker compose up -d frontend api-gateway database-service
```
Browser smoke `/social`: compact cards, no `author.id`/`handle` in feed JSON, `...` only on own posts, like applies `reaction` without full feed reload.

---

## Backend

### PEND-BE-001 — Service contracts документация per-service

**Priority:** medium
**Status:** partial (есть `reports/SERVICE_MAP.md` но он high-level)

Не у всех 20+ сервисов есть `CONTEXT.md` карточка (см. `docs/SERVICE_CONTEXT_TEMPLATE.md`). Создавать по мере касания сервиса в задачах.

**Текущее покрытие:**
- `backend/device-sync-service/CONTEXT.md` — есть (создан в Этапе 1).
- Остальные — TBD.

---

## Operations

### PEND-OPS-001 — Sticky sessions для WS при scale

**Priority:** low
**Status:** monitor

После Этапа 1 WS открывается всегда → базовая нагрузка WS на gateway ×2. Если активные онлайн >5k, нужны sticky session affinity (sticky cookie на `device-sync-service` instance).

---

## Security (PoP → production-grade) — см. `docs/SECURITY_ROADMAP.md`, `docs/AUTH_TARGET_ARCHITECTURE.md`

### PEND-SEC-000 — Auth invariants + CI prod-bypass guard

**Priority:** critical  
**Status:** done (2026-06-04)  

**Delivered:** `validate-auth-prod-guard.js` (docker-compose, Dockerfiles, k8s, CI workflows); wired in `validate:ai` + CI; `INV-SEC-011`/`INV-SEC-012`; route PoP audit (`route_pop_audit_test.go`); spoofed header contract tests (`spoofed_headers_contract_test.go`); ECDSA DER+P1363 contract tests; duplicate `auth_sessions` route id fixed in `gateway.yaml`.

### PEND-SEC-001a — Live gateway PoP harness e2e (без mock route)

**Priority:** critical  
**Status:** done (2026-06-04)  

`pop-e2e-harness` (miniredis + real middleware, `isProduction=true`) + `npm run test:e2e:pop-live`. Не production path — seed endpoint, не login flow.

### PEND-SEC-001 — Full-stack PoP e2e без mock (docker compose stack)

**Priority:** critical  
**Status:** done (2026-06-05, VPS `ru-vmv2-mini`)  

**Validated:** `bash scripts/run-auth-fullstack-e2e.sh` — bootstrap OK, Playwright `device-proof-fullstack.spec.js` **1 passed** (login → device register → profile 200; cookie transplant 401 `DEVICE_PROOF_REQUIRED`; refresh 401).

**Ops notes:** e2e overlay requires `COOKIE_DOMAIN=host` (not empty) when `NODE_ENV=production` — empty defaults to `.earflow.ru` in `config.go`. Artifacts: `artifacts/auth-e2e/`, `frontend/e2e/artifacts/auth-fullstack/`. **After `force-recreate api-gateway`:** recreate `auth-e2e-edge` too — static nginx `proxy_pass` cached stale gateway IPs → **502** on `/api/*` until edge reload (`nginx/auth-e2e-edge.conf` uses Docker DNS `127.0.0.11` since `250e256`).

Real stack: gateway + Redis + security-service + auth login + frontend + `auth-e2e-edge`. **No** seed-session, **no** `/e2e/fixture`, **no** mock.

### PEND-SEC-011 — Postgres SoT (sessions/devices/refresh/events)

**Priority:** critical  
**Status:** done (2026-06-07, VPS `ru-vmv2-mini`)

**Prod evidence:** migration 003 ✓; backfill 82 sessions ✓; `AUTH_PG_SOT_MODE=dual_write` ✓; automated verify ✓; revoke-others PC ↔ phone ✓; SQL UpsertSession paren fix (`ae79b2e`); revoke enumerates Redis+PG (`8f2a366`); MFA lookup NULL salt fix (`353bf4b`).

**Rollback:** `AUTH_PG_SOT_MODE=off` + recreate gateway/security.

### PEND-SEC-012 — Epoch revoke + Redis pub/sub

**Priority:** critical  
**Status:** done (2026-06-07, VPS `ru-vmv2-mini`)

**Done:** `RevokeEvent` on channel `earflow:auth:session:revoke:v1`; security-service publishes after successful Redis revoke; api-gateway subscriber + local tombstone; idempotent duplicate events; tests (miniredis); `scripts/verify-auth-epoch-revoke.sh`. Manual DoD: revoke A→B 401 ≤2s confirmed.

### PEND-SEC-013 — Proof Access Token (hot path)

**Priority:** high  
**Status:** **closed (2026-06-08)** — browser DoD 8/8 PASS + capacity gate PASS (`PEND-SEC-CAPACITY-001`)

**Implemented (do not re-do):**
- `POST /api/auth/proof/token` — full ECDSA exchange → HS256 JWT ~90s (`type=proof_access`, `sid`, `authDeviceId`, `sessionEpoch`, `deviceEpoch`)
- Hot-path gateway middleware: `X-Auth-Proof-Access-Token` → local JWT verify + epoch cache; **no Redis SETNX**
- Sensitive paths: logout / refresh / proof/token / device/register / sessions / password / security / 2fa / telegram/unlink → **full ECDSA + SETNX only**
- PG epoch lookup: `POST /internal/auth/v1/epochs/lookup` (prod 200 ✓)
- Epoch cache bump on revoke pub/sub (SEC-012)
- Frontend: `proofAccessToken.js` exchange + in-memory cache; nginx CORS header
- `scripts/verify-auth-proof-token.sh` — automated PASS on VPS

**Prod evidence (automated):** `493ba5a` + `5010df1`; `epochs/lookup` → 200; verify script PASS.  
**Browser DoD (e2e):** Playwright `device-proof-access-token-dod.spec.js` **PASS 8/8** on `ru-vmv2-mini` (2026-06-08, ~36s).

**Automated (infra):** `bash scripts/verify-auth-proof-token.sh`  
**Automated (browser DoD):** `bash scripts/run-auth-proof-token-browser-dod.sh` — **required to close SEC-013**

**Browser DoD (required before closed):**

| Check | Expected |
|-------|----------|
| After login | `POST /api/auth/proof/token` → 200, `expiresIn ≈ 90` |
| Hot GET e.g. `/api/profile` | `X-Auth-Proof-Access-Token` + `X-Auth-Device-Id` |
| Hot GET | **no** `X-Auth-Device-Proof*` headers |
| Sensitive (logout/refresh/revoke/sessions) | full `X-Auth-Device-Proof*`; token-only → 401 |
| Token TTL expiry | new exchange after ~90s |
| Invalid/stale token | 401; **no** infinite retry loop |
| Revoke cross-device | device B holds live token → A revokes B → B hot GET 401 ≤2s |

**Scale claims:** capacity validated on `ru-vmv2-mini` auth-e2e profile only — see `PEND-SEC-CAPACITY-001` / `reports/auth-capacity-20260608.md`. Do **not** write «готово для миллионов» / «Redis не bottleneck навсегда» / «production scale proven».

**Known risks (accepted for hot-path optimization, not closed):** token replay within TTL (~90s) if XSS/extension steals header; WS/stream still cookie-only (`PEND-SEC-005`); ~~artist-frontend has no proof token cache~~ **mitigated 2026-06-23** — artist portal uses same proof token + PoP transport as listener.

**Commits:** `493ba5a`, `5010df1`, `c5c501d` (double-nonce fix), `ac37504` (DoD e2e fixes), capacity tooling `d726935`–`250e256`.

### PEND-SEC-CAPACITY-001 — Auth hot-path capacity report

**Priority:** high  
**Status:** done (2026-06-08, VPS `ru-vmv2-mini`, git `250e256`)

**Profile:** auth-e2e `http://127.0.0.1:18080`, 2× api-gateway, 20 sessions, hot target 500 RPS.

**Results:** hot GET `/api/profile` p95 **6.18 ms**, error rate **0.000%**; proof/token p95 **40.8 ms**; refresh p95 **34.3 ms**; revoke → 401 first observed **25 ms**.

**Report:** `reports/auth-capacity-20260608.md`; runner `scripts/run-auth-capacity.sh`; verify `scripts/verify-auth-capacity.sh`.

**Not claimed:** millions-ready / prod soak / horizontal multi-generator load — separate gate if needed.

### PEND-SEC-002 — Sessions/devices control (revoke-all + UI)

**Priority:** high  
**Status:** **closed (2026-06-10)** — `GET /api/auth/devices` + listener `AuthDevicesSection`

DoD: см. roadmap §2.

### PEND-SEC-003 — Fresh-login protection

**Priority:** high  
**Status:** **backend unit tests PASS (2026-06-23 local)** — VPS/browser e2e gate pending  

Mass revoke с сессии <24h без step-up → `FRESH_LOGIN_REQUIRED` (security-service). Step-up via `POST /api/auth/2fa/step-up` unblocks.

**Delivered locally (2026-06-23):**
- `security-service` unit tests: fresh session → `FRESH_LOGIN_REQUIRED`; step-up active → 200; mature session (>24h) skips fresh guard.
- Artist portal: PoP device register + proof access token on all API calls (`artist-frontend/src/auth/*`, `transport/http.js`); `FRESH_LOGIN_REQUIRED` → step-up modal (UI only displays backend decision).

**Still required before closed:**
- VPS/browser matrix: new session → revoke-others → `FRESH_LOGIN_REQUIRED` → step-up → retry → 200.
- `bash scripts/run-auth-fullstack-e2e.sh` or manual DevTools on auth-e2e with sessions UI.

### PEND-SEC-004 — MFA step-up modal (UI)

**Priority:** high  
**Status:** **closed (2026-06-10)** — listener: sessions, password, telegram unlink + `StepUpModal`; no backend API for email change / account delete (out of Wave B scope)

Revoke/password/email/delete — modal при `MFA_STEP_UP_REQUIRED`, не raw error strip.

**Observed prod (2026-06):** `POST /api/auth/sessions/revoke-others` → **403** без step-up UI выглядит как поломка. **Must:** parse response body `code`; if `MFA_STEP_UP_REQUIRED` → step-up flow (reuse existing MFA verify endpoint), then retry revoke. Distinguish from `CSRF_*` / `DEVICE_PROOF_*` (client/nginx bug).

### PEND-SEC-014 — CORS/PoP nginx preflight matrix

**Priority:** critical  
**Status:** **closed (2026-06-08)** — superseded by SEC-013 browser DoD + deploy script (not open debt)

**Why it looked open:** status «not prod-green» conflicted with SEC-013 closed + capacity closed.

**Evidence for closure:**
- SEC-013 browser DoD 8/8 PASS on auth-e2e (`device-proof-access-token-dod.spec.js`, 2026-06-08) — cross-origin calls to proof/token, refresh, profile, revoke **require** working CORS on those routes; DoD would fail otherwise.
- `scripts/verify-cors-pop-preflight.sh` (`npm run verify:cors-pop`) remains **mandatory pre-deploy gate** — see `docs/AUTH_ROLLOUT_GATES.md`, `scripts/verify-prod-auth-gate.sh`. Not tracked as open PEND.

**Residual (non-blocker):** CI job for cors-pop optional; artist-portal/strmhaha hardcoded CORS audit when those surfaces gain PoP.

### PEND-SEC-016 — PoP canonicalization matrix (client ↔ gateway contract)

**Priority:** critical  
**Status:** **closed (2026-06-08)** — superseded by SEC-013 browser DoD + unit contract tests (not open debt)

**Evidence for closure:**
- FE/Go sync tests in repo: `authDeviceCrypto.test.js`, `device_proof_canonical_test.go` — profile, `Charli%20XCX`, `A%24AP%20Rocky`, unicode, query params.
- SEC-013 browser DoD check #2–3 validates hot `/api/profile` with proof access token in real browser.
- Recovery: `deviceProofRecovery.test.js` + `middlewareStackOrder.test.js` (max 1 retry).

**Residual (non-blocker, not open PEND):** full artist `%20/%24` browser matrix — manual section in `scripts/verify-prod-auth-gate.sh`; run on prod deploy. Dedicated `_resolveDeviceProofHeaders` unit test — optional follow-up.

### PEND-SEC-015 — Refresh + client PoP contract

**Priority:** critical  
**Status:** **closed (2026-06-08)** — SEC-013 browser DoD check #4

**Evidence:**
- Playwright DoD: `POST /api/auth/refresh` with full ECDSA → **204**; proof-access-token-only → **401** (`device-proof-access-token-dod.spec.js`).
- Gateway unit: `device_proof_test.go` — refresh without proof → 401 `DEVICE_PROOF_REQUIRED`.

**Residual (non-blocker):** dedicated unit test on `_resolveDeviceProofHeaders` — optional follow-up, not deploy blocker.

### PEND-SEC-005 — WS/HLS scoped tickets (device-bound stream auth)

**Priority:** critical  
**Status:** **Phase 7 prod ENFORCE closed (2026-06-10 VPS)** — stream bytes require scoped ticket; legacy cookie → 401

**Goal:** bind WS upgrade and playback bytes to epoch-aware scoped tickets; remove cookie-only sufficient auth on consume paths.

**Design:** `docs/SEC-005_WS_STREAM_TICKETS_DESIGN.md` — accepted in `DECISIONS.md` 2026-06-08.

**Implementation phases (gated):**

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Gateway `POST /api/auth/stream-ticket` mint + unit tests; `STREAM_TICKET_ENABLED=0` default | done |
| 2 | OBSERVE — mint on auth-e2e overlay; `verify-stream-ticket.sh`; structured mint logs | **done (2026-06-09 restore prod PASS)** |
| 3 | ACCEPT — direct-stream/ebap-hls dual-mode verify | **done (2026-06-09 VPS `f9da305`)** |
| 4 | Frontend mint + attach (`streamTicket.js`, opt-in flag) | **closed (2026-06-09 VPS `727be49`)** — `npm run run:sec005-phase4-staging` PASS |
| 5 | Staging ENFORCE | **closed (2026-06-09 VPS)** — `npm run run:sec005-phase5-staging` PASS |
| 6 | Prod ACCEPT (dual-mode) | **closed (2026-06-10 VPS)** — `verify:stream-ticket-phase6-prod` PASS |
| 7 | Prod ENFORCE | **closed (2026-06-10 VPS)** — `verify:stream-ticket-phase7-prod` PASS |
| 8 | WS connect tickets | **implemented (2026-06-10)** — device-sync ACCEPT + frontend mint; gate `npm run verify:stream-ticket-ws-accept` |

**VPS close report — Phase 3 ACCEPT (`ru-vmv2-mini`, 2026-06-09, git `f9da305`):**

```text
verify:stream-ticket-accept:        PASS (ticket 200, garbage 401, legacy cookie 200)
restore-prod-after-auth-e2e.sh:     exit 0
STREAM_TICKET_ACCEPT (prod):        empty (direct-stream + ebap-hls)
STREAM_TICKET_ENABLED/OBSERVE:      empty (prod norm)
verify:frontend-api-base:           PASS
verify:stream-ticket prod gate:     PASS (POST mint → 404)
EARFLOW_API_BASE_URL:               empty
COOKIE_DOMAIN:                      .earflow.ru
```

**Prior VPS close — Phase 2 OBSERVE (`0d59f54`):** restore + prod mint 404 + frontend API base guard PASS.

**After any auth-e2e / capacity run** (when **not** in Phase 6 soak):

```bash
bash scripts/restore-prod-after-auth-e2e.sh
```

**During Phase 6 soak:** use `npm run verify:sec005-prod-health` — **do not** run `restore-prod` (split-brain: frontend mint:1 + gateway mint off → 404).

**VPS close report — Phase 6 prod ACCEPT (`ru-vmv2-mini`, 2026-06-10, git `1852924`):**

```text
verify:stream-ticket-phase6-prod:   PASS
STREAM_TICKET_ENABLED (prod):       1 (api-gateway)
STREAM_TICKET_ACCEPT (prod):        1 (direct-stream + ebap-hls)
STREAM_TICKET_ENFORCE (prod):       0
bundle main.f34684ea.js:            earflow:stream-ticket-mint:1
accept-consume prod:                ticket 200, garbage 401, legacy cookie 200
verify:frontend-api-base:           PASS
```

**VPS close report — Phase 7 prod ENFORCE (`ru-vmv2-mini`, 2026-06-10):**

```text
run:sec005-phase7-prod-enforce:     PASS
verify:sec005-prod-health (phase7): PASS
enforce-consume prod:               ticket 200, legacy cookie 401 STREAM_TICKET_REQUIRED
bundle main.4a14585e.js:            mint:1
direct-stream + ebap-hls ENFORCE:   1
override symlink:                   docker-compose.stream-prod-enforce.yml
```

**Next:** VPS `git pull` + `npm run run:auth-wave-b-prod-deploy`. WS ENFORCE (legacy JWT off) — future gate. Level 3: SEC-006–009.

**Rollback Phase 7 → Phase 6:** `SEC005_PHASE7_ROLLBACK_CONFIRM=1 npm run rollback:sec005-phase7-prod`  
**Weekly health:** `npm run verify:sec005-prod-health` (expect `mode: phase7`)

**v1 scope:** listener web SPA only.

### PEND-SEC-006 — WebAuthn/passkey step-up

**Priority:** medium  
**Status:** not started  

Отдельно от PoP. DoD: roadmap §6.

### PEND-SEC-007 — New-session confirmation (deferred — no email/in-app alerts v1)

**Priority:** medium  
**Status:** deferred (2026-06-09) — **not** email/in-app alerts in current wave  

**Target:** новый sid → подтверждение через **Telegram-бота** (пользователь должен иметь привязанный TG + активировать бота). Без подтверждения — ограниченная сессия или step-up на sensitive. Ops bot (`TELEGRAM_OPS_*`) — отдельно от user-facing confirm flow.

**Not in scope now:** Wave A/B/C transport + sessions; SEC-007 после SEC-005 ENFORCE + SEC-004 password step-up.

### PEND-SEC-008 — Risk engine

**Priority:** medium  
**Status:** not started  

Scoring без auto-logout на VPN/mobile network.

### PEND-SEC-009 — XSS hardening (CSP, Trusted Types)

**Priority:** medium  
**Status:** not started  

### PEND-SEC-010 — Security audit log + metrics

**Priority:** medium  
**Status:** not started  

---

## Шаблон для новой записи

```
### PEND-<AREA>-<NUM> — Краткое описание

**Priority:** high | medium | low
**Status:** not started | in progress | ready, не сделано | blocked

Контекст в 1-3 предложения. Что нужно. Чем заблокировано (если есть).
```
