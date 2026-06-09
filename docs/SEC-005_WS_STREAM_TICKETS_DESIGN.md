# SEC-005 — WS/HLS scoped tickets (impact + design plan)

**Status:** **accepted (rev. 2, 2026-06-08)** — design only; implementation Phase 1 gateway mint in progress  
**Date:** 2026-06-08 (rev. 2)  
**Prerequisites:** SEC-013 closed, PEND-SEC-CAPACITY-001 closed  
**Goal:** remove **bare `mp_sid` cookie-only** as sufficient auth for WS upgrade and stream playback; bind stream/WS access to **device-bound, epoch-aware, short-lived scoped tickets**.

> This is **not** a rewrite of streaming. It extends the existing proof-token model to WS/HLS/direct-stream **consume** paths.

**v1 implementation scope:** listener **web SPA only**. iOS/Android and artist portal — **contract documented**, separate milestones.

---

## 0. Review verdict (2026-06-08)

```text
SEC-005 status:
✅ impact correct
✅ goal correct
✅ design accepted (rev. 2, 2026-06-08)
✅ Phase 1 gateway mint committed
✅ Phase 2 OBSERVE closed (VPS restore 2026-06-09)
⏭️ Phase 3 ACCEPT — checklist ready; accept before code
❌ ENFORCE / stream-service consume not started
```

Three architectural risks from rev. 1 were corrected in this revision:

| Risk (rev. 1) | Fix (rev. 2) |
|---------------|--------------|
| Header-only ticket for all transports | Transport-specific: header vs opaque query vs signed URL (§4, §9) |
| `epochs/lookup` per HLS segment | Local verify + local epoch/revoke cache + pub/sub; PG only at mint (§7, §8) |
| HS256 secret sprawl to all stream services | Asymmetric signing for header JWT; opaque Redis for query/WS; HS256 only as explicit v1 temp (§5) |

---

## 1. Impact summary

### What works today

| Surface | Session mint (REST) | Bytes / upgrade (consume) |
|---------|---------------------|---------------------------|
| `/api/*` hot path | `mp_sid` + PoP or proof access token | PoP or proof token |
| `/api/stream/v3/session`, `/api/ebap-hls/v1/session` | `require_user` + **full PoP** at gateway | — |
| `/ws/devices` | `POST /api/devices/ws-ticket` (PoP on mint) | JWT `?ticket=` verified by device-sync-service |
| `/ws/v2` (party) | `GET /api/party/{id}/ws-ticket` | HMAC `?wsToken=` verified at gateway + party-go |
| HLS v3 playback | — | `Authorization: Bearer playbackToken` + `X-Playback-Session` |
| Direct stream | — | `mp_stream` httpOnly cookie (HMAC, IP/UA bind) |
| EBAP HLS | — | `mp_hls` / `mp_lyrics` cookies + optional URL `?token=` |

### Gaps (why SEC-005 exists)

1. **Gateway skips session + PoP on `/ws/*`** (`session_manager.go` — intentional). Security = ticket only; ticket formats are **inconsistent** (device-sync JWT vs party HMAC).
2. **Playback tokens/cookies lack `authDeviceId`, `sessionEpoch`, `deviceEpoch`** — revoke does not invalidate in-flight `playbackToken` / `mp_stream` / `mp_hls` the way proof access token does.
3. **`/audio/v3/*` has `require_user: false`** at gateway — correct for CDN, but consume auth is **decoupled** from device PoP binding.
4. **`mp_sid` alone is insufficient for `/api/*`** but **stream session cookies are not device-bound** at playback time.
5. **Tickets in query strings** (`?ticket=`, `?wsToken=`) — leak risk in nginx access logs unless masked; **JWT must never appear in URL**.

### Impact if we do nothing

- Stolen session cookie (without device key) still cannot call `/api/*`.
- Stolen **playback token / `mp_stream` / `mp_hls`** or **WS ticket** remains valid until TTL — no epoch coupling.
- Post-revoke playback may continue until token/cookie TTL (minutes), unlike hot API path (≤2s).

### Scope of change (estimated)

| Layer | Touch |
|-------|-------|
| Gateway | Mint routes, asymmetric signing, opaque ticket store (Redis), epoch embedding |
| direct-stream-service | Local ticket verify + local epoch/revoke cache |
| ebap-hls-adapter | Same |
| device-sync-service | Phase 2: opaque `ws_connect_ticket` (optional unify) |
| party-go | Phase 2: shorter connect ticket TTL |
| nginx | Log masking (`arg_ticket`), signed URL forwarding, header forwarding |
| frontend (listener web) | Mint before playback/WS; transport-appropriate ticket attach |
| docs/tests | Gate scripts, e2e, rollback flags |

**Out of scope SEC-005 v1:** MFA, WebAuthn, fresh-login, CSP/XSS, artist-frontend, iOS/Android implementation.

---

## 2. Current cookie-only / weak-binding route matrix

### WebSocket upgrades

| Path | Gateway session | Gateway PoP | Upgrade auth |
|------|-----------------|-------------|--------------|
| `/ws/devices` | **skipped** | **skipped** | `?ticket=` JWT (device-sync) |
| `/ws/v2` | **skipped** | **skipped** | `?wsToken=` HMAC (party) |

Mint paths (require PoP today when session present):

- `POST /api/devices/ws-ticket` → device-sync-service
- `GET /api/party/{partyId}/ws-ticket` → party-go

### Stream session mint (PoP required at gateway)

| Path | class | require_user | PoP |
|------|-------|--------------|-----|
| `POST /api/stream/v3/session` | unsafe | true | yes |
| `POST /api/stream/v3/session/{id}/refresh` | unsafe | true | yes |
| `POST /api/ebap-hls/v1/session` | unsafe | true | yes |
| `POST /api/stream/v2/*` | unsafe | true | yes (service returns 410) |

### Stream playback (no gateway user / no PoP)

| Path | Gateway require_user | Consume auth |
|------|---------------------|--------------|
| `GET /audio/v3/direct/{sessionId}/stream` | false | `mp_stream` cookie |
| `GET /audio/v3/tracks/...` (HLS v3) | false | Bearer `playbackToken` + `X-Playback-Session` |
| `GET /api/ebap-hls/v1/...` (segments) | true* | `mp_hls` cookie / URL token |
| `strmhaha.earflow.ru/audio/v3/...` | false (CDN) | same as direct-stream |

\* EBAP prefix route has `require_user: true` but bytes auth is cookie/token at adapter.

**SEC-005 target surfaces for new ticket:**

- Playback bytes: `/audio/v3/*`, strmhaha mirror, `/api/ebap-hls/v1/*` assets
- WS upgrades: opaque connect ticket (unify in phase 2)
- **Not** replacing session mint PoP — session mint stays; ticket is **additional scoped credential for consume**

---

## 3. Ticket types (three distinct credentials)

Do **not** use one format/transport for all surfaces.

### 3.1 `stream_session_ticket`

| Property | Value |
|----------|-------|
| Purpose | Authenticate `POST /api/stream/v3/session`, refresh, EBAP session mint (if needed as separate step) |
| Transport | **Header only:** `Authorization: Bearer` or `X-Stream-Ticket` |
| Format | **Asymmetric JWT** (ES256/EdDSA, gateway signs, services verify via JWKS) — see §5 |
| TTL | 60–90 s |
| Storage | In-memory on client (like proof access token); **never** localStorage |

### 3.2 `media_access_ticket`

| Property | Value |
|----------|-------|
| Purpose | HLS segments, direct stream range, EBAP asset bytes, CDN (`strmhaha`) |
| Transport | **Signed URL** or **opaque query token** (`?t=<opaque_id>`) — **not JWT in URL** |
| Format | **Opaque one-time or short-lived Redis record** (preferred); optional asymmetric JWT only when fetch/MSE can send headers |
| TTL | 60–90 s |
| Notes | Native `<audio>`, hls.js segment fetches, Range requests, CDN often **cannot** attach custom headers |

**Transport matrix:**

| Consumer | Preferred transport |
|----------|---------------------|
| JSON/API stream session | Header |
| fetch / MSE / hls.js (custom fetch) | Header if wrapper supports it |
| `<audio>` / native player | Signed URL or opaque query |
| HLS segment storm | Opaque query on signed cache URL or parallel header via fetch wrapper |
| direct stream Range (CDN) | Signed URL / cookie-to-ticket bridge during migration |
| strmhaha CDN | Signed URL + opaque query; forward auth metadata without JWT in path |

### 3.3 `ws_connect_ticket`

| Property | Value |
|----------|-------|
| Purpose | Browser WebSocket upgrade only (not connection lifetime) |
| Transport | **Query** `?ticket=<opaque_id>` (practical for browser WS API) or `Sec-WebSocket-Protocol` (alternative, needs careful logging) |
| Format | **Opaque one-time** Redis ticket — **never JWT in query** |
| TTL | **15–60 s** |
| Use | Validate once at upgrade → mark used / delete → server holds authorized connection context |

**WS lifetime vs connect ticket:**

```text
connect ticket TTL:     15–60s  (open handshake only)
WS connection lifetime: may be longer
heartbeat / reauth:     separate mechanism (out of SEC-005 v1 unless required for revoke)
on revoke:              active WS closed or denied new server messages ≤2s
```

---

## 4. Transport rules (not header-only)

**Rule:** choose transport by **how the bytes are fetched**, not by ideal security preference.

| Type | How to pass ticket |
|------|-------------------|
| JSON/API stream session | Header: `Authorization` / `X-Stream-Ticket` |
| WebSocket browser connect | Opaque query ticket or `Sec-WebSocket-Protocol` |
| HLS/media segments | Signed URL / opaque query ticket + log masking |
| direct stream Range | Header if fetch/MSE; else signed URL / cookie-to-ticket bridge |

**Critical:** if ticket appears in query string, it **must** be opaque random ID — **never JWT**. JWT in URL leaks via logs, history, CDN, Referer.

**Forbidden:**

- JWT in query string (any surface)
- Per-user ticket embedded in cacheable CDN path (breaks cache cardinality)
- localStorage for any ticket type

---

## 5. Secret / signing model

### Target architecture (accepted direction)

```text
Header tickets (stream_session_ticket):
  asymmetric JWT (ES256 or EdDSA)
  gateway signs with private key
  stream services verify with JWKS public key only
  → services cannot mint valid tickets if compromised

Query/WS tickets (media_access_ticket, ws_connect_ticket):
  opaque random token
  Redis (or gateway-owned store) holds payload + TTL + one-time flag
  stream/WS service introspects locally or via internal validate (not per-segment PG)
```

### v1 temporary option (explicit tech debt if chosen)

| Option | Assessment |
|--------|------------|
| **HS256 shared secret** | Acceptable **only** as v1 internal shortcut; secret sprawl risk (gateway + direct-stream + ebap-hls + future nginx/lua) — one leak allows **minting**, not just verify |
| **Asymmetric + JWKS** | **Preferred** for header JWT tickets |
| **Opaque Redis** | **Required** for query/WS/media URL tickets |

If v1 ships HS256 for header tickets, record in `DECISIONS.md` as **temporary** with removal milestone and rotation story. Do not present HS256 as final architecture.

**Rotation:** asymmetric keys via JWKS endpoint; opaque tickets expire by TTL regardless.

---

## 6. Mint owner: gateway

### Decision

**Gateway mints** all three ticket types via authenticated endpoint(s). Stream services and WS handlers **verify** signature (JWT) or **introspect** opaque ID (Redis).

### Rationale

| Option | Pros | Cons |
|--------|------|------|
| **Gateway mint** (recommended) | Same authority as proof access token; epoch cache + revoke pub/sub already in gateway; single rotation story | Stream services need verify library + local cache |
| Stream-service mint | Local to playback | Duplicates epoch lookup; splits auth ownership (`INV-ARCH-001` risk) |
| Per-service tickets (status quo) | Already works for WS | 3+ formats/secrets; no epoch on playback |

### Proposed endpoint

```http
POST /api/auth/stream-ticket
Authorization: session cookies + X-Auth-Device-Id
X-Auth-Proof-Access-Token: <allowed for playback/media mint>
X-Auth-Device-Proof-*: <required for ws_connect / sensitive scopes>

{
  "kind": "stream_session" | "media" | "ws",
  "scope": { "sessionId", "trackId", "partyId", "deviceId", "roomId", ... },
  "client": "web"
}

→ 200 {
  "ticket": "<jwt or opaque_id>",
  "ticketType": "stream_session_ticket" | "media_access_ticket" | "ws_connect_ticket",
  "transport": "header" | "query" | "signed_url",
  "expiresIn": 60,
  "signedUrl": "<optional for media>"
}
```

### Auth policy at mint

| Operation | Proof access token | Full ECDSA PoP |
|-----------|-------------------|----------------|
| `media` playback ticket | **Allowed** (hot-path adjacent) | Fallback allowed |
| `stream_session` ticket | Allowed | Fallback allowed |
| `ws_connect` ticket | Configurable; default full PoP | Required for sensitive WS |
| revoke / logout / refresh / password / 2fa | **Not applicable** — remain full ECDSA only | — |

**Mint-time epoch check (once):**

```text
gateway at mint:
  session auth → userId, sid
  device proof (per policy above)
  load sessionEpoch + deviceEpoch from proof epoch cache / PG (single lookup)
  embed epochs in JWT payload OR store in Redis record for opaque tickets
```

No PG/internal API call at consume time per segment.

---

## 7. Validation flow (no per-segment epoch lookup)

### Principle

```text
mint:     one-time sid/device/epoch verification
consume:  local verify only — no PG, no internal epochs/lookup per byte request
```

### Consume — header JWT (`stream_session_ticket`)

1. Verify asymmetric signature via JWKS (or HS256 v1 temp).
2. Check `typ`, `aud`, `exp`, scope.
3. Check `sessionEpoch` / `deviceEpoch` against **local revoked/epoch cache** on stream service.
4. Reject if epoch stale or session/device revoked.

### Consume — opaque (`media_access_ticket`, `ws_connect_ticket`)

1. Lookup opaque ID in Redis (or local replica/cache with TTL).
2. Check not used (WS: mark used on connect); check exp; check scope matches path.
3. Check epoch fields in stored record against **local revoked/epoch cache**.
4. For media: may return short-lived derived credential for burst segment fetches without re-hitting Redis every byte (design detail at implement — bounded TTL ≤ ticket TTL).

### Consume — WebSocket

1. `wss://.../ws?ticket=<opaque_id>` — validate once at upgrade.
2. Delete or mark one-time ticket used.
3. Attach `userId`, `sid`, `authDeviceId`, epochs to connection context.
4. On revoke event: **close connection** or stop delivering server-initiated messages ≤2s.

### Consume — playback bytes

1. Prefer opaque query on signed URL for CDN/native paths.
2. fetch/MSE path: header JWT or opaque as designed in frontend wrapper.
3. Match `scope.sessionId` / `trackId` to request path.
4. **Dual-mode / enforce:** see §12.

### What is explicitly forbidden at consume

- `epochs/lookup` or PG query **per HLS segment** or **per Range request**
- Accepting bare `mp_sid` in ENFORCE mode
- JWT in query string

---

## 8. Revoke / epoch invalidation + active connections

Reuse SEC-012/013 machinery with **stream-service local cache**:

```text
revoke session → sessionEpoch++ (PG SoT)
              → pub/sub event (security/gateway)
              → gateway proofEpochCache update
              → stream-service / WS handler local revoked/epoch cache update
              → old tickets rejected ≤2s on next validate
```

| Mechanism | Role |
|-----------|------|
| Epochs embedded at mint | Bound ticket to point-in-time auth state |
| Pub/sub revoke events | Push epoch bump to all stream-service replicas |
| Local epoch/revoke cache | O(1) check per request without PG |
| Short TTL | Fallback if pub/sub missed — ticket dies anyway |
| Active WS close | Connection terminated or frozen on revoke ≤2s |
| Active playback | Next segment/range request fails; mid-chunk kill not required |

**Target:** revoked session → new ticket mint fails immediately; existing tickets rejected ≤2s.

**Non-goal:** instant kill mid-byte-range without waiting for next segment request (acceptable).

---

## 9. Log / leak hygiene

| Risk | Mitigation |
|------|------------|
| JWT in URL | **Forbidden** — use opaque ID only in query |
| `?ticket=` / `?t=` in WS/media URL logged by nginx | Custom `log_format` masks `arg_ticket`, `arg_t`, `arg_wsToken`; never log full token in app logs |
| Header tickets in access logs | Do **not** log `$http_authorization` or `$http_x_stream_ticket` |
| localStorage | **Forbidden** — in-memory only |
| Referer leakage | Opaque short TTL; signed URLs scoped to path |
| Persistent HLS URLs with embedded user secret | **Forbidden** — keep cache URLs signed separately (`?sig=`); ticket is parallel short-lived layer |

### nginx masking (required before ENFORCE)

```nginx
# Example pattern — exact map in implementation
map $arg_ticket $log_ticket { default $arg_ticket; ~^(.{8}).+ $1…; }
# Or omit query args from access log for /ws/* and /audio/v3/*
```

---

## 10. HLS / range / CDN constraints

### Must preserve

- **Range requests** (`Range:` header) on `strmhaha` and `/audio/v3/`.
- **Signed cache segment URLs** (`/audio/v3/cache/...`) — unsigned rejected (`verify-cdn-strmhaha.sh`).
- **X-Accel-Redirect** / MinIO internal paths unchanged.
- **Low cache cardinality** — do not put per-user JWT in cacheable URL path.

### Design rules

1. **Media bytes:** opaque query or signed URL — not header-only assumption.
2. hls.js: custom `fetch` attaches header when possible; fallback to opaque query on segment URL.
3. CDN (`strmhaha.earflow.ru`): nginx forwards required auth metadata; masks query tokens in logs.
4. CORS: add `X-Stream-Ticket` to allowed headers on stream locations where fetch uses headers.
5. **Prefetch:** `useHlsPrefetch.js` must not cross-contaminate tickets between tracks.

### iOS / artist (contract only in v1)

Document ticket contract for native clients; implementation in separate milestones. Dual-mode cookie bridge may remain documented for iOS until native ships — **not** SEC-005 v1 code.

---

## 11. TTL summary

| Ticket type | TTL | Notes |
|-------------|-----|-------|
| `stream_session_ticket` | 60–90 s | Header JWT |
| `media_access_ticket` | 60–90 s | Opaque; aligns with proof access token |
| `ws_connect_ticket` | **15–60 s** | One-time; not WS connection lifetime |
| Party connect (unify) | **30–60 s** | Reduce from current 5 min **connect** ticket only |
| Legacy `mp_stream` cookie | 1800 s today | Deprecated in ENFORCE mode |

**Rule:** ticket TTL ≤ proof access token TTL for playback-class tickets.

---

## 12. Migration plan

### Flags

| Flag | Default | Meaning |
|------|---------|---------|
| `STREAM_TICKET_ENABLED` | `0` | Mint endpoint live |
| `STREAM_TICKET_OBSERVE` | `0` | Mint + log ticket presence; legacy still sole auth |
| `STREAM_TICKET_ACCEPT` | `0` | Ticket accepted alongside legacy; metric on legacy fallback |
| `STREAM_TICKET_ENFORCE` | `0` | Ticket required; cookie-only rejected |
| `WS_TICKET_UNIFIED` | `0` | device-sync/party use gateway opaque connect ticket |

### Phases

| Phase | Name | Deliverable |
|-------|------|-------------|
| **0** | Plan accept | DECISIONS entry; this doc status → accepted |
| **1** | Mint | Gateway mint + asymmetric sign + opaque store; unit tests |
| **2** | OBSERVE | Services log ticket presence; legacy auth unchanged |
| **3** | ACCEPT | direct-stream + ebap-hls dual-mode verify |
| **4** | Frontend | Listener web mints tickets; transport-appropriate attach |
| **5** | Staging | ACCEPT → ENFORCE e2e gates |
| **6** | Prod ACCEPT | Dual path with warning metrics |
| **7** | Prod ENFORCE | No cookie-only fallback |
| **8** (optional) | WS unify | Opaque connect tickets for device-sync + party |

```text
Rollback: ENFORCE → ACCEPT → OBSERVE/off → redeploy prior images
```

Playback reverts to `playbackToken` / `mp_stream` / `mp_hls`. Mint endpoint harmless if unused.

---

## 13. Resolved design decisions (reviewer answers 2026-06-08)

| # | Question | Decision |
|---|----------|----------|
| 1 | Proof access token for playback ticket mint? | **Yes** for `media` and `stream_session`. Full ECDSA remains for revoke/logout/refresh/security. |
| 2 | Epoch check per segment? | **No.** Local cache + pub/sub + short TTL. PG/internal lookup **only at mint**. |
| 3 | WS ticket in query? | **Yes**, but **opaque one-time only** — not JWT. Log masking required. |
| 4 | Party 5 min TTL? | **Reduce connect ticket to 30–60 s.** Connection lifetime separate. |
| 5 | iOS/artist in v1? | **No implementation.** Contract documented; web listener only in v1. |

---

## 14. Tests / gates

### Unit

- Gateway: mint auth policy; scope validation; epoch embedded at mint; opaque one-time semantics.
- Stream services: local epoch cache update on pub/sub; no PG mock per segment test.
- Revoke: mint → revoke → verify fails ≤2s; WS connection closed.

### Integration

- `scripts/verify-stream-ticket.sh` (new): mint → playback HEAD → 200; revoke → 401.
- Extend `verify-cdn-strmhaha.sh`: opaque query + signed URL path.
- nginx log format: masked query args (grep prod config).
- No regression: `verify:cors-pop` stream session routes.

### Browser e2e (listener web)

- Play track HLS + direct: mint → play → seek.
- Revoke while playing → next segment fails ≤2s.
- WS device-sync: opaque connect ticket (phase 8).

### Red flags (auto-fail review)

- JWT in query string
- `epochs/lookup` per segment in code path
- HS256 presented as final without DECISIONS temp flag
- Ticket without `authDeviceId` or epoch
- TTL > 5 min for connect tickets
- `mp_sid` alone opens playback in ENFORCE mode
- Ticket in localStorage
- Query ticket logged verbatim in nginx prod format

---

## 15. Files expected (implementation phase — do not start yet)

| Area | Files |
|------|-------|
| Gateway | `internal/auth/stream_ticket.go`, JWKS, opaque store, `http_routes.go`, `gateway.yaml` |
| direct-stream | `src/auth/streamTicket.ts`, local epoch cache, `main.ts` middleware |
| ebap-hls | `src/auth/streamTicket.ts`, `authorizeHls` |
| Frontend | `streamTicket.js`, `DirectSession.ts`, `HlsSession.ts`, `useDeviceSync.js` |
| nginx | log masking maps, strmhaha/api stream locations |
| ops | `scripts/verify-stream-ticket.sh`, `.env.example` flags |
| docs | `DECISIONS.md`, `PENDING.md`, optional `INV-SEC-*` |

---

## 16. Acceptance criteria for plan

- [x] Transport split: header vs opaque query vs signed URL (not header-only)
- [x] No per-segment epoch lookup — local cache + pub/sub documented
- [x] Secret model: asymmetric for header JWT; opaque for query/WS; HS256 only as explicit temp
- [x] Three ticket types defined
- [x] nginx query masking + active connection revoke behavior
- [x] v1 scope: listener web only
- [x] **Reviewer accepts rev. 2 as architecture** → `DECISIONS.md` 2026-06-08
- [x] Phase 1 gateway mint — done
- [x] Phase 2 OBSERVE — **closed** (restore prod 2026-06-09)
- [ ] Phase 3 ACCEPT checklist accepted → `docs/SEC-005_PHASE3_ACCEPT_CHECKLIST.md`

**Phase 3 allowed after checklist accept:** dual-mode consume in direct-stream + ebap-hls only. **Forbidden:** ENFORCE, frontend mint, per-segment epoch lookup.

---

## 17. Reviewer acceptance checklist (8 conditions)

Explicit mapping for architecture accept. All **PASS** in rev. 2 as of 2026-06-08.

| # | Condition | PASS | Where in doc |
|---|-----------|------|--------------|
| 1 | **Not header-only** — API/stream session = header; WS = opaque query or subprotocol; HLS/media/direct = signed URL / opaque query / bridge; native = contract-only | ✅ | §3, §4, §10 |
| 2 | **No JWT in query** — opaque random token only in URL | ✅ | §3.2, §3.3, §4, §9 |
| 3 | **No `epochs/lookup` per segment** — mint once; consume = local verify + local epoch/revoked cache | ✅ | §6 (mint), §7, §8 |
| 4 | **Revoke path** — pub/sub + local cache + short TTL; active WS closed / next segment fails ≤2s | ✅ | §3.3, §7, §8 |
| 5 | **Secret model** — asymmetric JWT/JWKS preferred for header tickets; opaque Redis for query/WS; HS256 only as explicit v1 temp with DECISIONS debt | ✅ | §5 |
| 6 | **Three ticket types** — `stream_session_ticket`, `media_access_ticket`, `ws_connect_ticket` (not one universal ticket) | ✅ | §3 |
| 7 | **Migration** — OBSERVE → ACCEPT → ENFORCE; ENFORCE = no cookie-only fallback; rollback ENFORCE → ACCEPT → OFF | ✅ | §12 |
| 8 | **v1 scope** — listener web implementation only; iOS/artist contract documented, not v1 code | ✅ | §1, §10, §13 #5 |

**Prerequisites cleared (PENDING hygiene 2026-06-08):**

- `PEND-SEC-014` — closed/superseded (SEC-013 browser DoD + `verify:cors-pop` deploy script)
- `PEND-SEC-015` — closed (SEC-013 browser DoD check #4: refresh PoP)
- `PEND-SEC-016` — closed/superseded (unit contract tests + SEC-013 profile hot path browser)

**Accepted 2026-06-08.** Phase 1 gateway mint in progress; consume enforcement blocked until Phase 1 reviewed.
