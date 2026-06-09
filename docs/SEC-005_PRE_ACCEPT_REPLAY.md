# SEC-005 — pre-accept full replay (before Phase 3)

**Purpose:** re-verify all auth + Phase 2 work before accepting `SEC-005_PHASE3_ACCEPT_CHECKLIST.md`.  
**Phase 3 accept:** explicitly **NOT** until you review replay PASS and say «accept Phase 3 checklist».

---

## Quick prod replay (safe — no e2e overlay)

On VPS:

```bash
cd /opt/music-platform
git pull origin main
bash scripts/verify-auth-security-replay.sh
```

Runs: frontend API base, stream ticket prod 404, proof token infra, prod auth gate, env sanity, log sample.

**Note:** `validate:ai` **auto-skips** on VPS when `AGENTS.md` is absent (slim deploy checkout). That is **not** a prod security failure — dev discipline files are gitignored on VPS by design.

**Expect:** `AUTH SECURITY REPLAY: PASS`

---

## Full replay (e2e mint + restore)

```bash
cd /opt/music-platform
git pull origin main
FULL_E2E=1 bash scripts/verify-auth-security-replay.sh
```

Uses defaults `AUTH_E2E_EMAIL=pop-e2e@earflow.test` (or values from `.env`).

1. Layer A prod gates (validate:ai skipped on VPS)
2. auth-e2e compose up + wait healthy + bootstrap
3. `verify:stream-ticket` mint 200 on overlay
4. grep `stream_ticket_mint` — **no ticket body / JWT**
5. **Mandatory** `restore-prod-after-auth-e2e.sh`  
5. Layer A implied safe again

---

## Browser DoD replay (SEC-013 regression)

```bash
RUN_BROWSER_DOD=1 bash scripts/verify-auth-security-replay.sh
# or combined:
FULL_E2E=1 RUN_BROWSER_DOD=1 bash scripts/verify-auth-security-replay.sh
```

Playwright 8/8 — see `docs/AUTH_ROLLOUT_GATES.md`.

---

## Local / CI (developer machine)

```bash
cd backend/go-api-gateway && go test ./internal/auth/ -run StreamTicket -count=1
npm run validate:ai
```

---

## Manual smoke (required for confidence)

| Step | Expected |
|------|----------|
| Login earflow.ru | session cookies |
| Play HLS track 30s | audio, no CORS error |
| DevTools GET /api/profile | `X-Auth-Proof-Access-Token` |
| curl POST api.earflow.ru/api/auth/stream-ticket | **404** |
| Account revoke-others | 403 MFA or 200 — not silent logout |

---

## When to accept Phase 3

Only after:

- [ ] `verify-auth-security-replay.sh` PASS (prod layer)
- [ ] Optional: `FULL_E2E=1` PASS + restore
- [ ] Optional: browser DoD 8/8 if re-running
- [ ] Manual playback smoke OK
- [ ] You read `docs/SEC-005_PHASE3_ACCEPT_CHECKLIST.md` and explicitly accept

**Until then:** no Phase 3 consume code.
