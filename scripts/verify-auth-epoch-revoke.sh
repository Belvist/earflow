#!/usr/bin/env bash
# PEND-SEC-012 — post-rollout checks (epoch revoke pub/sub).
# VPS: runtime checks only (no go test — prod hosts usually lack Go toolchain).
# CI/dev: set RUN_GO_TESTS=1 to run unit tests when `go` is installed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.yml)
failures=0
REVOKE_CHANNEL="${AUTH_REVOKE_PUBSUB_CHANNEL:-earflow:auth:session:revoke:v1}"

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }

redis_auth_cli() {
  if [[ -n "${REDIS_PASSWORD:-}" ]]; then
    "${COMPOSE[@]}" exec -T redis-auth redis-cli -a "$REDIS_PASSWORD" "$@" 2>/dev/null
  else
    "${COMPOSE[@]}" exec -T redis-auth redis-cli "$@" 2>/dev/null
  fi
}

if [[ -f "$ROOT/.env" ]]; then
  # shellcheck source=scripts/load-dotenv.sh
  source "$ROOT/scripts/load-dotenv.sh"
  load_dotenv "$ROOT/.env"
fi

echo "=== PEND-SEC-012 verify (epoch revoke pub/sub) ==="

mode="$(grep -E '^AUTH_PG_SOT_MODE=' "$ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r" ' || echo off)"
if [[ "$mode" != "dual_write" ]]; then
  fail "AUTH_PG_SOT_MODE is not dual_write (got: ${mode:-empty}) — SEC-012 expects 011 active"
else
  pass "AUTH_PG_SOT_MODE=dual_write"
fi

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

if redis_auth_cli ping | grep -q PONG; then
  pass "redis-auth reachable"
else
  fail "redis-auth ping failed"
fi

# PUBLISH returns the number of subscribers on the channel (gateway replicas).
verify_payload='{"sid":"sid_verify_pubsub_only0001","userId":0,"sessionEpoch":1,"reason":"verify","issuedAt":"2026-06-07T00:00:00Z"}'
sub_count="$(redis_auth_cli PUBLISH "$REVOKE_CHANNEL" "$verify_payload" | tr -d '\r\n' || echo 0)"
echo "      revoke channel=$REVOKE_CHANNEL subscribers=$sub_count"
if [[ "${sub_count:-0}" -ge 1 ]]; then
  pass "gateway revoke subscriber(s) connected (redis PUBLISH receivers=$sub_count)"
else
  fail "no gateway subscribers on $REVOKE_CHANNEL — recreate api-gateway after SEC-012 deploy"
fi

if [[ "${RUN_GO_TESTS:-}" == "1" ]] && command -v go >/dev/null 2>&1; then
  if (cd "$ROOT/backend/go-api-gateway" && go test ./internal/auth/... -run 'RevokeSubscriber|SessionAuthMiddleware_RejectsLocallyRevoked' -count=1 >/dev/null 2>&1); then
    pass "gateway revoke subscriber unit tests"
  else
    fail "gateway revoke subscriber unit tests"
  fi
  if (cd "$ROOT/backend/security-service" && go test ./internal/store/... -run 'PublishRevokeEvent|AuthSoT_RevokeSessionFull_Publishes' -count=1 >/dev/null 2>&1); then
    pass "security-service revoke publish tests"
  else
    fail "security-service revoke publish tests"
  fi
else
  echo "      (skip go unit tests on VPS — use RUN_GO_TESTS=1 where Go is installed)"
fi

if command -v npm >/dev/null 2>&1 && [[ -f "$ROOT/scripts/verify-prod-auth-gate.sh" ]]; then
  if npm run verify:prod-auth-gate >/dev/null 2>&1; then
    pass "verify:prod-auth-gate"
  else
    fail "verify:prod-auth-gate — run manually"
  fi
fi

echo ""
echo "Manual (required for DoD):"
echo "  1) Login on device A + B"
echo "  2) Revoke others from A"
echo "  3) Device B profile → 401 within ~2s"
echo "  4) Repeat revoke-others — no errors in logs"
echo "  Optional: docker compose logs api-gateway --tail=100 | grep 'auth revoke subscriber started'"

if [[ "$failures" -eq 0 ]]; then
  echo ""
  echo "PEND-SEC-012 verify: PASS (automated)"
  exit 0
fi
echo ""
echo "PEND-SEC-012 verify: FAIL ($failures)"
exit 1
