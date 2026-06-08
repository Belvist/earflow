# Архитектурные решения (Decision Log)

**Назначение:** append-only журнал архитектурных решений с историческим контекстом. AI-агент **обязан** делать `grep` по этому файлу при любой задаче, связанной с listed-областью, чтобы не повторить ошибки и не "переоткрыть" уже принятые решения.

**Формат записи:**

```
## YYYY-MM-DD — Краткое название

**Status:** accepted | superseded-by-<id> | reverted
**Area:** device-sync | auth | gateway | streaming | frontend-player | ...
**Context:** что было до, какая проблема
**Decision:** что решили
**Alternatives considered:** что отвергли и почему
**Consequences:** что изменилось в коде/UX/нагрузке
**Files touched:** список ключевых файлов
**Tests:** список ключевых тестов
**Чтобы не повторилось:** какой инвариант добавлен в ARCHITECTURE_INVARIANTS.md
```

Записи идут **сверху вниз от новых к старым**.

---

## 2026-06-08 — SEC-005 Phase 2 OBSERVE closed (VPS mint gates)

**Status:** accepted  
**Area:** auth | gateway | streaming  

**Context:** Phase 1 gateway mint committed (`cd740b3`); Phase 2 OBSERVE committed (`9f8eeff`, docs `319156c`). Mint must be validated on VPS in prod-off and auth-e2e-on modes before Phase 3 ACCEPT.

**Decision:** **SEC-005 Phase 2 OBSERVE validated** on VPS `ru-vmv2-mini`: auth-e2e overlay `STREAM_TICKET_ENABLED=1` → media/stream_session/ws (full ECDSA) mint **200**, ws proof-token-only **401**. Prod-off gate (404) passed before e2e overlay. **Final close** only after `restore-prod-after-auth-e2e.sh` confirms `STREAM_TICKET_ENABLED` off + verify gates PASS.

**Alternatives considered:** Mark closed immediately after e2e PASS — rejected; e2e overlay leaves prod gateway with mint enabled until restore.

**Consequences:** Phase 3 ACCEPT (direct-stream/ebap-hls dual-mode) is next. **Do not** enable `STREAM_TICKET_ENABLED` on prod until Phase 5+ staging plan. After auth-e2e runs, **`restore-prod-after-auth-e2e.sh`** mandatory.

**Files touched:** `scripts/verify-stream-ticket.sh`, `scripts/stream-ticket-verify/mint-observe.mjs`, `docker-compose.auth-e2e.yml`.

**Tests:** `npm run verify:stream-ticket` PASS prod + auth-e2e on VPS.

**Чтобы не повторилось:** auth-e2e overlay flips public mint probe from 404→403; always restore prod stack after e2e.

---

## 2026-06-08 — SEC-005 rev.2 stream ticket design accepted (implementation gated)

**Status:** accepted (design only — **no consume enforcement yet**)  
**Area:** auth | gateway | streaming | security  

**Context:** SEC-013 + capacity closed. WS/stream consume paths still use cookie/token without `authDeviceId` + epoch binding. Rev. 1 design had three risks: header-only for media, per-segment epoch lookup, HS256 secret sprawl without explicit v1 debt.

**Decision:** Accept **SEC-005 rev.2** (`docs/SEC-005_WS_STREAM_TICKETS_DESIGN.md`) as binding architecture for implementation. Three ticket types: `stream_session_ticket` (header JWT), `media_access_ticket` (opaque query/signed URL), `ws_connect_ticket` (opaque one-time query). Gateway mints via `POST /api/auth/stream-ticket`. Proof access token allowed for `stream_session` + `media` mint; `ws_connect` requires full ECDSA. Consume: local verify + local epoch/revoke cache + pub/sub — **no** `epochs/lookup` per segment. Migration: OBSERVE → ACCEPT → ENFORCE; ENFORCE rejects cookie-only. v1 implementation: listener web SPA only; iOS/artist contract-only.

**Alternatives considered:** Header-only tickets for HLS — rejected. Per-segment PG lookup — rejected. Single universal ticket format — rejected. HS256 as final architecture — rejected (v1 temp only if used, must record removal milestone).

**Consequences:** Phase 1 = gateway mint only (no direct-stream/ebap-hls/frontend enforce). `PEND-SEC-014/015/016` closed as superseded by SEC-013 browser DoD + unit tests — **not** claimed as separate full prod artist `%20/%24` browser artifact.

**Files touched:** `docs/SEC-005_WS_STREAM_TICKETS_DESIGN.md`, `docs/PENDING.md`, `docs/DECISIONS.md`.

**Tests:** design §17 checklist 8/8 PASS; implementation tests start Phase 1 gateway unit tests.

**Чтобы не повторилось:** JWT in query forbidden; per-segment epoch lookup forbidden; ENFORCE without cookie fallback only after ACCEPT phase gates.

---

## 2026-06-08 — Auth hot-path capacity gate closed (PEND-SEC-CAPACITY-001)

**Status:** accepted  
**Area:** auth | ops | gateway  

**Context:** SEC-013 Proof Access Token closed browser DoD 8/8; scale claims were blocked until measured hot-path capacity on staging profile (`INV-SEC-017`).

**Decision:** Close `PEND-SEC-CAPACITY-001` on VPS `ru-vmv2-mini` auth-e2e profile (git `250e256`). Validated: 2× api-gateway, 20 sessions, ~500 RPS hot GET `/api/profile` with proof access token — p95 **6.18 ms**, error rate **0.000%**; cold proof/token p95 **40.8 ms**; refresh p95 **34.3 ms**; revoke → 401 first observed **25 ms**.

**Alternatives considered:** Claim «millions-ready» from single-node k6 — rejected.

**Consequences:** `reports/auth-capacity-20260608.md`; `scripts/run-auth-capacity.sh` + `scripts/verify-auth-capacity.sh` are the repeatable gate. Next security epic: **SEC-005** WS/HLS scoped tickets (plan before implementation).

**Files touched:** `scripts/auth-capacity/*`, `scripts/run-auth-capacity.sh`, `docker-compose.auth-e2e.yml`, `reports/auth-capacity-20260608.md`.

**Tests:** k6 hot path; Node cold path + revoke latency; `verify-auth-capacity.sh` PASS.

**Чтобы не повторилось:** Forbidden language list in report template — not «Redis never bottleneck» / not «production scale proven».

---

## 2026-06-08 — auth-e2e-edge nginx dynamic DNS after gateway recreate

**Status:** accepted  
**Area:** ops | nginx | auth-e2e  

**Context:** `CAPACITY_SKIP_STACK=1` runs `force-recreate api-gateway` without restarting `auth-e2e-edge`. Nginx `proxy_pass http://api-gateway:3000` resolved DNS once at edge start; new gateway container IPs → edge kept stale upstream → persistent **502** on `/api/*` while `/health` (local nginx) stayed 200.

**Decision:** `nginx/auth-e2e-edge.conf` uses Docker embedded resolver `127.0.0.11` + variable upstream (`$api_upstream`, `$fe_upstream`) so DNS re-resolves. Capacity runner recreates `auth-e2e-edge` whenever gateway is force-recreated. `auth-e2e-wait-healthy.sh` probes `GET /api/version` through edge, not only `/health`.

**Alternatives considered:** Manual `docker restart auth-e2e-edge` only — rejected as easy to forget.

**Consequences:** Any auth-e2e workflow that recreates gateway must recreate or restart edge until dynamic DNS config is deployed.

**Files touched:** `nginx/auth-e2e-edge.conf`, `scripts/run-auth-capacity.sh`, `scripts/auth-e2e-wait-healthy.sh`, `scripts/auth-e2e-bootstrap.sh`.

**Tests:** manual — login `HTTP 200` after gateway+edge recreate on `ru-vmv2-mini`.

**Чтобы не повторилось:** ops note in `PEND-SEC-001`; wait-healthy api/version probe.

---

## 2026-06-08 — SEC-013 Proof Access Token fully closed (browser DoD + capacity)

**Status:** accepted  
**Area:** auth | gateway | frontend  

**Context:** Implementation landed earlier; phase remained «partial» until browser DoD 8/8 and capacity gate.

**Decision:** Mark **SEC-013 closed** when both hold: Playwright/browser DoD PASS (2026-06-08) and `PEND-SEC-CAPACITY-001` PASS on auth-e2e profile. Prod hot path uses `X-Auth-Proof-Access-Token` on GET `/api/profile`; sensitive routes remain full ECDSA.

**Consequences:** WS/stream cookie-only bypass is the next tracked gap (`PEND-SEC-005`).

**Files touched:** see prior SEC-013 decision; capacity artifacts under `artifacts/auth-capacity/`.

**Tests:** `device-proof-access-token-dod.spec.js` 8/8; `run-auth-capacity.sh` PASS.

---

## 2026-06-08 — Auth rollout gate discipline (prepared ≠ closed)

**Status:** accepted  
**Area:** auth | ops | ai-discipline  

**Context:** PoP rollout on wide `/api/*` with narrow verification caused CORS/artists/refresh/stream/Account regressions. Agents marked phases «closed» after backend/script PASS without browser DoD. User verdict: architecture direction correct, process was undisciplined.

**Decision:** Canonical gates in `docs/AUTH_ROLLOUT_GATES.md` + `INV-SEC-016`/`INV-SEC-017`. SEC-013 closes only on **8/8 browser DoD** (Playwright `run-auth-proof-token-browser-dod.sh` or DevTools). No «ready for millions» until capacity report. WS/stream tickets (SEC-005) only after SEC-013 + capacity.

**Alternatives considered:** Close SEC-013 on `verify-auth-proof-token.sh` alone — rejected.

**Consequences:** `.cursor/rules/earflow-auth-rollout-gates.mdc`; browser DoD e2e spec; agents must report gate status explicitly.

**Files touched:** `docs/AUTH_ROLLOUT_GATES.md`, `docs/ARCHITECTURE_INVARIANTS.md`, `frontend/e2e/device-proof-access-token-dod.spec.js`, `scripts/run-auth-proof-token-browser-dod.sh`.

**Tests:** `device-proof-access-token-dod.spec.js` (8 checks).

**Чтобы не повторилось:** `INV-SEC-016`, `INV-SEC-017`.

---

## 2026-06-08 — Proof Access Token (PEND-SEC-013, hot path) — **partial until browser DoD**

**Status:** accepted (implementation); **phase partial** until browser DoD 8/8  
**Area:** auth | gateway | security-service | frontend  

**Context:** PoP MVP verified every authenticated `/api/*` with ECDSA + Redis SETNX per nonce — correct for security, but Redis-bound at scale. Postgres SoT (011) and epoch revoke pub/sub (012) provide durable `sessionEpoch`/`deviceEpoch` for stale-token invalidation without per-request SETNX.

**Decision:** Add `POST /api/auth/proof/token`: client exchanges **full ECDSA proof once** → short-lived HS256 JWT (`type=proof_access`, ~90s) with `sid`, `authDeviceId`, epochs. Hot-path middleware verifies JWT locally + epoch cache (fed by PG lookup on exchange + revoke pub/sub). **Sensitive paths** (logout, refresh, sessions revoke, password change, security overview, 2fa) always require full ECDSA + SETNX. Feature flag `PROOF_ACCESS_TOKEN_ENABLED` (default on).

**Alternatives considered:** Redis SETNX on every GET forever — rejected (scale). Skip epochs until PG SoT — rejected (012 prerequisite).

**Consequences:** ~95%+ GET traffic avoids nonce SETNX; stolen token valid only until TTL unless epoch bump; CORS/nginx must allow `X-Auth-Proof-Access-Token`.

**Files touched:** `proof_access_token.go`, `proof_token_http.go`, `proof_epoch_cache.go`, `device_proof_middleware.go`, `sot_client.go`, `authpg/store.go`, `handlers_internal_auth.go`, `frontend/src/auth/proofAccessToken.js`, `nginx/conf.d/10-global-maps.conf`, `scripts/verify-auth-proof-token.sh`.

**Tests:** `proof_access_token_test.go`; existing PoP suite green.

**Чтобы не повторилось:** sensitive-path list must stay aligned with `DeviceProofSensitivePaths()`; hot path must not add second PoP mechanism (INV-ARCH-001).

---

## 2026-06-07 — HLS segment CDN cache on strmhaha (signed /audio/v3/cache)

**Status:** accepted  
**Area:** streaming | direct-stream-service | nginx | cdn  

**Context:** Timeweb CDN on `strmhaha.earflow.ru` cannot cache per-session Bearer/cookie audio (`no-store`). Covers are poor CDN ROI vs tracks. Nginx already has `ebap_cache` on internal `/media/direct-hls/`.

**Decision:** Playlists stay authenticated (`/audio/v3/tracks/...`, `no-store`). Media playlists rewrite segment URIs to signed absolute URLs `/audio/v3/cache/{trackId}/{manifestHash}/{variant}/{asset}?exp=&sig=` with bucketed `exp` (7d default) so CDN/nginx share cache across users. Direct stream (`/audio/v3/direct/`) unchanged.

**CDN ops:** origin `origin.strmhaha.earflow.ru` (A→VPS); distribution `strmhaha.earflow.ru` (CNAME→CDN); cache query string ON; do not cache playlists/session API.

**Alternatives considered:** CDN origin `earflow.ru` — rejected (no `/audio/v3/`). CDN on full `strmhaha` without signed segment URLs — rejected (no cache hits, security risk).

**Files touched:** `backend/direct-stream-service/src/auth/hlsSegmentCache.ts`, `src/main.ts`, `src/config.ts`, `nginx/nginx.conf`, `scripts/verify-cdn-strmhaha.sh`.

**Tests:** `bun test src/auth/hlsSegmentCache.test.ts`.

---

## 2026-06-07 — Postgres auth SoT dual_write on prod (PEND-SEC-011 closed)

**Status:** accepted  
**Area:** auth | security-service | gateway | ops  

**Context:** PEND-SEC-011 required Redis+PG dual-write for sessions/devices before epoch revoke and Proof Token. Initial backfill failed on missing SQL `)` in `UpsertSession`; revoke-others missed PG-only/ghost sessions until enumerate merged Redis+PG.

**Decision:** Enable `AUTH_PG_SOT_MODE=dual_write` on VPS after migration 003, backfill (82 sessions), and fixes `ae79b2e`, `8f2a366`, `353bf4b`. Revoke/list enumerate Redis index + PG `auth_sessions`. Redis remains hot-path read; PG is durable SoT for revoke epoch bump.

**Evidence:** `backfill-live` 82/82; verify PASS; revoke-others PC ↔ iPhone; security-service logs clean (no pg/revoke SQL errors).

**Files touched:** `backend/security-service/internal/store/authpg/`, `internal/httpapi/helpers_sessions.go`, `scripts/rollout-auth-pg-sot.sh`, `scripts/verify-auth-pg-sot.sh`.

**Next:** PEND-SEC-012 epoch pub/sub across gateway replicas.

---

## 2026-06-05 — Prod auth green (PEND-STAB-001 closed)

**Status:** accepted  
**Area:** auth | ops | streaming  

**Context:** PoP/CORS rollout on prod required git-backed deploy, automated gates, and manual browser matrix before unblocking Postgres SoT and later security phases (`PEND-STAB-001` freeze).

**Decision:** Declare **prod auth green** after VPS deploy + gates + browser verification.

**Evidence (prod VPS, 2026-06-05):**

| Check | Result |
|-------|--------|
| Git SHA | `8abd852` (stream fix `4c018b9` deployed) |
| Bundle | `main.0105cf6b.js` on earflow.ru + auth.earflow.ru |
| `verify:prod-auth-gate` | PASS |
| `verify:cors-pop` | 9/9 PASS |
| Browser gate (manual) | login, profile, artists, account, playback, seek, strmhaha, no ErrorBoundary — all OK |

**Consequences:** `PEND-STAB-001` removed from `PENDING.md`. **Unblocked (planning only):** `PEND-SEC-011` Postgres SoT rollout — still requires its own migration/e2e checklist, not automatic prod deploy.

**Files touched:** `docs/PENDING.md`, `docs/DECISIONS.md`

**Чтобы не повторилось:** Deploy prod auth changes only from pinned git SHA; run `verify:prod-auth-gate` + browser matrix before declaring green.

---

## 2026-06-05 — One active session per authDeviceId (device register replaces stale sid)

**Status:** accepted  
**Area:** auth | gateway  

**Context:** Каждый re-login создавал новый `mp_sid`, старый оставался в `auth:user_sids` до TTL (до 1 года). При отладке PoP накопилось 39 «Chrome · Windows» с одного IP.

**Decision:** При `POST /api/auth/device/register`, если `authDeviceId` уже привязан к **другому** `sid` того же `userId`, gateway вызывает `RevokeSessionFull` для старого `sid` **до** сохранения новой привязки. Другие устройства (`authDeviceId`) и их сессии не трогаем.

**Alternatives considered:** Revoke all other sids on every login — отвергнуто (убило бы iPhone + desktop multi-device). Только UI «завершить другие» — недостаточно для повторных login на том же браузере.

**Consequences:** На одном браузере (стабильный IndexedDB key) — одна живая сессия. Сироты без `authDeviceId` (старые login до PoP) — только ручной «revoke others» или TTL.

**Files touched:** `go-api-gateway/internal/auth/device_http.go`, `device_register_session_test.go`.

**Tests:** `TestRevokeStaleSessionForAuthDevice_*`.

## 2026-06-05 — PEND-SEC-011 Postgres auth SoT (prepared, not closed)

**Status:** accepted (code-ready); **PEND not closed** until VPS rollout gate green  
**Area:** auth | security-service | database  

**Decision:** Postgres SoT in `003_auth_postgres_sot.sql`; `authpg` + internal `/internal/auth/v1/*`; `AUTH_PG_SOT_MODE=dual_write` as transitional mode; default `off`. Login/device upsert best-effort; **revoke fail-safe:** gateway always runs local `RevokeSessionFull` on Redis even if security/PG down. Backfill idempotent + `AUTH_PG_BACKFILL_DRY_RUN=1`. Proof Token **not** in scope.

**sid/jti at rest (Variant A for rollout):** raw opaque `sid`/`jti`/`auth_device_id` as PK in PG (lookup keys, same role as Redis); refresh JWT **not** stored in PG. Acceptable for VPS/staging rollout. **Variant B** (`sid_hmac`/`jti_hmac`, no raw) — separate change before strict security sign-off / final prod if policy requires hash-only.

**Alternatives considered:** Close 011 after repo merge only — rejected (no VPS evidence). Start Proof Token before 012 — rejected.

**Consequences:** Close PEND-SEC-011 only after: migration → backfill → `dual_write` → recreate gateway/security → PEND-SEC-001 e2e → UI revoke → logs. Then **PEND-SEC-012** epoch revoke. **PEND-SEC-013** blocked until 011+012.

**Docs:** `docs/AUTH_POSTGRES_SOT.md`, `INV-SEC-015`, `docs/PENDING.md`.

**Tests:** `TestContractRevokeSessionFull_ClearsRedisWhenSecuritySoTDown`; `auth_sot_test.go`; `authpg/store_test.go` (`DATABASE_URL`).

## 2026-06-05 — PEND-SEC-001 full-stack PoP e2e validated on VPS

**Status:** accepted  
**Area:** auth | testing | ops  

**Context:** Prepared 2026-06-04; server runs failed until gateway cookies were host-compatible (`COOKIE_DOMAIN=host` — empty + `NODE_ENV=production` implied `.earflow.ru`).

**Decision:** Close **PEND-SEC-001**. Production-path PoP e2e = `docker-compose.auth-e2e.yml` + `auth-e2e-edge` + real email login + Playwright two-context spec. Distinct from **PEND-SEC-001a** (harness + seed-session).

**Consequences:** Next roadmap item: **PEND-SEC-011** Postgres SoT (not Proof Access Token before 011+012).

**Validated:** VPS `ru-vmv2-mini` — `run-auth-fullstack-e2e.sh` PASS (1 test, ~4s).

**Files:** `docker-compose.auth-e2e.yml`, `nginx/auth-e2e-edge.conf`, `frontend/e2e/device-proof-fullstack.spec.js`, `popFullStack.browser.js`, `scripts/run-auth-fullstack-e2e.sh`, `docs/AUTH_FULLSTACK_E2E_RUNBOOK.md`.

## 2026-06-04 — PEND-SEC-001 full-stack e2e prepared (server run gate)

**Status:** superseded-by-2026-06-05-PEND-SEC-001-validated  
**Area:** auth | testing | ops  

**Decision:** Full-stack PoP e2e = docker overlay + real email login + Playwright two-context. Runbook: `docs/AUTH_FULLSTACK_E2E_RUNBOOK.md`.

## 2026-06-04 — PEND-SEC-000: route audit + spoofed header CI + prod bypass guard

**Status:** accepted  
**Area:** auth | gateway | ci  

**Decision:** Закрыть PEND-SEC-000 кодом: `validate-auth-prod-guard.js`; `route_pop_audit_test.go` (gateway `require_user` → PoP); `spoofed_headers_contract_test.go`; sanitizer расширен (`X-Artist-Id`, `X-Service-User`); duplicate `auth_sessions` route id удалён.

**Tests:** `go test ./internal/auth/ -run Route|Spoof|ProtectedAPI`; `node scripts/validate-auth-prod-guard.js`.

## 2026-06-04 — PoP live gateway harness (PEND-SEC-001a) + Web Crypto P1363 verify

**Status:** accepted  
**Area:** auth | gateway | testing  

**Context:** Нужен Playwright против **живого** Go middleware (не `popGatewayMock`). Mock e2e не проверял ECDSA. Go `verifyECDSAP256Signature` принимал только ASN.1 DER; Chrome `subtle.sign` отдаёт IEEE P1363 (64 байта) → `DEVICE_PROOF_INVALID`.

**Decision:** `pop-e2e-harness` с `//go:build pop_e2e_harness` (отдельный cmd, **не** в prod binary); Playwright `test:e2e:pop-live`; verify принимает **DER и P1363**. **PEND-SEC-001 full-stack (docker compose + login path) остаётся open.**

**Alternatives considered:** закрыть PEND-SEC-001 как harness — отвергнуто (не production path).

**Consequences:** Gateway middleware контракт проверен; full-stack e2e — отдельная задача.

**Files touched:** `pop_e2e_harness.go`, `cmd/pop-e2e-harness/`, `device_proof_crypto.go`, `e2e_routes_guard_test.go`, `device_proof_signature_test.go`, `validate-auth-prod-guard.js`.

**Tests:** `go test ./internal/auth/`, `go test -tags pop_e2e_harness`, `npm run test:e2e:pop-live`, `TestProductionGatewayBinaryExcludesE2EHarnessStrings`.

**Чтобы не повторилось:** не называть harness «full-stack»; `/e2e/*` только под build tag.

## 2026-06-04 — Auth work order: Proof Token after Postgres SoT + epoch

**Status:** accepted  
**Area:** auth | architecture  

**Context:** `AUTH_TARGET_ARCHITECTURE.md` принят, но порядок «e2e → Proof Token → WS» рискует построить scale на Redis-first без durable epoch.

**Decision:** Канонический порядок: invariants → live e2e → **Postgres SoT → epoch revoke pub/sub** → **Proof Access Token** → WS/stream → fresh-login → MFA → WebAuthn → alerts/risk/XSS/load. Proof Token **запрещён** до SoT+epoch.

**Files touched:** `docs/AUTH_TARGET_ARCHITECTURE.md`, `docs/SECURITY_ROADMAP.md`, `docs/PENDING.md` (PEND-SEC-011/012/013).

## 2026-06-04 — Security roadmap: финальная цель после PoP MVP

**Status:** accepted  
**Area:** auth | security | gateway | frontend | ops  

**Context:** Phase 0 revoke и Phase 1 PoP приняты как MVP. Active sessions UI — Phase 2 partial. Нужна единая зафиксированная цель без расплывания обсуждений.

**Decision:** Канонический документ — **`docs/SECURITY_ROADMAP.md`**. PoP не переделываем. Дальнейшая работа — 10 пунктов по приоритету (e2e живой stack → WS/stream → sessions revoke-all + MFA UX → fresh-login → alerts → WebAuthn → risk → XSS → observability). PEND-SEC-001..010 в `docs/PENDING.md`.

**Alternatives considered:** смешивать sessions и auth/devices в один API сразу — отложено; сначала sessions + e2e.

**Consequences:** Агенты и разработчики сверяются с roadmap, не переоткрывают PoP. UI: только «Это устройство», не «главное».

**Files touched:** `docs/SECURITY_ROADMAP.md`, `docs/PENDING.md`, `reports/SECURITY.md`, `AGENTS.md`.

**Tests:** roadmap §1 (full-stack e2e) — gate для security sign-off.

**Чтобы не повторилось:** grep `SECURITY_ROADMAP` перед новыми security-обсуждениями; mock e2e не считать финальным доказательством.

## 2026-06-04 — Listener active sessions UI + revoke-one API (Phase 2 partial)

**Status:** accepted
**Area:** auth | frontend | security-service | gateway
**Context:** PoP MVP закрыт, но пользователь не видел список сессий в listener SPA. Artist portal уже имел security-service sessions API; listener `gateway.yaml` не проксировал `/api/auth/sessions`.
**Decision:** Проксировать `/api/auth/sessions*` в listener gateway → security-service. Добавить `POST /api/auth/sessions/revoke` (single sid, не current). UI вкладка «Сессии» в Profile settings: текущее устройство + список других + revoke one / revoke others (Telegram-like, Earflow styling).
**Alternatives considered:** новый gateway handler — отвергнуто, security-service уже владеет session meta и `RevokeSessionFull`.
**Consequences:** Listener settings показывает реальные Redis sessions; revoke one/all-other через unified revoke.
**Files touched:** `gateway.yaml`, `security-service/internal/httpapi/handlers_sessions.go`, `frontend/src/components/Settings/ActiveSessionsSection.js`, `ProfilePage.js`, `api/client.js`.
**Tests:** `go test ./...` security-service; manual Profile → Настройки → Сессии.
**Чтобы не повторилось:** device management UI только через security-service sessions API, не дублировать Redis reads на frontend.

## 2026-06-04 — Session security: unified revoke + device-bound proof (PoP)

**Status:** accepted  
**Area:** auth | gateway | security | frontend  

**Context:** `mp_sid` + `mp_csrf` можно перенести в другой браузер; logout/revoke/password change чистили только `auth:*` или только `mp:sess:*`.

**Decision:**
- **Фаза 0:** `RevokeSessionFull(sid)` в gateway + security-service (+ auth-service JS): атомарно `mp:sess`, `auth:sid`, `auth:refresh`, meta, step-up, grace, `auth:sid_devices` / `auth:device`.
- **Фаза 1:** PoP MVP — `authDeviceId` (не device-sync `deviceId`), ECDSA P-256, IndexedDB non-extractable key, `POST /api/auth/device/register` (CSRF + sid, без proof), `DeviceProofMiddleware` на authenticated API, nonce `auth:pop_nonce:{authDeviceId}:{nonce}` TTL 120s.
- Register возвращает `sidHash` (HMAC sid); клиент хранит для canonical v1. **Multi-device:** `userId → many sid → many authDeviceId`; register **не** выкидывает другие устройства/сессии (только явный revoke).
- WS: `SessionAuth` пропускает cookie auth на `/ws/*` при enforced proof — только ticket path.
- **INV-SEC-010:** prod cookie-only fallback запрещён.

**Alternatives considered:** только shorter session TTL — не закрывает transplant; DPoP JWT — отложено, проще custom headers.

**Consequences:** Dev без keys → `DEVICE_PROOF_REQUIRED`; local/test: `ALLOW_COOKIE_AUTH_WITHOUT_PROOF=1` (gateway) / `REACT_APP_ALLOW_COOKIE_AUTH_WITHOUT_PROOF=1` (frontend).

**Files touched:** `go-api-gateway/internal/auth/session_revoke.go`, `device_proof_*.go`, `device_store.go`, `security-service/internal/store/session_revoke.go`, `frontend/src/auth/authDeviceCrypto.js`, `api/http/middlewares/deviceProof.js`.

**Tests:** `session_revoke_test.go`, `device_proof_test.go`, `authDeviceCrypto.test.js`.

**Чтобы не повторилось:** `INV-SEC-010` в `ARCHITECTURE_INVARIANTS.md`.

---

## 2026-06-04 — Player gestures final architecture (SNAPPING + unified album + chrome gate)

**Status:** accepted  
**Area:** frontend-player / gestures  

**Context:** Patch stack (v45–v47) split album H-swipe and V-dismiss across hooks; `snapToClosed` ставил `CLOSED` до spring; три ветки chrome (`controlsOpacity`, `chromeSettled`, `showPlayerControls`); `recoverInteraction` вызывался штатно после свайпов.

**Decision:**
- Фаза **`SNAPPING`** между finger-up и settled OPEN/CLOSED (`INV-SHEET-011`); `runSnap` ставит SNAPPING, `holdModalForCloseSnap` при close-snap.
- **Один** `useModalAlbumGestures`: intent lock H → track, V↓ → sheet dismiss API; удалён `useModalAlbumTrackSwipe`.
- Chrome: transport **mount** только `showPlayerControls` (`sheetOpen && !draggingFromMini`), без `controlsOpacity`/`chromeSettled`.
- Mini pan: `clearMiniPanSession` на sheet-closed; `recoverInteraction` только emergency (`visibility`, `emergency`, `track-swipe-error`).
- Док: `docs/GESTURE_OWNERSHIP_MATRIX.md`; PEND-SHEET-001 / PEND-GESTURE-001 / PEND-GESTURE-002 закрыты.
- E2e: `frontend/e2e/player-gestures-contract.spec.js`.

**Alternatives considered:** два surface на album (H + header-only V) — отвергнуто (Spotify-style dismiss с обложки).

**Consequences:** dismiss с центра обложки; interrupt snap новым drag; меньше force-recover.

**Files touched:** `playerSheetPhase.js`, `usePlayerSheetState.js`, `useModalAlbumGestures.js`, `MobilePlayerModal.js`, `useMiniPlayerPan.js`, docs, e2e.

**Tests:** `playerSheetArchitecture.test.js`, `player-gestures-contract.spec.js`, `npm run verify:player-mobile`.

**Чтобы не повторилось:** `INV-SHEET-011`; matrix `GESTURE_OWNERSHIP_MATRIX.md`.

---

## 2026-06-04 — Full player: album track swipe + expand flash + controls dock (v46)

**Status:** accepted  
**Area:** frontend-player  

**Context:** (1) Horizontal track swipe в open full player не работал — `useMiniPlayerPan` игнорирует pointer при `isSheetOpen`; dismiss на `ContentLayer` с `claimOnPointerDown` перехватывал жест на обложке. (2) Flash progress/play при expand — контролы монтировались в flex-колонке под обложкой и на кадр появлялись у верха sheet. (3) Controls визуально «прилипли» к обложке.

**Decision:** `useModalAlbumGestures` на `AlbumSection` (COVER_STACK priority 570): horizontal → next/prev, vertical → sheet dismiss API. Dismiss только на `ModalHeader` (`AFTER_INTENT_LOCK`, без claim on down). Mini pan: expand только при доминантном vertical up; без `beginSheetDrag` на pointerdown при partial modal. Flash: `showPlayerControls = sheetFullyOpen && !draggingFromMini` (не монтировать блок). Layout: `ControlsDock` с `margin-top: auto`. Build hint: `2026-06-v46-album-swipe-layout`.

**Alternatives considered:** расширить `useMiniPlayerPan` при OPEN — отвергнуто (смешивает L3 mini и full modal surfaces).

## 2026-06-04 — Full player: album track swipe + expand flash + controls spacing (v45)

**Status:** superseded-by-v46  
**Area:** frontend-player  

**Context:** (1) Horizontal track swipe не работал в open full player — `useMiniPlayerPan` делал `return` при `isSheetOpen`. На mini-bar ранний `session.intent = VERTICAL` при `dy < -4` блокировал horizontal. `beginSheetDrag('mini')` на каждый pointerdown при `modalVisible` мешал swipe. (2) Flash контролов при expand — `controlsOpacity` не был связан с `expandBodyGate`. (3) Controls слишком близко к обложке.

**Decision:** (черновик v45 — не деплоить) albumSwipeOnly в mini pan. Заменено v46.

**Alternatives considered:** отдельный gesture machine на album — принято в v46.

**Consequences:** swipe влево/вправо на обложке/названии в open player; dismiss вниз по album не блокируется; контролы ниже и с большими gap.

**Files touched:** `useMiniPlayerPan.js`, `miniPlayerGestureZone.js`, `MobilePlayerModal.js`, `MobilePlayerModal.styles.js`, `index.js`

**Tests:** `playerSheetArchitecture.test.js` (albumSwipeOnly)

**Чтобы не повторилось:** не ставить `isSheetOpen` early return без album zone; не assign `session.intent` до `classifyMiniBarSheetIntent`.

---

## 2026-06-03 — Mini-bar gestures: full rewrite to useMiniPlayerPan (INV-SHEET-010)

**Status:** accepted  
**Area:** frontend-player  

**Context:** v30–v37b — серия патчей поверх layered stack (gesture machine + capture routing + React shell handlers + window continuation). Симптомы: expand freeze ~50% над discover rails, mid-drag settle, TDZ crash (v37), prod «свайп мёртв». «Минимальный diff» удерживал старый stack вместо следования `docs/MOBILE_PLAYER_SHEET_DESIGN.md` §2.

**Decision:** **Удалить** legacy mini gesture stack. **Один** pan controller: `useMiniPlayerPan.js` — `document` capture `pointerdown` + `window` move/up; sheet API через `usePlayerSheetState` (`beginExpandPan`, `applySheetDragStep`, `settleDrag` только на pointerup). Session wiring: `useMiniPlayerGestureSession.js`. Build hint: `2026-06-v38-mini-player-pan-rewrite`.

**Alternatives considered:** ещё один слой capture-routing / continuation (v35–v37) — отвергнуто: накапливает control paths, не устраняет rail steal + modal dead zone.

**Consequences:** удалены `useMiniPlayerGestureMachine`, `useMiniPlayerGestures`, `useMiniPlayerGestureCoordinator`, `useMiniPlayerGestureCaptureRouting`; architecture test `INV-SHEET-010`; `validate:ai` блокирует возврат legacy файлов.

**Files touched:** `useMiniPlayerPan.js`, `useMiniPlayerGestureSession.js`, `usePlayerSheetState.js`, `MobilePlayerBar/index.js`, `miniPlayerPanSession.js`, `playerSheetArchitecture.test.js`, docs/rules/skills, `validate-ai-discipline.js`

**Tests:** `playerSheetArchitecture.test.js`, `playerSheetInteractionRecover.test.js`, `npm run verify:player-mobile`, `npm run validate:ai`

**Чтобы не повторилось:** `INV-SHEET-010` в `ARCHITECTURE_INVARIANTS.md`; AGENTS.md stop-and-rewrite для sheet; skill `earflow-player-sheet` owner chain обновлён.

---

## 2026-06-03 — Playback seek: single source of truth (PlayerStore + useSeekableProgress)

**Status:** accepted  
**Area:** frontend-player  

**Context:** Hero waveform и mini progress bar при scrub отскакивали к 0: `commitSeek` обновлял только `currentTimeRef`, UI читал `PlayerStore.currentTime` (не синхронизирован). Отдельный local preview state в `HeroWaveformSeek` — второй control path (INV-ARCH-001).

**Decision:**
- **Owner времени:** `PlayerContext` — `patchStorePlaybackTime` пишет в `currentTimeRef`, `PlayerStore.currentTime`, `PlayerTimeTracker.writeExternalProgress` на `updateSeek` / `commitSeek` / `seekToSeconds`.
- **Duration:** `resolvePlaybackDurationSec()` — audio `duration` или метаданные трека (commit не no-op до загрузки audio).
- **UI seek:** все progress surfaces через `useSeekableProgress` + `onPreviewSeek` → `player.updateSeek`; commit → `player.commitSeek` → `PlayerCore.seek`.
- **Surfaces:** `HeroWaveformSeek`, `MobilePlayerBar` (mini progress, `pointer-events: auto`), `GlobalPlayerBar`, `MobilePlayerModal`.

**Alternatives considered:** только local CSS preview без store patch — отвергнуто (snap back после release).

**Consequences:** waveform, mini-bar и full player показывают одну позицию; scrub не сбрасывается.

**Files touched:** `frontend/src/context/PlayerContext.js`, `frontend/src/components/hooks/useSeekableProgress.js`, `frontend/src/components/MusicPlayer/HeroWaveformSeek.js`, `frontend/src/components/MobilePlayerBar/index.js`, `MobilePlayerBar.styles.js`, `GlobalPlayerBar.js`, `MobilePlayerModal.js`

**Tests:** `npm test` 218/218 pass (2026-06-03).

**Чтобы не повторилось:** `INV-FE-009` в `ARCHITECTURE_INVARIANTS.md`.

---

## 2026-06-03 — Gesture session + delegate graph + arbiter-native BottomSheet (INV-GESTURE-012)

**Status:** accepted  
**Area:** frontend-player / gestures  

**Context:** Phase 2 оставляла Framer drag на generic BottomSheet и split session API без delegate graph.

**Decision:**
- `gestureDelegates.evaluateGestureClaim` — policy graph; arbiter = storage only.
- `useMiniPlayerGestureSession` — unified `session` + handlers (supersedes coordinator naming).
- `BottomSheet`: remove Framer `drag` / `dragControls`; `useSheetDragArbitration` drives `y` via pointer machine.
- Build hint: `2026-06-v28-gesture-session`. PEND-GESTURE-001 closed.

**Files touched:** `gestureDelegates.js`, `BottomSheet.js`, `useSheetDragArbitration.js`, `useMiniPlayerGestureSession.js`, docs, invariants, architecture tests

**Чтобы не повторилось:** `INV-GESTURE-012`

---

## 2026-06-03 — Per-pointer GestureArbiter + mini gesture coordinator (INV-GESTURE-011)

**Status:** accepted  
**Area:** frontend-player / gestures  
**Supersedes:** singleton arbiter as target model (DECISIONS 2026-05 gesture arbiter entry — runtime now per-pointer)

**Context:** Exclusive mini policy на singleton arbiter не решала второй палец (seek p1 блокировал mini p2) и не давала целевую модель обслуживания.

**Decision:**
- `GestureArbiterProvider`: `Map<pointerId, owner>`; API `getOwner`, `getActiveOwners`, `releasePointer`, `releaseNonMiniOwner`.
- Mini: `useMiniPlayerGestureCoordinator` (sheet + machine); machine в `useMiniPlayerGestureMachine.js`.
- Док: `docs/GESTURE_ARCHITECTURE.md` + `.cursor/rules/earflow-gesture-architecture.mdc`.
- Build hint: `2026-06-v27-per-pointer-arbiter`.

**Alternatives considered:** Оставить singleton + exclusive — отвергнуто (неправильная модель для multi-touch).

**Consequences:** Cover + mini одновременно на разных пальцах; тесты arbiter обновлены; `useMiniPlayerGestures` — re-export coordinator.

**Files touched:** `GestureArbiterProvider.js`, `useMiniPlayerGestureCoordinator.js`, `useMiniPlayerGestureMachine.js`, `MobilePlayerBar/index.js`, `docs/GESTURE_ARCHITECTURE.md`, invariants, cursor rule

**Tests:** `GestureArbiterProvider.test.js`, gesture machine tests

**Чтобы не повторилось:** `INV-GESTURE-011`

---

## 2026-06-03 — Mini-bar exclusive gesture pointer (INV-GESTURE-010)

**Status:** accepted  
**Area:** frontend-player / gestures  

**Context:** После waveform seek и быстрых L/R свайпов mini-bar «замирал»: SEEK (priority 700) и hero `COVER_STACK` перехватывали arbiter у `PLAYER_SHEET` (600) на том же или другом pointer; sheet оставался в `DRAGGING`, внешние surfaces продолжали tracking.

**Decision:** `exclusive` ownership в GestureArbiter для mini `pointer-down`; `miniPlayerGestureZone` + `shouldDeferToMiniPlayerGesture` для SEEK/cover/playlist machine; preempt любого non-mini owner на mini `pointerdown`; build hint `2026-06-v26-gesture-exclusive`.

**Alternatives considered:** Поднять только priority mini выше SEEK — не защищает от другого pointerId и не блокирует cover без arbiter preempt.

**Consequences:** Один pointer → один mini state machine до release; внешние свайпы не стартуют в bbox mini.

**Files touched:** `GestureArbiterProvider.js`, `miniPlayerGestureZone.js`, `usePointerGestureMachine.js`, `useMiniPlayerGestures.js`, `usePointerSeek.js`, `usePointerDragScroll.js`, `MobilePlayerBar/index.js`

**Tests:** `GestureArbiterProvider.test.js`, `miniPlayerGestureZone.test.js`, e2e gestures/live after deploy

**Чтобы не повторилось:** `INV-GESTURE-010`

---

## 2026-06-03 — transcode-worker: split concurrency, failed retry, graceful shutdown

**Status:** accepted  
**Area:** streaming / transcode-worker  

**Context:** Audit: transcode и waveform-only делили один `CONCURRENCY`; `failed` не перезапускались; SIGTERM обрывал jobs без drain; MinIO keys без проверки traversal.

**Decision:**
- Отдельные пулы: `TRANSCODE_CONCURRENCY`, `WAVEFORM_CONCURRENCY` (`jobPool.js`).
- Retry failed: prefix `[retries:N]` в `transcode_error` / `waveform_error`, requeue по `updated_at` + `TRANSCODE_FAILED_*` env.
- Graceful shutdown: drain in-flight, interrupted → `pending`.
- `resolveObjectKey` отклоняет `..` / `\0`.

**Files:** `backend/transcode-worker/src/worker.js`, `jobPool.js`, `jobRetry.js`, `CONTEXT.md`, `docker-compose.yml`, `.env.example`

**Tests:** `jobPool.test.js`, `jobRetry.test.js`, `runtimeMetrics.test.js`

---

## 2026-06-03 — Server-side waveform peaks (INV-ARCH-001 compliant)

**Status:** accepted  
**Area:** streaming / frontend-player / database  

**Context:** Client-side `OfflineAudioContext` decode снят (дублировал stream path). Нужны реальные пики без «умного» фронта.

**Decision:**
- **Generate:** `transcode-worker` — ffmpeg mono f32le → peaks, store `songs.waveform_peaks` JSONB (256 bars default).
- **Serve:** `database-service` `GET /api/songs/:id/waveform?bars=N` (gateway prefix `/api/songs`).
- **Frontend:** `useTrackWaveformPeaks` → API only; seek через `PlayerContext` (локальный scrub preview как `useSeekableProgress`).
- **Upload:** `waveform_status='pending'` on insert.

**Files:** `transcode-worker/src/waveform.js`, `database-service/routes/songs.js`, `frontend/src/hooks/useTrackWaveformPeaks.js`, migration in `00-create-tables.sql`.

---

## 2026-06-03 — Hero waveform: no client stream decode (revert smart-frontend)

**Status:** accepted  
**Area:** frontend-player / streaming  

**Context:** Агент добавил `loadTrackWaveformPeaks`: direct session + полный `fetch` аудио + `OfflineAudioContext` в браузере. Это дублирует streaming path, грузит клиент (до 12MB), не описано в gateway/сервисах. В DECISIONS home v3 уже было: **декоративный** waveform от `usePlayerStoreSnapshot` progress, seek через `PlayerContext`.

**Decision:**
- Удалены `useTrackWaveformPeaks` и client decode из `trackWaveformPeaks.js`.
- `HeroWaveformSeek`: placeholder peaks (`fallbackPeaksForTrack`) + progress/seek только через `PlayerContext` (локальный scrub preview как в `useSeekableProgress`).
- Настоящие пики — **backend** (`PEND-WAVE-001`), не повторять decode в SPA.

**Alternatives considered:** оставить client decode «пока нет API» — отвергнуто (INV-ARCH-001, скрытый второй pipeline).

**Files touched:** `HeroWaveformSeek.js`, `trackWaveformPeaks.js`, удалён `useTrackWaveformPeaks.js`, `docs/PENDING.md`

**Чтобы не повторилось:** `PEND-WAVE-001`; grep `OfflineAudioContext` / `loadTrackWaveformPeaks` в PR.

---

## 2026-06-03 — Mini-bar gesture freeze after waveform + rapid track swipes (INV-SHEET-009)

**Status:** accepted  
**Area:** frontend-player  

**Context:** Пользователь: seek по волне на главной, затем быстрые свайпы влево/вправо в mini-bar → UI не реагирует, треки не переключаются, воспроизведение «встало». Не бэкенд и не «10k пользователей на сервере» — **локальная гонка состояния жестов/sheet на клиенте**.

**Decision:**
- `snapToClosed` → `setPhaseSafe(CLOSED)` **до** `runSnap`, чтобы `modalVisible` не держал `miniBarPointerEvents: none` во время закрытия.
- Перед horizontal track swipe: `finishClosed()` если sheet не `OPEN`.
- `recoverInteraction()` в `usePlayerSheetState`; `forceUnlockGestures` + `withAnimationTimeout` в `useMiniPlayerGestures`.
- Watchdog: `DRAGGING` + Y≈closed >2.2s → `recoverInteraction`.
- Build hint `2026-06-v23-interaction-recover`.

**Alternatives considered:** отдельная фаза `SNAPPING` — отложено (`PEND-SHEET-001`); ослабить `miniBarPointerEvents` — хуже ghost hits.

**Consequences:** после агрессивных свайпов mini-bar и playback должны восстанавливаться без перезагрузки страницы.

**Files touched:** `usePlayerSheetState.js`, `useMiniPlayerGestures.js`, `miniTrackSwipeAnimation.js`, `index.js`, tests, `ARCHITECTURE_INVARIANTS.md`, `.cursor/rules/earflow-player-sheet.mdc`.

**Tests:** `playerSheetInteractionRecover.test.js`, `playerSheetArchitecture.test.js`, `verify:player-mobile`.

**Чтобы не повторилось:** `INV-SHEET-009`; rule `earflow-player-sheet.mdc` § freeze.

---

## 2026-06-03 — Player sheet L3 portal + SNAPPING + scroll handoff (INV-SHEET-008)

**Status:** accepted  
**Area:** frontend-player  

**Context:** Sheet bugs (ghost mini hits, dismiss vs queue scroll, playground ≠ prod mount) persisted because chrome lived in L1 tree and snap reused `DRAGGING` phase.

**Decision:**
- `PlayerChrome` portals mini + modal to `#ef-player-chrome-root` on `document.body` (App mobile + playground).
- `miniBarPointerEvents: none` when `sheetOpen || modalVisible`.
- `sheetScrollHandoff.js` — dismiss only at `scrollTop === 0` for queue/sheet scroll areas.
- `dragSourceRef` (`mini` | `modal`) — window `pointerup` backup settle только для mini (fix dismiss race).
- Mobile `registerOpenFullPlayer` → `sheet.open()`.
- Build hint `2026-06-v22-drag-source`.
- Отложено: отдельная фаза `SNAPPING` (ломает dismiss timing в e2e без доп. синхронизации).

**Alternatives considered:** merge GlobalPlayerBar + MobilePlayerBar — отложено (desktop/mobile split).

**Files touched:** `PlayerChrome/`, `sheetScrollHandoff.js`, `usePlayerSheetState.js`, `playerSheetPhase.js`, `MobilePlayerModal.js`, `MobilePlayerBar/index.js`, `App.js`, `MobilePlayerPlayground.js`, e2e, architecture tests.

**Tests:** `verify:player-mobile` (unit + gestures + homepage + modal-surfaces), `validate:ai`.

**Чтобы не повторилось:** `INV-SHEET-008`; architecture test + validate-ai scans.

---

## 2026-06-02 — Mobile player sheet design doc + agent skill

**Status:** accepted  
**Area:** frontend-player / meta  

**Context:** Пользователь вынужден был «угадывать» архитектуру (bar отдельно / sheet отдельно). Баги повторялись, потому что не было единого эталона до правок — только патчи и post-hoc rules.

**Decision:**
- Эталон: `docs/MOBILE_PLAYER_SHEET_DESIGN.md` (3 слоя, industry refs, gaps, gates, anti-patterns).
- Skill: `.cursor/skills/earflow-player-sheet/SKILL.md` — read design doc **before** code.
- `validate:ai` требует наличие design doc + skill.
- AGENTS level 0 → ссылка на design doc.

**Alternatives considered:** только `.mdc` rule — отвергнуто: rule короткий, design doc — полный контекст + «зачем проверять».

**Files touched:** `docs/MOBILE_PLAYER_SHEET_DESIGN.md`, `.cursor/skills/earflow-player-sheet/SKILL.md`, `AGENTS.md`, `validate-ai-discipline.js`, rules/skills cross-links

**Чтобы не повторилось:** агент читает design doc + skill до IMPLEMENT; verify gates обязательны.

---

**Status:** accepted  
**Area:** frontend-player  

**Context:** Sheet зависал на ~90% при swipe, ломался при fast open + immediate close. Причина — dual Y drivers (Framer `animate y` + `sheetDragY`), dismiss только в OPEN, `settleDrag` игнорировал active snap, modal имела свой `animateDismissClose`.

**Decision:**
- **Owner:** `usePlayerSheetState.js` — phase, `sheetDragY`, `sheetProgress`, snap springs.
- **API:** `beginSheetDrag`, `applySheetDragDelta(dy)` (anchor + delta), `settleDrag` always stops snap first.
- **Modal:** dismiss через `onSheetDragStart/Move/Settle`; без `animate(yMotion)` при `sheetDragY`.
- **Math:** `playerSheetPhysics.js` (pure); gestures только вызывают sheet API.
- **Gates:** `INV-SHEET-001..006`, `.cursor/rules/earflow-player-sheet.mdc`, `playerSheetArchitecture.test.js`, расширен `validate-ai-discipline.js`.

**Alternatives considered:**
- Framer `animate y` на modal для polish — отвергнуто (конфликт с snap).
- Dismiss только после OPEN — отвергнуто (fast open + close race).

**Consequences:** tap = instant open; swipe release = spring on `sheetDragY` only; interrupt snap on any new drag.

**Files touched:** `usePlayerSheetState.js`, `useMiniPlayerGestures.js`, `MobilePlayerModal.js`, `MobilePlayerBar/index.js`, `playerSheetPhase.js`, rules, `ARCHITECTURE_INVARIANTS.md`, `validate-ai-discipline.js`

**Tests:** `npm run verify:player-mobile` (unit + e2e gestures); `playerSheetArchitecture.test.js`

**Чтобы не повторилось:** `INV-SHEET-001..006`; rule `earflow-player-sheet.mdc`; `validate:ai` scan.

---

**Status:** accepted  
**Area:** frontend-player / home  

**Context:** Главная на desktop выглядела скудно: узкая колонка, стек из 5 обложек по центру, много пустого пространства. Пользователь выбрал референс **variant 3** (cover-centric + waveform + play). Mobile пока без изменений.

**Decision:**
- Desktop (`min-width: 768px`): компонент `HomeDesktopHeroV3` — grid, одна обложка **4:5**, accent glow, title/artist слева, декоративный waveform от `usePlayerStoreSnapshot` progress, play → `PlayerContext.togglePlayPause`, свайп по обложке сохранён.
- Mobile: прежний cover stack в `MusicPlayer.js`.
- Правило для агентов: `.cursor/rules/earflow-home-desktop-v3.mdc`.

**Alternatives considered:**
- View Transitions API для hero — отложено (sheet/drag отдельно).
- Desktop variant 4 (categories grid) — не выбран пользователем.

**Consequences:** Шире `MainPlayerSection` (до ~1180px), rails/artists ниже без изменений API.

**Files touched:** `MusicPlayer.js`, `HomeDesktopHeroV3.js`, `HomeDesktopHeroV3.styles.js`, `earflow-home-desktop-v3.mdc`

**Tests:** визуально desktop/mobile; `data-testid` `home-desktop-hero-v3` vs `home-cover-stack`

**Чтобы не повторилось:** `INV-HOME-DT-001..004` в `earflow-home-desktop-v3.mdc`

---

## 2026-06-01 — Listener UI prefs: server JSONB + unified frontend store

**Status:** accepted
**Area:** frontend-player / database-service

**Context:** Пользователь хочет архитектуру лучше Spotify «не на словах». Отдельные `miniBarVariant.js` / `miniPlayStyle.js` + только localStorage не синкали prefs между устройствами. В БД уже был `user_settings`, но без listener chrome.

**Decision:**
- Postgres: `user_settings.listener_ui` JSONB schema v1 (`miniBarVariant`, `miniPlayStyle`, `updatedAt`).
- API: merge on PUT `listener_ui`; GET returns normalized object.
- Frontend: `preferences/listenerUiPrefs.js` — single store, debounced PUT, `hydrateListenerUiFromServer`, legacy key migration.
- `ListenerUiPrefsSync` в `App.js` после auth.
- Thin wrappers `miniBarVariant.js` / `miniPlayStyle.js` + existing hooks (минимальный diff в UI).

**Alternatives considered:**
- Только localStorage — отвергнуто (нет multi-device).
- Отдельные колонки per pref — отвергнуто (не масштабируется).
- Push prefs через DeviceSync WS — отложено (можно поверх того же JSON).

**Consequences:** prefs следуют аккаунту; гости — local cache only. Build hint `2026-06-v11-server-sync`.

**Files touched:** `database-service/database/migrations/002_*`, `lib/listenerUiPrefs.js`, `routes/users.js`, `frontend/src/preferences/*`, `utils/miniBarVariant.js`, `utils/miniPlayStyle.js`, `App.js`, `index.js`

**Tests:** `listenerUiPrefs.test.js`, existing mini-bar e2e

**Чтобы не повторилось:** `INV-FE-006` обновлён.

---

## 2026-06-01 — Снят imperative play-style paint (PEND-FE-002 закрыт)

**Status:** accepted
**Area:** frontend-player

**Context:** `applyMiniPlayStyleToDom` дублировал store + CSS; пользователь попросил исправить архитектуру.

**Decision:**
- `miniPlayStyle.js` — как `miniBarVariant.js`: только `localStorage` + `documentElement.dataset` + event.
- `MobilePlayerBar` — один play-компонент по `playStyle` (условный рендер), без dual slots и `useLayoutEffect` paint.
- `mini-player-overrides.css` — только play-control chrome (без slot toggle); build `2026-06-v10`, SW `v3.3.0-mini-play-store-v10`.

**Files touched:** `utils/miniPlayStyle.js`, `MobilePlayerBar/index.js`, `App.js`, `mini-player-overrides.css`, e2e specs

**Tests:** `miniPlayStyle.test.js`, `e2e/mini-bar-layout.spec.js`, `e2e/mini-play-style-proof.spec.js`

**Чтобы не повторилось:** `INV-FE-007` — новый `apply*ToDom` запрещён; эталон — external store + React + optional early CSS on `:root`.

---

## 2026-06-01 — AI escape-hatch discipline на всех поверхностях агента

**Status:** accepted
**Area:** meta / frontend-player / all

**Context:** Пользователь узнал об императивном `applyMiniPlayStyleToDom` и тройной страховке (React + CSS + DOM + overrides) только при явном вопросе об архитектуре. В `ARCHITECTURE_INVARIANTS` уже были `INV-FE-006..008`, но файл `.cursor/rules/earflow-ui-client-prefs.mdc` **отсутствовал** — ссылки в DECISIONS и `earflow-context-discipline` вели в никуда; KLM не получал единого обязательного checklist.

**Decision:**
- Создан always-apply `.cursor/rules/earflow-ui-client-prefs.mdc` (+ зеркало `.windsurf/rules/`).
- Добавлен cross-cutting `INV-ARCH-001` (один механизм на ответственность — весь проект, не только UI).
- `scripts/validate-ai-discipline.js` проверяет наличие rule-файлов и новый `apply*ToDom` без `PEND-FE`.
- KLM: обязательная запись в project memory при UI pref / escape hatch (см. `.cursor/rules/klm-auto-memory.mdc`).

**Alternatives considered:** только комментарий в AGENTS.md — отвергнуто: always-apply rules читаются чаще, чем длинный AGENTS.

**Consequences:** любой агент при stacked escape hatch обязан PEND + DECISIONS + три пункта пользователю в том же ответе.

**Files touched:** `.cursor/rules/earflow-ui-client-prefs.mdc`, `.windsurf/rules/earflow-ui-client-prefs.mdc`, `docs/ARCHITECTURE_INVARIANTS.md`, `scripts/validate-ai-discipline.js`, `.cursor/rules/klm-auto-memory.mdc`

**Чтобы не повторилось:** `INV-ARCH-001`, `INV-FE-008`; rule file must exist (`validate:ai`).

---

## 2026-06-01 — Mini play/pause style (adaptive vs metallic) + documented UI-pref pattern

**Status:** accepted
**Area:** frontend-player

**Context:** Нужны два вида кнопки play в mobile mini-bar (иконка без круга vs metallic iPhone 5s). На проде настройки в Profile обновлялись, bar оставался со «старым» белым кругом: lazy bar, styled-components, PWA cache. Пользователь узнал об императивном `applyMiniPlayStyleToDom` и тройной страховке только при вопросе об архитектуре — это нарушение дисциплины раскрытия.

**Decision:**
- Store `miniPlayStyle.js`: `adaptive` | `metallic`, key `earflow_mini_play_style`, dataset `miniPlayStyle` на `<html>` и bar.
- Hook `useMiniPlayStyle` → `useSyncExternalStore` (как mini bar variant).
- Компоненты: `MiniPlayButtonAdaptive`, `MiniPlayButtonIos` (metallic).
- Два play-слота в DOM; видимость через `:root[data-mini-play-style]` + CSS в `App.js` (как variant bar).
- **Обязательно для AI:** при любом новом UI pref или escape hatch — сразу сообщать пользователю trade-offs (`INV-FE-008`); правило `.cursor/rules/earflow-ui-client-prefs.mdc`.
- **Снято 2026-06-01:** imperative `applyMiniPlayStyleToDom` → см. запись «Снят imperative play-style paint».

**Alternatives considered:**
- Только React props — отвергнуто на этапе внедрения: lazy `MobilePlayerBar` + prod cache (история variant bar); позже заменено на store + условный рендер без DOM paint.
- Server user settings API — overkill для локальной косметики.
- Dual DOM slots + imperative paint — снято; один условный компонент.

**Consequences:** Profile picker с превью кнопок; e2e `mini-play-style-proof.spec.js`; build hint `data-testid="mini-play-build-hint"`.

**Files touched:** `utils/miniPlayStyle.js`, `hooks/useMiniPlayStyle.js`, `MobilePlayerBar/*`, `MiniBarVariantPicker.js`, `App.js`, `public/mini-player-overrides.css`, `index.js`, `sw.js`

**Tests:** `miniPlayStyle.test.js`, `e2e/mini-bar-layout.spec.js`, `e2e/mini-play-style-proof.spec.js`

**Чтобы не повторилось:** `INV-FE-006`, `INV-FE-007`, `INV-FE-008` в `ARCHITECTURE_INVARIANTS.md`; KLM memory; `earflow-ui-client-prefs.mdc`.

---

## 2026-05-31 — Mini-bar variant sync via useSyncExternalStore + root CSS

**Status:** accepted
**Area:** frontend-player

**Context:** На проде блок «Mini bar» в Profile есть, но bar визуально всегда «стандарт»: picker менял state, lazy `MobilePlayerBar` не перерисовывался надёжно через React context / window event.

**Decision:**
- `useMiniBarVariant` → `useSyncExternalStore(subscribeMiniBarVariant, getMiniBarVariant)` — единый external store для picker и bar.
- Layout/play-button toggle через `:root[data-mini-bar-variant] [data-testid="mini-player-bar"]` (+ `!important`), не только через React props.
- Обе play-кнопки в DOM; видимость через CSS `[data-mini-play="classic|floating"]`.

**Files touched:** `hooks/useMiniBarVariant.js`, `utils/miniBarVariant.js`, `App.js`, `MobilePlayerBar/index.js`

**Tests:** `e2e/visual-walkthrough.spec.js` (variant DOM + bounding box inset)

---

## 2026-05-31 — Mini-bar UI variants (floating default + classic) + Profile picker

**Status:** accepted
**Area:** frontend-player

**Context:** Пользователь хотел два интерфейса mini-bar (новый floating pill и старый full-width). Переключатель в Profile → Mini bar не менял bar: lazy `MobilePlayerBar` и picker жили в разных hook-инстансах через window event; modal настроек (z-index 201) был под mini-bar (9998) — «Выйти» не прокручивался.

**Decision:**
- `localStorage` key `earflow_mini_bar_variant` + `documentElement.dataset.miniBarVariant`.
- Global CSS в `App.js` дублирует layout mini-bar.
- Profile settings modal: z-index 10050 (выше mini-bar), `ModalBody` с `min-height: 0` + `touch-action: pan-y`.
- Default: `floating`; classic = full-width, белая play-кнопка.

**Files touched:** `context/MiniBarVariantContext.js`, `utils/miniBarVariant.js`, `MobilePlayerBar/*`, `ProfilePage.js`, `App.js`, `MiniBarVariantPicker.js`

**Tests:** `e2e/visual-walkthrough.spec.js` (variant DOM)

---

## 2026-05-30 — MobilePlayerBar 2026 rewrite (sheet phase machine + floating UI)

**Status:** accepted
**Area:** frontend-player

**Context:** Mini-bar был god-object (~900 строк) с двумя boolean (`showFullPlayer` + `isDraggingFullPlayer`), scroll/open эвристиками и full-width UI 2015-стиля.

**Decision:**
- `PLAYER_SHEET_PHASE`: `closed | dragging | open` — единая state machine в `usePlayerSheetState`.
- Жесты вынесены в `useMiniPlayerGestures`; UI в `MobilePlayerBar.styles.js`.
- Floating pill bar: inset 10px, radius 18px, progress внутри бара, play button с metallic ring (static gradient).
- CSS vars: `--mobile-mini-player-height: 64px`, `--mobile-mini-player-float-gap: 8px`.
- Убраны scrollBy-хаки — mini-bar = chrome, не участник page scroll.

**Files touched:** `frontend/src/components/MobilePlayerBar/*`, `App.js`, `playerSheetPhysics.js`

**Tests:** gesture + sheet unit tests, gesture e2e

---

**Status:** accepted
**Area:** frontend-player, frontend-gestures

**Context:**
Система жестов ощущалась «тупой»: короткие flicks не коммитились (`swipeMinTravelPx` блокировал velocity path), mini-bar после vertical open блокировал horizontal skip на 400ms, `pointercancel` мог случайно коммитить через `cancel-commit`, e2e допускали 8/10 успешных свайпов.

**Decision:**
- Перекалибровать `IOS_GESTURE`: ниже distance/velocity, отдельный `swipeFlickTravelPx` для velocity-only commit в `shouldCommitHorizontalSwipe`.
- `classifyMiniPlayerOpenIntent`: раньше horizontal lock, SCROLL только при явном vertical scroll (travel ≥ 72px).
- Убрать `cancel-commit` из `usePointerGestureMachine` — только `onCancel` на `pointercancel`.
- Cooldown mini-bar: 160ms и только после horizontal track change (не после open).
- Queue panel: `shouldCommitVerticalSheetDetent` (distance + velocity).
- Cover stack: live drag preview через `onActiveMove`.
- BottomSheet handle: `dragElastic` 0.28.
- E2e: 10/10 track swipes, flick test, `flickOn` helper.

**Alternatives considered:**
- Оставить `cancel-commit` с opt-in — отвергнуто: ложные commits на system interrupt.
- Полная миграция BottomSheet с Framer drag — отложено (P2).

**Consequences:**
Более отзывчивые flicks и skip после open; меньше «мёртвых» жестов в ambiguous zone; e2e строже.

**Files touched:**
`frontend/src/utils/gestureIntent.js`, `gestureIntent.test.js`, `usePointerGestureMachine.js`, `MobilePlayerBar.js`, `useQueuePanelGesture.js`, `MusicPlayer.js`, `BottomSheet.js`, `e2e/gestures.spec.js`, `e2e/helpers/touch.js`

**Tests:**
`npm test -- gestureIntent`, `npx playwright test e2e/gestures*.spec.js e2e/modal-surfaces.spec.js`

**Чтобы не повторилось:**
Velocity commit не должен проходить через `minTravelPx` gate; cooldown не блокирует open→skip.

---

## 2026-05-30 — Mini-bar vs page scroll disambiguation

**Status:** accepted
**Area:** frontend-player, frontend-gestures

**Context:** Mini-bar при раскрытии и на скроллируемой странице конкурировал с vertical scroll: preview open на 6px монтировал modal + `useBodyScrollLock`, короткий finger-up классифицировался как open вместо scroll.

**Decision:** Убрать pre-intent sheet mount; mount modal только на `onIntent` VERTICAL; body lock после `sheetProgress > 0.1`; `classifyMiniPlayerOpenIntent` учитывает `scrollY/maxScrollY` — короткий pull (<38px) на scrollable page держит tracking, commit scrollBy; deliberate pull (≥38px) или bottom-of-page открывает sheet.

**Files touched:** `gestureIntent.js`, `MobilePlayerBar.js`, `MobilePlayerModal.js`, `gestureIntent.test.js`

**Tests:** `gestureIntent.test.js`, `e2e/gestures.spec.js`, `e2e/homepage-gestures.spec.js`

---

## 2026-05-30 — Zombie modal state blocks mini-bar after page scroll

**Status:** accepted
**Area:** frontend-player

**Context:** После scroll вниз mini-bar переставал реагировать; плейлист-rails иногда отдавали vertical scroll вместо horizontal. Причина: `showFullPlayer` оставался true после aborted drag → mini-bar `pointer-events: none` + невидимый modal перехватывал тапы.

**Decision:** `handleMiniGestureTrack` вызывает `cancelDraggingSheetNow()` при zombie state; `pointer-events: none` только когда player реально открыт (не во время drag); `getPageScrollMetrics` читает scroll из `body.style.top` при scroll lock; playlist/artist rails — `touch-action: pan-x` + `overscroll-behavior: contain`.

**Files touched:** `MobilePlayerBar.js`, `gestureIntent.js`, `PlaylistSection/styles/*`, `PopularArtistsSection.js`

---

## 2026-05-30 — Queue panel handle gestures + core pointer machine hardening

**Status:** accepted
**Area:** frontend-player, frontend-gestures

**Context:**
Queue panel expand/collapse/close свайпы по DragHandle были сломаны на real touch: collapse не срабатывал сразу после expand. Корень — CSS `transition: height 0.3s` на `TrackListOverlay`: пока высота анимировалась, второй pointer-жест не доходил до `usePointerGestureMachine` (hit-test/capture race). Дополнительно жесты висели на всём overlay вместо handle-only ownership, а `GestureArbiterProvider` создавал отдельный arbiter вместо singleton.

**Decision:**
1. **`useQueuePanelGesture`:** handle-only intent (Spotify-style), tracking на overlay capture, `touch-action: none` на shell, `pan-y` только на `[data-queue-scrollarea]`.
2. **Instant snap между 60vh/90vh** — убран CSS height transition; detents переключаются сразу.
3. **`usePointerGestureMachine`:** commit delta берёт tracked `lastX/lastY`; `preventDefault` при immediate claim; cancel→commit fallback если intent уже locked.
4. **`GestureArbiterProvider`** использует singleton arbiter (единый owner runtime-wide).
5. **`usePointerDragScroll`** — unmount cleanup release для arbiter.

**Alternatives considered:**
- *Оставить height transition + delay между жестами:* отвергнуто — ломает быстрые последовательные свайпы как у Spotify.
- *Framer drag на queue sheet:* отвергнуто — нарушает INV-FE-003 single owner.

**Consequences:**
- Queue panel: expand → collapse → close работает на real touch без пауз.
- Mini-player, cover stack, dismiss, carousel жесты не регресснули (e2e + stress green).

**Files touched:**
- `frontend/src/components/MobilePlayerModal/useQueuePanelGesture.js`
- `frontend/src/components/MobilePlayerModal.js`
- `frontend/src/components/MobilePlayerModal.styles.js`
- `frontend/src/components/queue-panel/queuePanel.styles.js`
- `frontend/src/gestures/usePointerGestureMachine.js`
- `frontend/src/gestures/GestureArbiterProvider.js`
- `frontend/src/components/PlaylistSection/hooks/usePointerDragScroll.js`
- `docs/DECISIONS.md`

**Tests:**
- `npx playwright test e2e/modal-surfaces.spec.js e2e/gestures.spec.js e2e/homepage-gestures.spec.js`
- `npx playwright test e2e/gestures.stress.spec.js`
- `npm test -- --testPathPattern=gesture`

---

## 2026-05-29 — Gesture Arbiter leak protection on unmount, modal opacity hardening and carousel scroll touch-action bypass

**Status:** accepted
**Area:** frontend-player, frontend-gestures

**Context:**
На реальном iOS Safari вскрылись две критические проблемы, нарушающие UX:
1. **Зависание жестов после закрытия плеера:** Свайп вниз закрывает модальный плеер, переводя его в unmount. Однако, если жест размонтируется во время активного клайма, синглтон `GestureArbiter` утекал владение (не было unmount cleanup). Из-за этого нижний бар mini-player становился полностью нереактивным (tryClaim отклонялся), а также блокировались горизонтальные свайпы.
2. **Полупрозрачный плеер и наложение контента:** Из-за динамической высоты URL-бара на iOS, `visualProgress` модального плеера мог не дотягивать до ровного `1.0` при открытии. Это приводило к тому, что плеер оставался частично прозрачным (макс непрозрачность интерполировалась строго в точке `1.0`), и сквозь него визуально накладывался контент домашнего экрана.
3. **Конкуренция свайпов на каруселях плейлистов:** Карусели имели `touch-action: pan-y` (или `pan-x`) и нативный `overflow-x: auto` скролл, но при этом на них висел ручной pointer drag скроллинг через `usePointerDragScroll.js`. На мобильных устройствах native scroll и JS scroll начинали одновременно двигать `scrollLeft`, создавая жуткую тряску и неуправляемый скроллинг.

**Decision:**
1. **Unmount Protection в `usePointerGestureMachine`:** Добавлен `useEffect` cleanup хук, вызывающий `reset('unmount')`. При размонтировании любого жестового компонента (плеера, карусели, bottom-sheet) его клаймы и pointer-захваты полностью очищаются.
2. **Hardening `modalOpacity`:** Изменена кривая интерполяции на `useTransform(visualProgress, [0, 0.12, 0.45, 1], [0, 0.85, 1, 1])`. Теперь плеер становится полностью непрозрачным (`1.0`) уже при раскрытии на 45%, гарантируя перекрытие домашнего экрана при любых высотах вьюпорта iOS.
3. **Touch Bypass в `usePointerDragScroll`:** Добавлен фильтр на `e.pointerType === 'touch'`. Для тач-устройств кастомный JS drag-скроллинг полностью выключается, отдавая управление безупречному нативному 120fps инерционному скроллингу браузера. Для мыши (pointerType === 'mouse') JS drag-скролл остаётся активным, сохраняя drag-to-scroll на десктопе.

**Consequences:**
- Нижний мобильный плеер больше никогда не зависает после жестов закрытия.
- Карусели плейлистов на мобильных телефонах скроллируются идеально плавно и нативно, без дерганий и конфликтов.
- Модальный плеер полностью opaque при открытии, нет визуального мусора и наложений.

**Files touched:**
- `frontend/src/gestures/usePointerGestureMachine.js`
- `frontend/src/components/MobilePlayerModal.js`
- `frontend/src/components/PlaylistSection/hooks/usePointerDragScroll.js`
- `docs/DECISIONS.md`

**Tests:**
- `npx playwright test e2e/modal-surfaces.spec.js --reporter=list` (тесты стабильно зеленые).

---

## 2026-05-28 — Mobile gesture e2e на РЕАЛЬНОМ touch + touch-action для dismiss

**Status:** accepted
**Area:** frontend-gestures, testing

**Context:**
Жестовые e2e (`homepage-gestures`, `gestures`, `gestures.stress`) были false-green: helpers `frontend/e2e/helpers/touch.js` диспатчили `page.mouse.*`, а `realisticTap` был `locator.click()` — то есть `pointerType:"mouse"`, без `touchstart` и без `pointerType:"touch"`. Комментарии в helper при этом утверждали, что "имитируют палец". Реальный палец на iOS/Android идёт через touch + `touch-action`, поэтому mouse-тесты не ловили целый класс багов (нативный скролл крадёт жест).

**Decision:**
1. Переписать helpers на РЕАЛЬНЫЙ touch: `Input.dispatchTouchEvent` через CDP (touchStart → touchMove* → touchEnd) + `tapAt`; mouse-эмуляция остаётся fallback для desktop (`hasTouch:false`). CDP-сессия и touch-capability кэшируются per-page.
2. Под реальным touch немедленно вскрылся настоящий баг: dismiss-down модального плеера не работал — `ContentLayer` и его base-секции имели `touch-action: auto`, браузер забирал вертикальный drag в нативный скролл и слал `pointercancel`. Фикс: `touch-action: none` на `ModalHeader` и `AlbumSection` (в lyrics-режиме `auto`, там dismiss отключён). `ContentLayer` оставлен `auto`, чтобы descendant `TrackListOverlay`/`BottomSheet`/lyrics сохранили нативный скролл.

**Alternatives considered:**
- *`touch-action: none` на `ContentLayer`:* отвергнуто — ancestor `none` ломает нативный скролл вложенных scrollable overlays (queue/devices/lyrics).
- *Оставить mouse-e2e:* отвергнуто — это и есть источник false-green, ради которого затевалась проверка.
- *Сразу ставить WebKit/iOS Safari проект:* отложено как follow-up (требует `npx playwright install webkit`); chromium + реальный touch уже ловит `touch-action`/scroll-баги.

**Consequences:**
- Жестовые e2e теперь проходят тот же путь, что палец: `touchstart`/`touchmove`, `pointerType:"touch"`, `touch-action`, конкуренция с нативным скроллом.
- Все три suite зелёные на реальном touch (homepage 3/3, playground 7/7, stress 100/100); desktop остаётся на mouse.

**Files touched:**
- `frontend/e2e/helpers/touch.js`
- `frontend/e2e/gestures.stress.spec.js`
- `frontend/src/components/MobilePlayerModal.styles.js`
- `docs/ARCHITECTURE_INVARIANTS.md`
- `docs/DECISIONS.md`

**Tests:**
- `npx playwright test e2e/homepage-gestures.spec.js --reporter=list`
- `npx playwright test e2e/gestures.spec.js --reporter=list`
- `npx playwright test e2e/gestures.stress.spec.js --reporter=list` (E2E_STRESS_ACTIONS=100)

**Чтобы не повторилось:** инварианты `INV-FE-004` (touch-action для drag surface) и `INV-FE-005` (mobile e2e на реальном touch).

---

## 2026-05-28 — Единый frontend gesture ownership через GestureArbiter

**Status:** accepted
**Area:** frontend-player, frontend-gestures

**Context:**
Mini-player, player modal dismiss, homepage cover stack, legacy player card swipes, playlist rails, seek bars и bottom sheets распознавали pointer/touch/Framer gestures разными локальными путями. Это создавало конкуренцию: после scroll или при пересечении слоёв один и тот же pointer мог одновременно принадлежать mini-player, cover stack, playlist rail или modal dismiss.

**Decision:**
1. `GestureArbiterProvider` остаётся единственным runtime arbiter для frontend gestures.
2. `usePointerGestureMachine` получил controlled `claimOnPointerDown` для surfaces, которым нужно владеть pointer с начала касания, и controlled same-pointer transfer только внутри одной machine при intent classification.
3. Mini-player open/track swipe, player modal dismiss, queue overlay, homepage cover stack, legacy card stack swipes и mobile playlist rail переведены на arbiter-aware pointer ownership.
4. Legacy local `touchstart/touchmove` playlist rail path и Framer `drag/onDragEnd` card swipe paths удалены из competing swipe surfaces.
5. `BottomSheet` handle drag и `PlaylistPage` track reorder (Framer `dragControls.start` + manual `setPointerCapture`) теперь claim/release `GESTURE_SURFACE.SHEET_HANDLE_DRAG` / новый `GESTURE_SURFACE.PLAYLIST_REORDER` через arbiter, с release на `pointerup/cancel/lostpointercapture`, чтобы tap по handle/grip не оставлял hung owner.

**Alternatives considered:**
- *Добавить guards к каждому surface:* отвергнуто — это уже привело к конкуренции и scroll-регрессам.
- *Оставить Framer drag для swipe commit:* отвергнуто — Framer recognizer не является single owner в нашем gesture arbiter.
- *Полный rewrite всех draggable UI:* отвергнуто — высокий blast radius; выбран targeted refactor вокруг существующего `GestureArbiterProvider`.

**Consequences:**
- Player gestures теперь имеют один owner per pointer и release на `pointerup/cancel`.
- Page scroll не крадётся playlist rail до horizontal intent; playlist rail claims только при horizontal drag.
- Existing bottom sheet, seek и playlist hooks сохранены как arbiter-aware exceptions.

**Files touched:**
- `AGENTS.md`
- `docs/ARCHITECTURE_INVARIANTS.md`
- `docs/DECISIONS.md`
- `frontend/src/gestures/GestureArbiterProvider.js`
- `frontend/src/gestures/usePointerGestureMachine.js`
- `frontend/src/gestures/usePointerGestureMachine.test.js`
- `frontend/src/components/MobilePlayerBar.js`
- `frontend/src/components/MobilePlayerModal.js`
- `frontend/src/components/MusicPlayer.js`
- `frontend/src/components/UnifiedPlayer.js`
- `frontend/src/components/PlaylistView.js`
- `frontend/src/components/PlaylistSection/hooks/usePointerDragScroll.js`
- `frontend/src/components/PlaylistSection/PlaylistSectionMobile.js`
- `frontend/src/gestures/gestureContracts.js`
- `frontend/src/components/BottomSheet.js`
- `frontend/src/components/PlaylistPage.js`

**Tests:**
- `node --check` for changed frontend JS files
- `npm --prefix frontend test -- src/gestures/usePointerGestureMachine.test.js --watchAll=false --runInBand`
- `npx playwright test e2e/homepage-gestures.spec.js --reporter=list`

**Чтобы не повторилось:** инвариант `INV-FE-003` в `docs/ARCHITECTURE_INVARIANTS.md`.

---

## 2026-05-27 — AI context discipline как обязательный repo-level guardrail

**Status:** accepted
**Area:** architecture-governance, ai-workflow

**Context:**
После регресса DeviceSync стало очевидно, что одной большой архитектурной карты недостаточно. AI-агенты должны быстро понимать project context, видеть принятые решения, known gaps и hard invariants, иначе они снова будут латать симптомы и возвращать frontend authority.

**Decision:**
1. Ввести минимальный context stack: `AGENTS.md`, `docs/ARCHITECTURE_INVARIANTS.md`, `docs/DECISIONS.md`, `docs/PENDING.md`, `backend/<service>/CONTEXT.md`.
2. Зафиксировать mandatory rules в `.windsurf/rules/earflow-context-discipline.mdc` и `.cursor/rules/earflow-context-discipline.mdc`.
3. Добавить локальный validator `npm run validate:ai`, который ловит нарушающие invariants паттерны и отсутствие обязательных context-файлов.
4. Удалить закрытую PEND-запись про stale guard cleanup: `isStaleActiveRevision` и `isStaleNowPlayingState` удалены из frontend.

**Alternatives considered:**
- *MCP-only enforcement:* отвергнуто — MCP зависит от IDE/агента и не гарантирует вызов.
- *Только markdown docs:* отвергнуто — без validator старые анти-паттерны незаметно вернутся.

**Consequences:**
- Любой AI/IDE получает одинаковую дисциплину через repo-local rules.
- Validator можно запускать вручную и в CI.
- Warnings по отсутствующим service `CONTEXT.md` не ломают обычный запуск, но strict mode доступен.

**Files touched:**
- `.windsurf/rules/earflow-context-discipline.mdc`
- `.cursor/rules/earflow-context-discipline.mdc`
- `.windsurf/workflows/load-context.md`
- `scripts/validate-ai-discipline.js`
- `package.json`
- `AGENTS.md`
- `docs/PENDING.md`
- `frontend/src/hooks/deviceSyncRevisionGuard.js`
- `frontend/src/hooks/__tests__/deviceSyncRevisionGuard.test.js`

**Tests:**
- `npm run validate:ai`
- `node --check scripts/validate-ai-discipline.js`
- `npm --prefix frontend test -- --watchAll=false --runInBand --runTestsByPath src/hooks/__tests__/deviceSyncRevisionGuard.test.js`

**Чтобы не повторилось:** `.windsurf/.cursor` always-apply rules + `npm run validate:ai` перед архитектурными изменениями.

---

## 2026-05-27 — Этап 1: Spotify-style transfer-on-play + удаление frontend authority

**Status:** accepted
**Area:** device-sync, frontend-player

**Context:**
До этой даты frontend был соавтором playback state: делал `transferTo(self)` при play, публиковал position каждые 4с, держал `prevLocalAudioRef`/`claimInFlightRef`/`suppressAutoClaimUntilRef` для разруливания race с backend, оптимистично мутировал `devices[].isActive` при `devices:active` frame. Это создавало race conditions при переключении устройств (мерцание active state, lost playback после transfer, дублирующиеся transfers).

**Decision:**
1. **Backend** перехватывает `cmd:play` от non-active device (или при отсутствии active) и сам делает `StartTransfer` — Spotify Connect модель "play = intent".
2. **Frontend** перестаёт быть co-author: удалены auto-claim useEffect, periodic position publish (4с), stale-фильтрация в WS-cases, локальный rebuild `devices[].isActive`, standby REST polling (12с).
3. WebSocket теперь открывается всегда после `register` (без "<2 devices → standby" branch).

**Alternatives considered:**
- *Сохранить frontend authority, добавить more guards:* отвергнуто — мы это делали 2 года, каждый guard порождал следующий баг.
- *Полный rewrite useDeviceSync:* отвергнуто — слишком большой blast radius, фронт в проде.
- *Принят:* incremental rewrite с тестами на каждом шаге, сохраняя API контракт `useDeviceSync` для downstream компонентов.

**Consequences:**
- Удалено ~10KB кода из `useDeviceSync.js`, ~700 байт из `DeviceSyncProvider.js`, ~470 байт CRLF-мусора нормализовано.
- WS connections базово ×2 при single-device аккаунтах (нет больше standby pattern). Mitigation: gateway scaling, sticky sessions при необходимости.
- Возможный UI flicker (~50ms) между `devices:active` и `np:update` frames — backend публикует frames из одной горутины, на практике незаметно.

**Files touched:**
- `backend/device-sync-service/internal/devices/registry.go` (SendCommand + transfer-on-play)
- `backend/device-sync-service/internal/devices/transfer_fsm_test.go` (3 новых теста)
- `frontend/src/components/DeviceSync/DeviceSyncProvider.js`
- `frontend/src/components/DeviceSync/deviceSyncControls.js`
- `frontend/src/components/DeviceSync/nowPlayingPublishPolicy.js`
- `frontend/src/hooks/useDeviceSync.js`

**Tests:**
- `TestSendCommandTransferOnPlayFromNonActiveDevice`
- `TestSendCommandTransferOnPlayWhenNoActiveExists`
- `TestSendCommandPauseFromNonActiveDeviceIsRelayedToActiveWithoutTransfer`
- `deviceSyncControls.test.js::toggleRemotePlayback shoud publish play intent`
- `nowPlayingPublishPolicy.test.js` (rewritten под event-driven model)

**Чтобы не повторилось:** инварианты `INV-DS-001..INV-DS-006` в `docs/ARCHITECTURE_INVARIANTS.md`.

---

## ~2024 — 2026-05 (исторический контекст) — Frontend authority в DeviceSync (anti-pattern)

**Status:** reverted by 2026-05-27 (Этап 1)
**Area:** device-sync

**Context:**
Изначально playback state жил во `frontend/PlayerContext`. Когда добавили multi-device, `DeviceSync` подключили **поверх** существующего плеера. Это породило frontend authority: фронт публиковал nowPlaying, фронт решал кто active, фронт делал transferTo(self) при play.

**Чем плохо:**
- Два устройства = два публикатора → конкуренция на `activeRevision`.
- Lease/transfer state расходился с тем что показывает UI.
- Каждый исправленный race порождал новый ref/useEffect → накопительный долг.
- К 2026-05 насчитывалось 9 разных мест с stale-checks и `if (race condition)` guards в `useDeviceSync.js`.

**Lessons learned:**
- При проектировании любой shared-state системы сначала фиксируется **single source of truth**, потом подключаются UI как receivers.
- "Залатать race ещё одним guard" — ложная экономия. После 3-го guard стоит остановиться и переделать.
- AI-агенты по умолчанию реактивны: на запрос "почини X" они латают, а не пересматривают архитектуру. Это нужно требовать **явно** ("остановись и предложи rewrite если костыли копятся").

**Файлы, которые символизировали проблему (теперь удалены):**
- `isLocalAudioOutputActive`, `suppressAutoClaimUntilRef`, `prevLocalAudioRef`, `claimInFlightRef`, `forceRealtimeRef`, `startStandbyLoops`, `clearStandbyTimers`, `STANDBY_LIST_POLL_MS`, `ACTIVE_POSITION_PUBLISH_MS`, `AUTO_CLAIM_SUPPRESS_MS`, `isStaleActiveRevision`, `isStaleNowPlayingState`.

---

## Шаблон для следующей записи

Скопируй блок ниже, заполни, ставь сверху над предыдущей записью:

```
## YYYY-MM-DD — Название

**Status:** accepted
**Area:**
**Context:**
**Decision:**
**Alternatives considered:**
**Consequences:**
**Files touched:**
**Tests:**
**Чтобы не повторилось:**
```
