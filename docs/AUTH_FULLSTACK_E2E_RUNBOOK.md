# PEND-SEC-001 — Full-stack auth/PoP e2e runbook

**Status:** validated (2026-06-05 VPS `ru-vmv2-mini` — `run-auth-fullstack-e2e.sh` PASS)

**Not the same as PEND-SEC-001a** (`npm run test:e2e:pop-live` harness with miniredis + seed-session).

This runbook exercises the **production path**:

- real `go-api-gateway` (`NODE_ENV=production`, PoP enforced)
- real Redis (`redis` + `redis-auth`)
- `security-service`
- `auth-service` + `database-service` + Postgres
- frontend production build
- single-origin edge nginx (`auth-e2e-edge`)
- **no** `/e2e/seed-session`, **no** `/e2e/fixture`, **no** Playwright mock routes

---

## Deploy files to VPS (when `git pull` does not help)

Preflight `MISSING: frontend/e2e/device-proof-fullstack.spec.js` means the server tree **never received** PEND-SEC-001 artifacts (not on your git remote yet, or deploy is an older snapshot).

**From your dev machine** (repo root, Git Bash or WSL):

```bash
bash scripts/pack-auth-e2e-bundle.sh
scp dist/auth-e2e-bundle.tar.gz root@ru-vmv2-mini:/tmp/
ssh root@ru-vmv2-mini 'cd /opt/music-platform && tar -xzf /tmp/auth-e2e-bundle.tar.gz && chmod +x scripts/run-auth-fullstack-e2e.sh scripts/auth-e2e-*.sh'
```

Or copy the same paths with `rsync -av` / WinSCP. Gateway **P1363+DER** fix must already be in the server image (`device_proof_crypto.go`); rebuild `api-gateway` if PoP verify fails.

After files exist on disk:

```bash
test -f /opt/music-platform/frontend/e2e/device-proof-fullstack.spec.js && echo OK
bash /opt/music-platform/scripts/run-auth-fullstack-e2e.sh
```

---

## Prerequisites (server / CI)

| Requirement | Notes |
|-------------|--------|
| Docker + Compose v2 | 8 GB+ RAM recommended |
| Node.js 22+ | For Playwright on host runner |
| `.env` | Copy from `.env.example`; `JWT_SECRET` ≥ 32 chars, DB creds, service keys |
| Ports | `18080` free (override `AUTH_E2E_HOST_PORT`) |

---

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `AUTH_E2E_BASE_URL` | `http://127.0.0.1:18080` | Playwright `baseURL` |
| `AUTH_E2E_ORIGIN` | same as base | CORS / CSRF Origin header |
| `AUTH_E2E_HOST_PORT` | `18080` | Host port for edge nginx |
| `AUTH_E2E_EMAIL` | `pop-e2e@earflow.test` | Test account email |
| `AUTH_E2E_PASSWORD` | `PopE2eTest1` | Test password (≥8, letters+digits) |
| `AUTH_E2E_ALLOWED_ORIGINS` | `http://127.0.0.1:18080,...` | Gateway `ALLOWED_ORIGINS` overlay |

**Forbidden in this stack** (CI guard enforced):

- `ALLOW_COOKIE_AUTH_WITHOUT_PROOF=1`
- `REACT_APP_ALLOW_COOKIE_AUTH_WITHOUT_PROOF=1`
- `REACT_APP_DEVICE_PROOF_REQUIRED=0`

---

## One-command run (VPS)

```bash
cd /opt/music-platform
git pull   # нужны файлы PEND-SEC-001 (spec, compose overlay, runner)
test -f frontend/e2e/device-proof-fullstack.spec.js || { echo "MISSING spec — обновите репо"; exit 1; }

chmod +x scripts/run-auth-fullstack-e2e.sh scripts/auth-e2e-*.sh 2>/dev/null || true
bash scripts/run-auth-fullstack-e2e.sh
```

Runner вызывает Playwright **напрямую** (не зависит от `npm run test:e2e:auth-fullstack` в `package.json`).

Если стек уже поднят (шаги 1–3 вручную):

```bash
cd /opt/music-platform/frontend
npx playwright test e2e/device-proof-fullstack.spec.js --config playwright.auth-fullstack.config.js
```

### Manual steps (equivalent)

```bash
# 1. Stack
docker compose -f docker-compose.yml -f docker-compose.auth-e2e.yml up -d \
  postgres redis redis-auth database-service auth-service security-service \
  api-gateway frontend auth-e2e-edge

# 2. Wait
bash scripts/auth-e2e-wait-healthy.sh

# 3. Bootstrap user (real register/login API)
bash scripts/auth-e2e-bootstrap.sh

# 4. Playwright (from repo root)
cd frontend
npm ci
npx playwright install chromium --with-deps
npx playwright test e2e/device-proof-fullstack.spec.js --config playwright.auth-fullstack.config.js
```

---

## GitHub Actions (manual)

Workflow: `.github/workflows/auth-fullstack-e2e.yml`

- Trigger: **Actions → auth-fullstack-e2e → Run workflow**
- Artifacts: `auth-fullstack-e2e-<run_id>` (Playwright report, traces, service logs)

---

## Expected results (acceptance)

| Step | Expected |
|------|----------|
| Context A: email login → device register → IndexedDB key → `GET /api/profile` | **200** + user JSON |
| Context B: same cookies, no IndexedDB | **401** `DEVICE_PROOF_REQUIRED` |
| Context A after B | **200** |
| `POST /api/auth/refresh` without proof (Context B) | **401** `DEVICE_PROOF_REQUIRED` |

Spec file: `frontend/e2e/device-proof-fullstack.spec.js`

---

## Artifacts to send for review

After run, attach:

1. `frontend/e2e/artifacts/auth-fullstack/report/` (HTML report)
2. `frontend/e2e/artifacts/auth-fullstack/test-results/` (traces/screenshots on failure)
3. `artifacts/auth-e2e/logs/*.log` (from runner script)
4. Console output exit code
5. Gateway image tag / git SHA

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| `Missing script: test:e2e:auth-fullstack` | Старый `package.json` — обновите репо; runner уже зовёт Playwright напрямую |
| `MISSING: frontend/e2e/...` (preflight) | `git pull` / redeploy — нет PEND-SEC-001 файлов |
| Login 200 but empty cookie jar / `register` `NO_SESSION` | `NODE_ENV=production` + empty `COOKIE_DOMAIN` → gateway defaults to **Domain=.earflow.ru** (see `config.go`). curl/Chrome on `127.0.0.1` ignore those cookies. Fix: **`COOKIE_DOMAIN=host`** in auth-e2e overlay + `--force-recreate api-gateway`. `docker exec … env` showing `COOKIE_DOMAIN=` is not enough — must be `host`. |
| `register` `NO_SESSION` (cookies present) | `COOKIE_SECURE=true` on http — set `COOKIE_SECURE=false` and recreate gateway |
| `401 NO_SESSION` on login | `ALLOWED_ORIGINS` vs `AUTH_E2E_ORIGIN` |
| `DEVICE_PROOF_INVALID` | Deploy gateway with P1363+DER verify fix |
| Gateway never healthy | `docker compose logs api-gateway`; missing `.env` secrets |
| Cookies not sent | Use single origin `18080` edge, not separate frontend port |

---

## Policy

- **PEND-SEC-001** closed after VPS PASS (2026-06-05). Re-run on CI via `.github/workflows/auth-fullstack-e2e.yml` when wiring CI secrets.
- **Do not** run full stack on developer laptop by default (resource policy).
- **e2e cookie trap:** `NODE_ENV=production` + empty `COOKIE_DOMAIN` → `.earflow.ru` in gateway `config.go`. Overlay must set **`COOKIE_DOMAIN=host`**.
- Next roadmap step: Postgres SoT (**PEND-SEC-011**).
