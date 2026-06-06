# Pending — известный архитектурный долг и нереализованные задачи

**Назначение:** единый список того, что **мы знаем что не сделано** или сделано временно. Альтернатива разбросанным `TODO` / `FIXME` в коде.

**Правила:**
- Запись добавляется когда обнаружен gap, временное решение, или отложенная фича.
- Запись удаляется когда задача выполнена (с упоминанием в `DECISIONS.md`).
- AI-агент **должен** проверить этот файл перед добавлением `// TODO` в код. Любой `TODO` в коде — это нарушение; место для него здесь.

**Формат:** `[ID] Область — Описание — Priority — Notes`.

---

### PEND-STAB-001 — Prod auth stabilization (ACTIVE FREEZE)

**Priority:** critical  
**Status:** **active** — blocks PEND-SEC-011, PEND-SEC-012, PEND-SEC-013 and all new security phases until closed

**Problem:** PoP/CORS fixes were partially on VPS via rsync/manual copy without git SHA. Prod auth is **not green** (artists 401, ErrorBoundary observed).

**Allowed work only:**

- Single git commit / SHA for PoP stabilization bundle (nginx CORS maps, frontend canonical path, recovery order, `ensureAuthDeviceRegistered(opts)`, refresh PoP, ErrorBoundary/SW bump if needed)
- Deploy VPS from `git pull` or immutable image tag — **not** rsync/sed as final state
- Run gates: `npm run verify:prod-auth-gate` + manual browser matrix below

**Automated gate:** `scripts/verify-prod-auth-gate.sh` → `npm run verify:prod-auth-gate`

**PoP release file manifest (must match deployed SHA):**

| Area | Paths |
|------|--------|
| Nginx CORS/PoP | `nginx/conf.d/10-global-maps.conf`, `nginx/nginx.conf` |
| CORS script | `scripts/verify-cors-pop-preflight.sh` |
| Frontend canonical | `frontend/src/auth/authDeviceCrypto.js`, `frontend/src/auth/__tests__/authDeviceCrypto.test.js` |
| Recovery + order | `frontend/src/api/http/createApiHttpClient.js`, `frontend/src/api/http/middlewares/deviceProofRecovery.js`, `*.test.js` |
| Client wiring | `frontend/src/api/client.js` |
| Debug deploy | `frontend/src/components/ErrorBoundary.js`, `frontend/public/sw.js` (SW version bump) |
| Gateway contract | `backend/go-api-gateway/internal/auth/device_proof_canonical_test.go` |

**Do not close until:** browser gate green (see script output) + report includes git SHA + `main.*.js` on earflow.ru **and** auth.earflow.ru + no ErrorBoundary.

**Blocked until close:** PEND-SEC-011 rollout, epoch revoke, Proof Access Token, WebAuthn, fresh-login phases.

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

**Ops notes:** e2e overlay requires `COOKIE_DOMAIN=host` (not empty) when `NODE_ENV=production` — empty defaults to `.earflow.ru` in `config.go`. Artifacts: `artifacts/auth-e2e/`, `frontend/e2e/artifacts/auth-fullstack/`.

Real stack: gateway + Redis + security-service + auth login + frontend + `auth-e2e-edge`. **No** seed-session, **no** `/e2e/fixture`, **no** mock.

### PEND-SEC-011 — Postgres SoT (sessions/devices/refresh/events)

**Priority:** critical  
**Status:** prepared / code-ready — **not closed** (server rollout + review checklist required)

**PoP rollout (2026-06):** nginx CORS + frontend refresh PoP fixes are **prepared in repo**, **not prod-validated**. Do not close 011 or declare auth green until **PEND-SEC-014** passes on target host and browser gate below is green.

**Done in repo:** migration `003_auth_postgres_sot.sql`; `docs/AUTH_POSTGRES_SOT.md` (strict review table); `authpg` + `AuthSoT`; internal API; gateway hooks; backfill + dry-run; **revoke fail-safe** (always Redis cleanup); frontend refresh PoP + nginx `$earflow_cors_auth_*` maps (pending prod).

**Do not close until (all):**

1. VPS: migration `003` → backfill → `AUTH_PG_SOT_MODE=dual_write` → recreate gateway + security-service  
2. PEND-SEC-001 regression with `dual_write` (`run-auth-fullstack-e2e.sh`)  
3. **PEND-SEC-014:** `npm run verify:cors-pop` (or script) green on prod/staging  
4. **Browser gate:** login → device/register 200 → refresh 204 → profile 200 → artists 200 → ebap-hls session no CORS → stream/v3 session 200 → Account tab no redirect → revoke-other leaves current session (check response body on 403)  
5. UI revoke one/others (selected 401 on revoked sid, current 200; revoke-others)  
6. Logs: PG upsert/revoke errors visible on server  
7. Metrics (or tracked follow-up): `auth_pg_upsert_session_error_total`, `auth_pg_upsert_device_error_total`, `auth_pg_revoke_error_total`, `auth_pg_backfill_total`, `auth_pg_backfill_error_total` — today **Warn only**  
8. **sid/jti at rest (decision):** **Variant A accepted for VPS/staging rollout** — raw opaque lookup keys in PG (documented in `AUTH_POSTGRES_SOT.md`); refresh JWT not in PG. **Variant B (sid_hmac/jti_hmac)** required before strict security sign-off / final prod if policy mandates hash-only identifiers  

**Rollback:** `AUTH_PG_SOT_MODE=off` + recreate gateway/security.

**After close:** PEND-SEC-012 (epoch + pub/sub). **PEND-SEC-013 Proof Token blocked until 011 + 012.**

### PEND-SEC-012 — Epoch revoke + Redis pub/sub

**Priority:** critical  
**Status:** not started  

`sessionEpoch`/`deviceEpoch` в PG; RevokeSessionFull bump; gateway replicas invalidate <2s. **Before Proof Access Token.**

### PEND-SEC-013 — Proof Access Token (hot path)

**Priority:** high  
**Status:** not started  
**Blocked by:** PEND-SEC-011, PEND-SEC-012  

Short-lived token; local verify; no Redis SETNX on normal GET. Strict proof on sensitive/login/refresh.

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

### PEND-SEC-014 — CORS/PoP nginx preflight matrix (deploy gate)

**Priority:** critical  
**Status:** in progress (script + maps in repo; **not prod-green**)

**Why:** PoP добавил `X-Auth-Device-*` на широкий `/api/*`, но nginx имеет **много отдельных `location`** с ручным `Access-Control-Allow-Headers`. Точечные фиксы (`stream/v3`, потом `ebap-hls`) — симптом; нужен **обязательный gate** перед каждым auth/nginx deploy.

**Script:** `scripts/verify-cors-pop-preflight.sh` → `npm run verify:cors-pop`

**On VPS when public 443 is down:** `API_BASE=https://127.0.0.1:8443 CURL_INSECURE=1 npm run verify:cors-pop` (tests nginx CORS without public DNS). **curl (7) on all routes = nginx not listening**, not missing Allow-Headers.

**Matrix (minimum):**

| Route | OPTIONS must allow |
|-------|-------------------|
| `/api/stream/v3/session` | PoP + CSRF + Content-Type |
| `/api/stream/v2/session` | PoP + CSRF |
| `/api/ebap-hls/v1/session` | PoP + CSRF + X-Lyrics-Key |
| `/api/stream/v2/crypt/*` | PoP (+ Range where applicable) |
| `/api/auth/refresh` | PoP + CSRF |
| `/api/auth/sessions/revoke` | PoP + CSRF |
| `/api/auth/sessions/revoke-others` | PoP + CSRF |
| `/api/profile`, `/api/artists/*` | PoP + CSRF (general `/api/` location) |

**Also before deploy:** `docker compose run --rm --no-deps nginx nginx -t` (catches invalid maps like `$unused`).

**Remaining hardcoded CORS (audit):** `auth.earflow.ru` artist-portal blocks, legacy `/api/ebap/v3/*` (410), `strmhaha` audio-only Range headers — PoP not required there today; document when adding auth to those surfaces.

**DoD:** script exits 0 on staging/prod; CI job optional follow-up; no new nginx OPTIONS block without `$earflow_cors_auth_*` or explicit exemption in this PEND.

### PEND-SEC-016 — PoP canonicalization matrix (client ↔ gateway contract)

**Priority:** critical  
**Status:** in progress (unit tests in repo; **not prod-validated**)

**Why:** CORS green ≠ auth green. PoP fails on real URLs when client canonical string ≠ gateway `buildCanonicalProofString(method, r.URL.Path, r.URL.Query(), ...)`.

**Contract tests (keep in sync):**

| Case | FE test | Go test |
|------|---------|---------|
| `/api/profile` | `authDeviceCrypto.test.js` | `device_proof_canonical_test.go` |
| `Charli%20XCX` meta/tracks + query | same | same |
| `A%24AP%20Rocky` | same | same |
| Unicode artist | same | same |

**Recovery:** `deviceProofRecovery.test.js` + `middlewareStackOrder.test.js` — max **1** retry; **must be innermost before `throwApiErrors`** (otherwise recovery never sees 401 body).

**Prod gate (browser):** artists meta/tracks with `%20/%24`, refresh 204, stale sidHash → register → single retry → 200.

**Not closed until:** frontend redeploy + browser matrix green; no infinite register loop in DevTools.

### PEND-SEC-015 — Refresh + client PoP contract (deploy gate)

**Priority:** critical  
**Status:** partial

**Backend (done):** `device_proof_test.go` — refresh without proof → 401 `DEVICE_PROOF_REQUIRED`; e2e `device-proof-fullstack.spec.js` / live gateway spec.

**Frontend (prepared, not prod-validated):** `_refreshSessionCore` must attach PoP; `deviceProof` middleware must auto `device/register` when key missing. **Gap:** no dedicated unit test on `_resolveDeviceProofHeaders` / refresh fetch headers.

**Gate:** after login, `POST /api/auth/refresh` → **204** (not 401); cookie-only refresh without proof → 401 (gateway test). Re-login only acceptable for **one-time migration**, not per release.

### PEND-SEC-005 — WS/stream proof/ticket

**Priority:** high  
**Status:** not started  

**After PEND-SEC-013.** Cookie-only bypass на `/ws/*` и stream.

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
