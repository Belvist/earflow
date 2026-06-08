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

**VPS note:** Playwright runs in Docker (`auth-proof-token-dod-playwright`); `ALLOWED_ORIGINS` must include `http://auth-e2e-edge:8080`. Host Node 18 is unsupported. Override: `AUTH_E2E_PLAYWRIGHT_HOST=1` only with Node >=22.

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
