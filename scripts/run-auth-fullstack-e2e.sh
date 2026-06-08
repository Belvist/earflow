#!/usr/bin/env bash
# PEND-SEC-001 — full-stack auth/PoP e2e runner (VPS / CI / server only).
# Does NOT assume local dev machine resources; run on server with Docker + Node 22.
#
# Usage:
#   cp .env.example .env   # fill JWT_SECRET, DB_*, AUTH_E2E_* 
#   ./scripts/run-auth-fullstack-e2e.sh
#
# Artifacts: artifacts/auth-e2e/
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export AUTH_E2E_BASE_URL="${AUTH_E2E_BASE_URL:-http://127.0.0.1:18080}"
export AUTH_E2E_ORIGIN="${AUTH_E2E_ORIGIN:-$AUTH_E2E_BASE_URL}"
export AUTH_E2E_HOST_PORT="${AUTH_E2E_HOST_PORT:-18080}"
export AUTH_E2E_EMAIL="${AUTH_E2E_EMAIL:-pop-e2e@earflow.test}"
export AUTH_E2E_PASSWORD="${AUTH_E2E_PASSWORD:-PopE2eTest1}"
export AUTH_E2E_ALLOWED_ORIGINS="${AUTH_E2E_ALLOWED_ORIGINS:-http://127.0.0.1:18080,http://localhost:18080,http://auth-e2e-edge:8080}"
# Must match docker-compose.auth-e2e.yml (browser cannot store Secure cookies on http://127.0.0.1).
export AUTH_E2E_COOKIE_DOMAIN="host"
export AUTH_E2E_COOKIE_SECURE="false"
export AUTH_E2E_COOKIE_SAMESITE="Lax"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.auth-e2e.yml)
SERVICES=(postgres redis redis-auth database-service auth-service security-service api-gateway frontend auth-e2e-edge)

ARTIFACT_DIR="$ROOT/artifacts/auth-e2e"
LOG_DIR="$ARTIFACT_DIR/logs"
mkdir -p "$LOG_DIR" "$ARTIFACT_DIR/report"

REQUIRED_FILES=(
  "docker-compose.auth-e2e.yml"
  "nginx/auth-e2e-edge.conf"
  "frontend/e2e/device-proof-fullstack.spec.js"
  "frontend/e2e/helpers/popFullStack.browser.js"
  "frontend/playwright.auth-fullstack.config.js"
)
for f in "${REQUIRED_FILES[@]}"; do
  if [[ ! -f "$ROOT/$f" ]]; then
    echo "MISSING: $f" >&2
    echo "Pull latest repo (PEND-SEC-001 files). Try: git pull" >&2
    exit 1
  fi
done

echo "=== [1/6] Start auth-e2e stack (recreate for e2e cookie flags) ==="
"${COMPOSE[@]}" up -d --force-recreate "${SERVICES[@]}"

echo "=== [2/6] Wait for edge health ==="
bash "$ROOT/scripts/auth-e2e-wait-healthy.sh"

echo "=== [3/6] Bootstrap test user ==="
bash "$ROOT/scripts/auth-e2e-bootstrap.sh"

echo "=== [4/6] Playwright full-stack spec ==="
cd "$ROOT/frontend"
if [[ ! -d node_modules ]]; then
  npm ci --no-audit --no-fund
fi
npx playwright install chromium --with-deps

# Direct invoke (works even if package.json not yet has test:e2e:auth-fullstack)
npx playwright test e2e/device-proof-fullstack.spec.js \
  --config playwright.auth-fullstack.config.js
PLAY_EXIT=$?

echo "=== [5/6] Collect service logs ==="
cd "$ROOT"
for svc in api-gateway auth-service security-service frontend auth-e2e-edge; do
  "${COMPOSE[@]}" logs --no-color "$svc" > "$LOG_DIR/${svc}.log" 2>&1 || true
done

echo "=== [6/6] Copy Playwright artifacts ==="
if [[ -d frontend/e2e/artifacts/auth-fullstack ]]; then
  cp -r frontend/e2e/artifacts/auth-fullstack/* "$ARTIFACT_DIR/report/" 2>/dev/null || true
fi

if [[ "$PLAY_EXIT" -ne 0 ]]; then
  echo "FAILED: Playwright exit $PLAY_EXIT" >&2
  echo "See $ARTIFACT_DIR/report and $LOG_DIR" >&2
  exit "$PLAY_EXIT"
fi

echo "PASS: PEND-SEC-001 full-stack e2e"
echo "Report: $ARTIFACT_DIR/report/report/index.html (if generated)"
