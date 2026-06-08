# Pending — известный архитектурный долг и нереализованные задачи

**Назначение:** единый список того, что **мы знаем что не сделано** или сделано временно. Альтернатива разбросанным `TODO` / `FIXME` в коде.

**Правила:**
- Запись добавляется когда обнаружен gap, временное решение, или отложенная фича.
- Запись удаляется когда задача выполнена (с упоминанием в `DECISIONS.md`).
- AI-агент **должен** проверить этот файл перед добавлением `// TODO` в код. Любой `TODO` в коде — это нарушение; место для него здесь.

**Формат:** `[ID] Область — Описание — Priority — Notes`.

---

### PEND-WAVE-001 — Server-side waveform peaks for hero / seek UI

**Priority:** medium  
**Status:** in progress (API + transcode-worker; backfill `waveform_status=pending` on existing catalog)

**Implemented:** `waveform_peaks` JSONB on `songs`, generation in `transcode-worker` (ffmpeg), `GET /api/songs/:id/waveform`, frontend `useTrackWaveformPeaks` → API only.

**Remaining:** one-time backfill for tracks uploaded before migration (`UPDATE songs SET waveform_status='pending' WHERE waveform_peaks IS NULL AND is_available`).

---

## Streaming / Home UI (closed)

## DeviceSync / Playback

### PEND-DS-001 — Этап 2: единый `player_state` frame

**Priority:** high
**Status:** not started

Backend сейчас публикует 5 типов frames: `np:update`, `devices:active`, `devices:update`, `lease:update`, `transfer:update` с разными revision counter-ами (`stateRevision`, `activeRevision`, `updatedAtMs`). Это источник микро-флика при transfer.

**Что нужно:**
- Ввести `player_state` frame на backend как union всех 5 объектов с единым `frameRev` (монотонный).
- Старые frames оставить как deprecated на 1 релиз для совместимости.
- Frontend переписать на чтение одного объекта вместо 4 раздельных state-полей.

**Blocks:** Spotify-parity feel (volume sync, seek sync через все devices).

### PEND-DS-002 — Volume per-device на backend

**Priority:** medium
**Status:** not started

Сейчас volume — local state в `PlayerContext`, не синхронизируется между устройствами. У Spotify volume хранится per-device в backend `PlayerState`.

**Что нужно:**
- `cmd:set_volume` уже существует, но backend не персистит `volume_per_device`.
- Добавить в `PlayerState` (после PEND-DS-001) и публиковать в `player_state` frame.

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

**Blocks by:** PEND-DS-001 (после single-frame модели многое упростится).

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

**Known risks (accepted for hot-path optimization, not closed):** token replay within TTL (~90s) if XSS/extension steals header; WS/stream still cookie-only (`PEND-SEC-005`); artist-frontend has no proof token cache.

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
**Status:** partial (sessions list/revoke/revoke-others + UI; нет revoke-all, auth/devices API)

DoD: см. roadmap §2.

### PEND-SEC-003 — Fresh-login protection

**Priority:** high  
**Status:** not started  

Mass revoke с сессии <24h → step-up или block. Codes: `FRESH_LOGIN_REQUIRED` / `MFA_STEP_UP_REQUIRED`.

### PEND-SEC-004 — MFA step-up modal (UI)

**Priority:** high  
**Status:** not started  

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
**Status:** **Phase 2 OBSERVE closed (2026-06-08, VPS `ru-vmv2-mini`)** — Phase 3 ACCEPT not started

**Goal:** bind WS upgrade and playback bytes to epoch-aware scoped tickets; remove cookie-only sufficient auth on consume paths.

**Design:** `docs/SEC-005_WS_STREAM_TICKETS_DESIGN.md` — accepted in `DECISIONS.md` 2026-06-08.

**Implementation phases (gated):**

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Gateway `POST /api/auth/stream-ticket` mint + unit tests; `STREAM_TICKET_ENABLED=0` default | done |
| 2 | OBSERVE — mint on auth-e2e overlay; `verify-stream-ticket.sh`; structured mint logs | **done (VPS validated 2026-06-08)** |
| 3 | ACCEPT — direct-stream/ebap-hls dual-mode verify | **next — not started** |
| 4+ | Frontend mint, ENFORCE | blocked until Phase 3 |

**VPS validation report (`ru-vmv2-mini`, git `319156c`):**

```text
prod verify:stream-ticket:     PASS (STREAM_TICKET_ENABLED off → POST mint 404)
auth-e2e verify:stream-ticket: PASS (media/stream_session/ws mint 200; ws token-only 401)
logs ticket leakage:           not captured in run — grep stream_ticket_mint recommended
playback unchanged:            assumed PASS (no consume code in Phase 2)
```

**Note:** During auth-e2e run, public `api.earflow.ru` mint probe returned **403** (gateway had `STREAM_TICKET_ENABLED=1` from overlay — expected). **After e2e testing:** `bash scripts/restore-prod-after-auth-e2e.sh` to reset prod gateway/frontend.

**Forbidden until Phase 3 reviewed:** ENFORCE, cookie fallback removal, WS unify, iOS/artist implementation.

**v1 scope:** listener web SPA only.

### PEND-SEC-006 — WebAuthn/passkey step-up

**Priority:** medium  
**Status:** not started  

Отдельно от PoP. DoD: roadmap §6.

### PEND-SEC-007 — Login alerts

**Priority:** medium  
**Status:** not started  

Новый sid → email + in-app security event.

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
