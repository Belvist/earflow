#!/usr/bin/env bash
# PEND-SEC-012 — post-rollout checks (epoch revoke pub/sub).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.yml)
failures=0

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }

echo "=== PEND-SEC-012 verify (epoch revoke pub/sub) ==="

if ! "${COMPOSE[@]}" ps security-service 2>/dev/null | grep -qE 'Up|running'; then
  fail "security-service not running"
else
  pass "security-service running"
fi

gw_count="$("${COMPOSE[@]}" ps api-gateway 2>/dev/null | grep -cE 'Up|running' || echo 0)"
if [[ "${gw_count:-0}" -lt 1 ]]; then
  fail "api-gateway not running"
else
  pass "api-gateway replicas=$gw_count"
fi

if command -v npm >/dev/null 2>&1; then
  if (cd "$ROOT/backend/go-api-gateway" && go test ./internal/auth/... -run 'RevokeSubscriber|SessionAuthMiddleware_RejectsLocallyRevoked' -count=1 >/dev/null 2>&1); then
    pass "gateway revoke subscriber unit tests"
  else
    fail "gateway revoke subscriber unit tests — run: cd backend/go-api-gateway && go test ./internal/auth/... -run RevokeSubscriber"
  fi
  if (cd "$ROOT/backend/security-service" && go test ./internal/store/... -run 'PublishRevokeEvent|AuthSoT_RevokeSessionFull_Publishes' -count=1 >/dev/null 2>&1); then
    pass "security-service revoke publish tests"
  else
    fail "security-service revoke publish tests"
  fi
fi

echo ""
echo "Manual (required for DoD):"
echo "  1) Login on device A + B"
echo "  2) Revoke others from A"
echo "  3) Device B profile → 401 within ~2s"
echo "  4) Repeat revoke-others — no errors in logs"

if [[ "$failures" -eq 0 ]]; then
  echo "PEND-SEC-012 verify: PASS (automated)"
  exit 0
fi
echo "PEND-SEC-012 verify: FAIL ($failures)"
exit 1
