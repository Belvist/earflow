#!/usr/bin/env bash
# PEND-SEC-013 — browser DoD runner (8/8). Required to close SEC-013 phase.
# See docs/AUTH_ROLLOUT_GATES.md
#
# Playwright runs in Docker by default (Node 22 + @playwright/test bundled).
# Host fallback: AUTH_E2E_PLAYWRIGHT_HOST=1 (requires Node >=22).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export AUTH_E2E_BASE_URL="${AUTH_E2E_BASE_URL:-http://127.0.0.1:18080}"
export AUTH_E2E_ORIGIN="${AUTH_E2E_ORIGIN:-$AUTH_E2E_BASE_URL}"
export AUTH_E2E_HOST_PORT="${AUTH_E2E_HOST_PORT:-18080}"
export AUTH_E2E_EMAIL="${AUTH_E2E_EMAIL:-pop-e2e@earflow.test}"
export AUTH_E2E_PASSWORD="${AUTH_E2E_PASSWORD:-PopE2eTest1}"
export AUTH_E2E_ALLOWED_ORIGINS="${AUTH_E2E_ALLOWED_ORIGINS:-http://127.0.0.1:18080,http://localhost:18080,http://auth-e2e-edge:8080}"
export AUTH_E2E_COOKIE_DOMAIN="host"
export AUTH_E2E_COOKIE_SECURE="false"
export AUTH_E2E_COOKIE_SAMESITE="Lax"
# shellcheck source=scripts/auth-e2e-ensure-origins.sh
source "$ROOT/scripts/auth-e2e-ensure-origins.sh"
auth_e2e_ensure_docker_origin
# Short TTL for e2e (gateway min 30s)
export PROOF_ACCESS_TOKEN_TTL_SECONDS="${PROOF_ACCESS_TOKEN_TTL_SECONDS:-30}"
export AUTH_E2E_PROOF_TTL_MIN="${AUTH_E2E_PROOF_TTL_MIN:-30}"
export AUTH_E2E_PROOF_TTL_MAX="${AUTH_E2E_PROOF_TTL_MAX:-95}"
export AUTH_E2E_PROOF_TTL_WAIT_MS="${AUTH_E2E_PROOF_TTL_WAIT_MS:-32000}"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.auth-e2e.yml)
SERVICES=(postgres redis redis-auth database-service auth-service security-service api-gateway frontend auth-e2e-edge)

ARTIFACT_DIR="$ROOT/artifacts/auth-proof-token-dod"
LOG_DIR="$ARTIFACT_DIR/logs"
mkdir -p "$LOG_DIR" "$ARTIFACT_DIR/report"

REQUIRED_FILES=(
  "docs/AUTH_ROLLOUT_GATES.md"
  "frontend/e2e/device-proof-access-token-dod.spec.js"
  "frontend/e2e/helpers/proofAccessTokenDod.browser.js"
  "frontend/playwright.auth-proof-token-dod.config.js"
)
for f in "${REQUIRED_FILES[@]}"; do
  if [[ ! -f "$ROOT/$f" ]]; then
    echo "MISSING: $f" >&2
    exit 1
  fi
done

run_playwright_docker() {
  echo "      (Playwright via Docker — auth-proof-token-dod-playwright)"
  "${COMPOSE[@]}" --profile auth-e2e-run run --rm auth-proof-token-dod-playwright
}

run_playwright_host() {
  echo "      (Playwright on host — requires Node >=22 and local @playwright/test)"
  cd "$ROOT/frontend"
  npm ci --no-audit --no-fund
  if [[ ! -x node_modules/.bin/playwright ]]; then
    echo "FAIL: frontend/node_modules/.bin/playwright missing after npm ci" >&2
    return 1
  fi
  node_modules/.bin/playwright install chromium --with-deps
  node_modules/.bin/playwright test e2e/device-proof-access-token-dod.spec.js \
    --config playwright.auth-proof-token-dod.config.js
}

echo "=== [1/7] Infra verify (does not close SEC-013 alone) ==="
bash "$ROOT/scripts/verify-auth-proof-token.sh" || {
  echo "WARN: infra verify failed — continuing to browser DoD" >&2
}
auth_e2e_ensure_docker_origin
echo "      AUTH_E2E_ALLOWED_ORIGINS=${AUTH_E2E_ALLOWED_ORIGINS}"

echo "=== [2/7] Start auth-e2e stack (PROOF_ACCESS_TOKEN_TTL_SECONDS=${PROOF_ACCESS_TOKEN_TTL_SECONDS}) ==="
"${COMPOSE[@]}" up -d --force-recreate "${SERVICES[@]}"

echo "=== [3/7] Wait for edge health ==="
bash "$ROOT/scripts/auth-e2e-wait-healthy.sh"

echo "=== [4/7] Bootstrap test user ==="
bash "$ROOT/scripts/auth-e2e-bootstrap.sh"

echo "=== [5/7] Playwright SEC-013 browser DoD (8/8) ==="
if [[ "${AUTH_E2E_PLAYWRIGHT_HOST:-0}" == "1" ]]; then
  run_playwright_host
else
  run_playwright_docker
fi
PLAY_EXIT=$?

echo "=== [6/7] Collect logs ==="
cd "$ROOT"
for svc in api-gateway auth-service security-service frontend auth-e2e-edge; do
  "${COMPOSE[@]}" logs --no-color "$svc" > "$LOG_DIR/${svc}.log" 2>&1 || true
done

echo "=== [7/7] Copy artifacts ==="
if [[ -d frontend/e2e/artifacts/auth-proof-token-dod ]]; then
  cp -r frontend/e2e/artifacts/auth-proof-token-dod/* "$ARTIFACT_DIR/report/" 2>/dev/null || true
fi

if [[ "$PLAY_EXIT" -ne 0 ]]; then
  echo ""
  echo "SEC-013 browser DoD: FAIL (Playwright exit $PLAY_EXIT)" >&2
  echo "SEC-013 phase remains PARTIAL — see $ARTIFACT_DIR/report" >&2
  exit "$PLAY_EXIT"
fi

echo ""
echo "SEC-013 browser DoD: PASS (8/8)"
echo "Next: update docs/PENDING.md to closed only after prod DevTools confirmation if needed"
echo "Report: $ARTIFACT_DIR/report/report/index.html (if generated)"
exit 0
