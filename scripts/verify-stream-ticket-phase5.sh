#!/usr/bin/env bash
# SEC-005 Phase 5 ENFORCE — staging gate (auth-e2e only).
#
# Prerequisites: auth-e2e stack with STREAM_TICKET_ACCEPT=1 and STREAM_TICKET_ENFORCE=1
#
# Usage:
#   bash scripts/verify-stream-ticket-phase5.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck source=scripts/auth-e2e-export-env.sh
source "$ROOT/scripts/auth-e2e-export-env.sh"
auth_e2e_export_defaults "$ROOT"

export DIRECT_STREAM_BASE_URL="${DIRECT_STREAM_BASE_URL:-http://127.0.0.1:3096}"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.auth-e2e.yml)
failures=0

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }
section() { echo ""; echo "=== $* ==="; }

section "SEC-005 Phase 5 — ENFORCE staging gate"

if ! command -v docker >/dev/null 2>&1; then
  fail "docker required"
  echo "SEC-005 PHASE 5 STAGING: FAIL"
  exit 1
fi

gw_enabled="$("${COMPOSE[@]}" exec -T api-gateway printenv STREAM_TICKET_ENABLED 2>/dev/null | tr -d '\r' || true)"
ds_accept="$("${COMPOSE[@]}" exec -T direct-stream-service printenv STREAM_TICKET_ACCEPT 2>/dev/null | tr -d '\r' || true)"
ds_enforce="$("${COMPOSE[@]}" exec -T direct-stream-service printenv STREAM_TICKET_ENFORCE 2>/dev/null | tr -d '\r' || true)"
hls_enforce="$("${COMPOSE[@]}" exec -T ebap-hls-adapter printenv STREAM_TICKET_ENFORCE 2>/dev/null | tr -d '\r' || true)"

if [[ "$gw_enabled" != "1" && "$gw_enabled" != "true" ]]; then
  fail "api-gateway STREAM_TICKET_ENABLED not 1"
fi
if [[ "$ds_accept" != "1" && "$ds_accept" != "true" ]]; then
  fail "direct-stream STREAM_TICKET_ACCEPT not 1"
fi
if [[ "$ds_enforce" != "1" && "$ds_enforce" != "true" ]]; then
  fail "direct-stream STREAM_TICKET_ENFORCE not 1"
fi
if [[ "$hls_enforce" != "1" && "$hls_enforce" != "true" ]]; then
  fail "ebap-hls STREAM_TICKET_ENFORCE not 1"
fi
[[ "$failures" -eq 0 ]] && pass "auth-e2e ENFORCE flags (mint + ACCEPT + ENFORCE)"

section "ENFORCE consume (ticket OK, legacy cookie 401)"
if [[ ! -f "$ROOT/scripts/stream-ticket-verify/enforce-consume.mjs" ]]; then
  fail "enforce-consume.mjs missing"
elif node "$ROOT/scripts/stream-ticket-verify/enforce-consume.mjs"; then
  pass "enforce-consume.mjs"
else
  fail "enforce-consume.mjs"
fi

section "Summary"
if [[ "$failures" -eq 0 ]]; then
  echo ""
  echo "SEC-005 PHASE 5 STAGING: PASS"
  echo "Next: Phase 6 prod ACCEPT (dual-mode) — not ENFORCE until staging soak."
  exit 0
fi

echo ""
echo "SEC-005 PHASE 5 STAGING: FAIL ($failures failure(s))"
exit 1
