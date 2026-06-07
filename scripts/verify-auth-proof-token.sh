#!/usr/bin/env bash
# PEND-SEC-013 — Proof Access Token rollout checks.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.yml)
failures=0

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }

if [[ -f "$ROOT/.env" ]]; then
  # shellcheck source=scripts/load-dotenv.sh
  source "$ROOT/scripts/load-dotenv.sh"
  load_dotenv "$ROOT/.env"
fi

echo "=== PEND-SEC-013 verify (Proof Access Token) ==="

mode="$(grep -E '^AUTH_PG_SOT_MODE=' "$ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r" ' || echo off)"
if [[ "$mode" != "dual_write" ]]; then
  fail "AUTH_PG_SOT_MODE is not dual_write (got: ${mode:-empty})"
else
  pass "AUTH_PG_SOT_MODE=dual_write"
fi

pat_enabled="$(grep -E '^PROOF_ACCESS_TOKEN_ENABLED=' "$ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r" ' || echo 1)"
if [[ "$pat_enabled" == "0" || "$pat_enabled" == "false" ]]; then
  fail "PROOF_ACCESS_TOKEN_ENABLED is disabled"
else
  pass "PROOF_ACCESS_TOKEN_ENABLED active (${pat_enabled:-default})"
fi

if ! "${COMPOSE[@]}" ps api-gateway 2>/dev/null | grep -qE 'Up|running'; then
  fail "api-gateway not running"
else
  pass "api-gateway running"
fi

if ! "${COMPOSE[@]}" ps security-service 2>/dev/null | grep -qE 'Up|running'; then
  fail "security-service not running"
else
  pass "security-service running"
fi

if grep -q 'X-Auth-Proof-Access-Token' "$ROOT/nginx/conf.d/10-global-maps.conf"; then
  pass "nginx CORS includes X-Auth-Proof-Access-Token"
else
  fail "nginx CORS missing X-Auth-Proof-Access-Token"
fi

if grep -q '/api/auth/proof/token' "$ROOT/backend/go-api-gateway/internal/auth/http_routes.go"; then
  pass "gateway route POST /api/auth/proof/token registered"
else
  fail "gateway route /api/auth/proof/token missing"
fi

if grep -q 'epochs/lookup' "$ROOT/backend/security-service/internal/httpapi/server.go"; then
  pass "security internal epochs lookup registered"
else
  fail "security internal epochs lookup missing"
fi

if [[ "${RUN_GO_TESTS:-}" == "1" ]] && command -v go >/dev/null 2>&1; then
  if (cd "$ROOT/backend/go-api-gateway" && go test ./internal/auth/... -run 'ProofAccess|ProofToken|SensitivePath' -count=1 >/dev/null 2>&1); then
    pass "gateway proof access token unit tests"
  else
    fail "gateway proof access token unit tests"
  fi
else
  echo "      (skip go unit tests on VPS — use RUN_GO_TESTS=1 where Go is installed)"
fi

echo ""
echo "Manual (required for DoD):"
echo "  1) Login in browser — DevTools Network: hot GETs send X-Auth-Proof-Access-Token"
echo "  2) POST /api/auth/proof/token returns token + expiresIn (~90s)"
echo "  3) Logout/revoke still requires full ECDSA proof (no token-only)"
echo "  4) Revoke from device A → device B hot requests fail within ~2s (epoch invalidation)"

if [[ "$failures" -eq 0 ]]; then
  echo ""
  echo "PEND-SEC-013 verify: PASS (automated)"
  exit 0
fi
echo ""
echo "PEND-SEC-013 verify: FAIL ($failures)"
exit 1
