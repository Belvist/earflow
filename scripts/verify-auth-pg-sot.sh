#!/usr/bin/env bash
# PEND-SEC-011 — post-rollout verification (dual_write enabled).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.yml)
failures=0

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }

if [[ ! -f "$ROOT/.env" ]]; then
  fail ".env missing"
  exit 1
fi

# shellcheck source=scripts/load-dotenv.sh
source "$ROOT/scripts/load-dotenv.sh"
load_dotenv "$ROOT/.env"

: "${DB_USER:?DB_USER}"
: "${DB_NAME:?DB_NAME}"

mode="$(grep -E '^AUTH_PG_SOT_MODE=' "$ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r" ' || echo off)"
echo "=== PEND-SEC-011 verify (AUTH_PG_SOT_MODE=$mode) ==="

if [[ "$mode" != "dual_write" ]]; then
  fail "AUTH_PG_SOT_MODE is not dual_write (got: ${mode:-empty})"
else
  pass "AUTH_PG_SOT_MODE=dual_write in .env"
fi

for tbl in auth_sessions auth_devices refresh_tokens security_events; do
  if "${COMPOSE[@]}" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT to_regclass('public.$tbl') IS NOT NULL;" 2>/dev/null | grep -q t; then
    pass "table $tbl exists"
  else
    fail "table $tbl missing — run rollout migrate"
  fi
done

sess_count="$("${COMPOSE[@]}" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -tAc \
  "SELECT COUNT(*) FROM auth_sessions WHERE revoked_at IS NULL;" 2>/dev/null | tr -d ' \r\n' || echo 0)"
dev_count="$("${COMPOSE[@]}" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -tAc \
  "SELECT COUNT(*) FROM auth_devices WHERE revoked_at IS NULL;" 2>/dev/null | tr -d ' \r\n' || echo 0)"
echo "      active auth_sessions=$sess_count auth_devices=$dev_count"
if [[ "${sess_count:-0}" -ge 0 ]]; then
  pass "auth_sessions readable"
fi
if [[ "$mode" == "dual_write" && "${sess_count:-0}" -eq 0 ]]; then
  fail "dual_write enabled but auth_sessions empty — run backfill-live after fixing UpsertSession SQL"
fi

if "${COMPOSE[@]}" ps security-service 2>/dev/null | grep -qE 'Up|running'; then
  pass "security-service running"
else
  fail "security-service not running"
fi

if "${COMPOSE[@]}" ps api-gateway 2>/dev/null | grep -qE 'Up|running'; then
  pass "api-gateway running"
else
  fail "api-gateway not running"
fi

if command -v npm >/dev/null 2>&1 && [[ -f "$ROOT/scripts/verify-prod-auth-gate.sh" ]]; then
  if npm run verify:prod-auth-gate >/dev/null 2>&1; then
    pass "verify:prod-auth-gate"
  else
    fail "verify:prod-auth-gate — run manually"
  fi
fi

if [[ "${RUN_AUTH_E2E:-}" == "1" ]]; then
  echo "=== Running PEND-SEC-001 e2e (dual_write) ==="
  export AUTH_PG_SOT_MODE=dual_write
  if bash "$ROOT/scripts/run-auth-fullstack-e2e.sh"; then
    pass "run-auth-fullstack-e2e.sh"
  else
    fail "run-auth-fullstack-e2e.sh"
  fi
fi

echo ""
if [[ "$failures" -eq 0 ]]; then
  echo "PEND-SEC-011 verify: PASS (automated)"
  echo "Manual: login → revoke one other session → profile still 200; check security-service logs for pg sot upsert/revoke"
  exit 0
fi
echo "PEND-SEC-011 verify: FAIL ($failures)"
exit 1
