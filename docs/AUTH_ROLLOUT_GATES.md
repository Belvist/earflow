# Auth rollout gates (Earflow)

**Purpose:** prevent marking security phases «closed» before browser/prod proof.  
**Invariants:** `INV-SEC-016`, `INV-SEC-017` in `docs/ARCHITECTURE_INVARIANTS.md`.  
**Cursor rule:** `.cursor/rules/earflow-auth-rollout-gates.mdc`.

## Core rule: prepared ≠ closed

| Gate level | What it proves | Closes phase? |
|------------|----------------|---------------|
| Code merged | implementation exists | **No** |
| `verify-*.sh` PASS (infra) | routes, env, CORS, unit tests | **No** |
| **Browser DoD 8/8** | real client headers, TTL, revoke | **Yes** (for that phase) |
| Capacity report | scale claims | Required before «millions» language |

**Forbidden:** closing PEND-SEC-* on script PASS alone; starting WS/stream tickets before SEC-013 browser DoD; «ready for millions» without PEND-SEC-CAPACITY-001.

## Phase order (do not skip)

1. **PEND-SEC-013** — Proof Access Token → browser DoD 8/8  
2. **PEND-SEC-CAPACITY-001** — k6/vegeta hot-path report  
3. **PEND-SEC-005** — WS/stream scoped tickets  
4. MFA / WebAuthn / fresh-login (SEC-003..006) — after above

## SEC-013 browser DoD (8 checks)

Run: `bash scripts/run-auth-proof-token-browser-dod.sh`  
Or Playwright: `cd frontend && npm run test:e2e:auth-proof-token-dod`

| # | Check | Expected |
|---|-------|----------|
| 1 | After login + device register | `POST /api/auth/proof/token` → 200, `expiresIn` ≈ TTL (default ~90) |
| 2 | Hot GET e.g. `/api/profile` | Request includes `X-Auth-Proof-Access-Token` + `X-Auth-Device-Id` |
| 3 | Hot GET | **No** `X-Auth-Device-Proof*` headers |
| 4 | `POST /api/auth/refresh` | Full ECDSA succeeds; token-only → 401 |
| 5 | Sensitive (logout / sessions revoke) | Full ECDSA required; token-only → 401 |
| 6 | After token TTL | New exchange on next hot request (no infinite retry on 401) |
| 7 | Stale/revoked token | Hot GET → 401 |
| 8 | Cross-device revoke | B holds live token → A revokes B session → B hot GET 401 within ≤2s |

**Infra verify (does not close SEC-013):** `bash scripts/verify-auth-proof-token.sh`

**VPS note:** After DoD, run `bash scripts/restore-prod-after-auth-e2e.sh` — e2e overlay sets `EARFLOW_API_BASE_URL=http://127.0.0.1:18080` on prod frontend until restored.

## Frontend API base guard (prod)

Run after auth-e2e/capacity and before declaring prod green:

```bash
npm run verify:frontend-api-base
# or full gate:
npm run verify:prod-auth-gate
```

**Fails if** `runtime-config.js` or frontend container env contains `127.0.0.1`, `localhost`, `:18080`, or `auth-e2e` in `apiBaseUrl`.  
**Prod norm:** `EARFLOW_API_BASE_URL` empty in `.env` and container → `apiBaseUrl: ""` in `/runtime-config.js`.

## SEC-005 stream ticket OBSERVE (Phase 2)

Mint only — no consume/enforce on prod.

```bash
npm run verify:stream-ticket
```

**Prod:** `STREAM_TICKET_ENABLED=0` → `POST /api/auth/stream-ticket` → **404**.  
**Auth-e2e:** overlay sets `STREAM_TICKET_ENABLED=1`; script runs `mint-observe.mjs` (media, stream_session, ws mint).

**Status:** Phase 2 **closed** (2026-06-09 restore prod on `ru-vmv2-mini`). Phase 3 — accept checklist then code.

| Gate | Command context | Expect |
|------|-----------------|--------|
| Auth-e2e mint | overlay `STREAM_TICKET_ENABLED=1` | verify → PASS (mint 200) |
| Restore prod | `bash scripts/restore-prod-after-auth-e2e.sh` | exit 0; `STREAM_TICKET_ENABLED` off |
| Prod after restore | prod compose | verify → PASS (404 on mint); `verify:frontend-api-base` PASS |

After restore PASS, update `PENDING.md` Phase 2 → **done**. **Do not start Phase 3 code** until `docs/SEC-005_PHASE3_ACCEPT_CHECKLIST.md` accepted.

**VPS log check (e2e):**

```bash
docker compose logs api-gateway --tail=100 | grep -i stream_ticket_mint
# expect: kind/ticketType/transport — no full ticket value
```

## SEC-005 Phase 3 ACCEPT (consume dual-mode)

**Plan only until checklist accepted:** `docs/SEC-005_PHASE3_ACCEPT_CHECKLIST.md`

| Prerequisite | Required |
|--------------|----------|
| Phase 2 closed | restore prod PASS |
| Checklist accepted | DECISIONS entry |
| Code allowed | `STREAM_TICKET_ACCEPT` on stream services (e2e first) |

**Forbidden in Phase 3:** `STREAM_TICKET_ENFORCE=1`, frontend mint, cookie fallback removal.

**Close Phase 3 when:** `verify-stream-ticket-accept.sh` PASS on auth-e2e + manual playback smoke + restore prod.

## SEC-005 Phase 4 — frontend mint (staging)

One-shot on VPS:

```bash
npm run run:sec005-phase4-staging
```

Or manual: auth-e2e overlay **rebuilds frontend** with `REACT_APP_STREAM_TICKET_MINT_ENABLED=1` → `npm run verify:stream-ticket-phase4` → `restore-prod`.

| Check | Expect |
|-------|--------|
| Bundle marker | `main.*.js` contains `earflow:stream-ticket-mint:1` |
| Client path | `accept-consume.mjs` PASS (mint + `?st=` HEAD 200) |
| Restore prod | `STREAM_TICKET_*` off; bundle `mint:0` on earflow.ru |

**Forbidden:** prod `STREAM_TICKET_ACCEPT=1` until Phase 4 + Phase 5 staging PASS.

**Universal verify discipline:** `docs/ENGINEERING_VERIFICATION_PLAYBOOK.md` + skill `engineering-verification`.

## Agent checklist

Before marking SEC-013 closed:

- [ ] `run-auth-proof-token-browser-dod.sh` exit 0 (or documented manual 8/8 DevTools)
- [ ] `docs/PENDING.md` status updated only after browser gate
- [ ] No scale language until capacity report
- [ ] Report to user: norm / debt / verify (`INV-FE-008` pattern where escape hatches exist)

## Rollout mistakes (do not repeat)

- Wide PoP on `/api/*` with narrow test matrix (CORS, artists, refresh, stream broke)
- Deploy without pinning single SHA across gateway + security + frontend
- Claiming «closed» after backend PASS without browser headers proof
