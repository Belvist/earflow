#!/usr/bin/env bash
# SEC-005 Phase 8 — WS connect ticket ACCEPT (auth-e2e).
#
# Requires: auth-e2e overlay, STREAM_TICKET_ACCEPT=1 on device-sync-service,
# STREAM_TICKET_ENABLED=1 on api-gateway, DEVICE_SYNC_ENABLED=1.
#
# Exit 0 = pass. Exit 1 = failure.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck source=scripts/auth-e2e-export-env.sh
source "$ROOT/scripts/auth-e2e-export-env.sh"
auth_e2e_export_defaults "$ROOT"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.auth-e2e.yml)
failures=0

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }
section() { echo ""; echo "=== $* ==="; }

section "SEC-005 WS stream ticket ACCEPT (Phase 8)"

if [[ ! -f "$ROOT/scripts/stream-ticket-verify/ws-accept-consume.mjs" ]]; then
  fail "ws-accept-consume.mjs missing"
  exit 1
fi

accept_flag="$("${COMPOSE[@]}" exec -T device-sync-service printenv STREAM_TICKET_ACCEPT 2>/dev/null | tr -d '\r' || true)"
if [[ "$accept_flag" != "1" ]]; then
  fail "device-sync STREAM_TICKET_ACCEPT=$accept_flag (want 1)"
else
  pass "device-sync STREAM_TICKET_ACCEPT=1"
fi

mint_flag="$("${COMPOSE[@]}" exec -T api-gateway printenv STREAM_TICKET_ENABLED 2>/dev/null | tr -d '\r' || true)"
if [[ "$mint_flag" != "1" ]]; then
  fail "api-gateway STREAM_TICKET_ENABLED=$mint_flag (want 1)"
else
  pass "api-gateway STREAM_TICKET_ENABLED=1"
fi

if node "$ROOT/scripts/stream-ticket-verify/ws-accept-consume.mjs"; then
  pass "ws-accept-consume.mjs"
else
  fail "ws-accept-consume.mjs"
fi

if [[ "$failures" -gt 0 ]]; then
  echo ""
  echo "RESULT: FAIL ($failures)"
  exit 1
fi

echo ""
echo "RESULT: PASS"
exit 0
