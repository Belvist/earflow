# SEC-005 Phase 3 ACCEPT — implementation checklist

**Status:** **closed (2026-06-09)** — VPS `verify:stream-ticket-accept` PASS + `restore-prod-after-auth-e2e.sh` at git `f9da305`  
**Prerequisites:** Phase 2 OBSERVE **closed** (e2e validated + `restore-prod-after-auth-e2e.sh` PASS on VPS)  
**Design:** `docs/SEC-005_WS_STREAM_TICKETS_DESIGN.md` (rev. 2, accepted)  
**Parent:** `PEND-SEC-005` in `docs/PENDING.md`

---

## 0. What Phase 3 does (and does not)

| In scope (ACCEPT) | Out of scope (Phase 4+) |
|-------------------|-------------------------|
| `direct-stream-service` + `ebap-hls-adapter` **verify** scoped tickets | Frontend mint + attach |
| **Dual-mode:** ticket **or** legacy cookie/token still works | `STREAM_TICKET_ENFORCE=1` |
| Local epoch/revoke cache on stream services | WS unify (`WS_TICKET_UNIFIED`) |
| Metric/log when legacy fallback used | Remove cookie-only paths |
| Unit + integration gates | iOS / artist implementation |

**Flag:** `STREAM_TICKET_ACCEPT=1` (default `0`). Prod stays off until staging gate PASS.

---

## 1. Blockers before starting code

```text
[ ] Phase 2 closed on VPS:
      bash scripts/restore-prod-after-auth-e2e.sh → exit 0
      npm run verify:stream-ticket → prod gate PASS (404 mint)
      npm run verify:frontend-api-base → PASS
      api-gateway STREAM_TICKET_ENABLED empty or 0
[ ] grep stream_ticket_mint logs — no ticket body / JWT
[ ] This checklist reviewed + accepted → DECISIONS.md entry
[ ] klm_verify_plan (if KLM available) with file list below
```

**Do not start Phase 3 if** gateway still has `STREAM_TICKET_ENABLED=1` from auth-e2e overlay.

---

## 2. Ticket contracts (mint already implemented — consume must match)

| Kind | Mint output | Transport at consume |
|------|-------------|----------------------|
| `stream_session` | JWT HS256 v1 (`type=stream_session_ticket`) | Header `X-Stream-Session-Ticket` or `Authorization: Bearer` |
| `media` | Opaque ID (Redis `auth:stream_ticket:opaque:*`) | Query `?st=` on byte URL **or** header on fetch |
| `ws` | Opaque one-time | Query `?ticket=` at WS upgrade only |

**Opaque record fields (gateway):** `sid`, `authDeviceId`, `userId`, `sessionEpoch`, `deviceEpoch`, `scope`, `oneTime`.

**Forbidden at consume:** JWT in query; `epochs/lookup` per segment; bare `mp_sid`.

---

## 3. direct-stream-service

### 3.1 New module

| File | Responsibility |
|------|----------------|
| `src/auth/streamTicket.ts` | Parse header JWT + opaque Redis lookup; epoch check |
| `src/auth/streamTicketEpochCache.ts` | In-memory sid/device epoch + revoke tombstones |
| `src/auth/streamTicket.test.ts` | Unit: valid, expired, wrong scope, stale epoch |

### 3.2 Integration points (`main.ts`)

| Path today | Legacy auth | ACCEPT addition |
|------------|-------------|-----------------|
| `authorizePlaybackMedia` | Bearer `playbackToken` + `X-Playback-Session` | Also accept `stream_session` header JWT or `media` opaque |
| `authorizeDirectStream` | `mp_stream` cookie | Also accept `media` opaque query or header |
| HLS segment cache URLs | signed `?sig=` | Ticket layer parallel; do not break CDN cache cardinality |

### 3.3 Dual-mode policy

```text
if STREAM_TICKET_ACCEPT=0 → legacy only (today)
if STREAM_TICKET_ACCEPT=1:
  if valid scoped ticket → authorize
  else if valid legacy → authorize + metric legacy_fallback_total++
  else → 401
```

### 3.4 Epoch / revoke

- Subscribe to same revoke channel as gateway (`earflow:auth:session:revoke:v1`) or HTTP internal hook from gateway — **pick one, document in DECISIONS**.
- On revoke: bump local cache; reject ticket within ≤2s.
- **No** Postgres call per Range/segment.

### 3.5 Config (`.env.example`)

```text
STREAM_TICKET_ACCEPT=0
STREAM_TICKET_REDIS_URL=...          # read opaque tickets (same Redis as gateway auth)
STREAM_TICKET_JWT_SECRET=...         # HS256 v1 — same as gateway JWT_SECRET
STREAM_TICKET_REVOKE_CHANNEL=earflow:auth:session:revoke:v1
```

### 3.6 Tests

- [ ] Unit: ticket valid → 200 path
- [ ] Unit: stale `sessionEpoch` → 401
- [ ] Unit: legacy cookie still works when ACCEPT=1
- [ ] Integration: mint (e2e) → HEAD direct stream with opaque → 200

---

## 4. ebap-hls-adapter

### 4.1 New module

Same pattern as direct-stream: `src/auth/streamTicket.ts` + epoch cache.

### 4.2 Integration (`authorizeHls`)

Today: `mp_hls` cookie and/or signed URL `?token=`.

ACCEPT:

```text
authorizeHls():
  1. Try media opaque (?st= or header) + epoch cache
  2. Try stream_session header JWT for playlist requests
  3. Fall back to existing token/cookie paths
  4. Count legacy_fallback when ticket absent
```

Preserve:

- Signed cache segment URLs (`/audio/v3/cache/...`)
- `playlistTokenOnly` / `assetTokenOnly` behavior
- Range requests

### 4.3 Tests

- [ ] Playlist `.m3u8` with valid opaque → 200
- [ ] Segment with legacy signed URL still works
- [ ] Revoke → next playlist request 401 ≤2s (integration, auth-e2e)

---

## 5. Gateway / ops (minimal Phase 3)

| Item | Action |
|------|--------|
| Mint | No change (Phase 1–2 done) |
| `docker-compose.auth-e2e.yml` | Add `STREAM_TICKET_ACCEPT=1` on **stream services only** for e2e gate |
| `scripts/verify-stream-ticket.sh` | Extend Phase 3 section: mint → consume HEAD (when ACCEPT=1) |
| New script | `scripts/stream-ticket-verify/accept-consume.mjs` — mint media → HEAD `/audio/v3/...` |

**Prod:** `STREAM_TICKET_ACCEPT=0` until staging checklist PASS.

---

## 6. Observability (ACCEPT)

| Signal | Purpose |
|--------|---------|
| `stream_ticket_consume_total{result=ok\|deny\|legacy}` | Dual-mode health |
| `stream_ticket_epoch_stale_total` | Revoke path works |
| Structured log | `stream_ticket_consume` — **no ticket value**; kind, result, userId prefix |

Red flag: log contains full opaque id or JWT → block merge.

---

## 7. Verification gates (Phase 3 close criteria)

### Automated

```bash
# After implementation on auth-e2e profile:
npm run verify:stream-ticket          # mint gates (existing)
# New (to implement):
bash scripts/verify-stream-ticket-accept.sh
```

**`verify-stream-ticket-accept.sh` must:**

| # | Check | Expected |
|---|-------|----------|
| 1 | `STREAM_TICKET_ACCEPT=1` on direct-stream + ebap-hls (e2e only) | env set |
| 2 | Mint `media` ticket | 200 |
| 3 | HEAD playback byte URL with opaque | 200 |
| 4 | Same URL with garbage ticket | 401 |
| 5 | Legacy cookie-only (no ticket) | 200 + legacy metric |
| 6 | Revoke session → retry with old ticket | 401 ≤2s |
| 7 | Prod `STREAM_TICKET_ACCEPT=0` | consume script SKIP; legacy unchanged |

### Manual (staging)

- [ ] Play HLS track 30s — no regression
- [ ] Play direct stream — seek works
- [ ] Revoke other device while playing — next segment fails ≤2s

### Restore after e2e

```bash
bash scripts/restore-prod-after-auth-e2e.sh
```

---

## 8. Implementation order (recommended)

```text
1. streamTicket.ts + epoch cache (direct-stream) + unit tests
2. Wire authorizePlaybackMedia + authorizeDirectStream dual-mode
3. Revoke pub/sub subscriber + integration test
4. Port same module to ebap-hls-adapter authorizeHls
5. verify-stream-ticket-accept.sh + auth-e2e compose flags
6. VPS run → update PENDING Phase 3 → done
7. restore prod
```

**Do not** implement frontend mint until Phase 3 ACCEPT closed on VPS.

---

## 9. Rollback

```text
STREAM_TICKET_ACCEPT=0 → recreate direct-stream + ebap-hls
```

Legacy cookie/token paths remain; no user impact.

---

## 10. Reviewer sign-off (before code)

| # | Condition | PASS |
|---|-----------|------|
| 1 | Phase 2 closed with restore evidence | ☐ |
| 2 | No ENFORCE in Phase 3 scope | ☐ |
| 3 | No per-segment PG/Redis epoch lookup | ☐ |
| 4 | Dual-mode + legacy metric defined | ☐ |
| 5 | Log hygiene specified | ☐ |
| 6 | verify script criteria clear | ☐ |

**Accepted by:** VPS gate `ru-vmv2-mini`  
**Date:** 2026-06-09 (`f9da305`)
