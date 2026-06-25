#!/usr/bin/env bash
# SEC-005 Phase 4 — frontend mint build + client-path consume (auth-e2e only).
#
# Prerequisites:
#   docker compose -f docker-compose.yml -f docker-compose.auth-e2e.yml build frontend
#   stack up with STREAM_TICKET_ENABLED=1, STREAM_TICKET_ACCEPT=1
#
# Usage:
#   bash scripts/verify-stream-ticket-phase4.sh
#
# Exit 0 = Phase 4 staging gate PASS. Exit 1 = failure.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck source=scripts/auth-e2e-export-env.sh
source "$ROOT/scripts/auth-e2e-export-env.sh"
auth_e2e_export_defaults "$ROOT"

export DIRECT_STREAM_BASE_URL="${DIRECT_STREAM_BASE_URL:-http://127.0.0.1:3096}"
E2E_ORIGIN="${AUTH_E2E_ORIGIN:-http://127.0.0.1:18080}"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.auth-e2e.yml)
failures=0

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }
skip() { echo "SKIP  $*"; }
section() { echo ""; echo "=== $* ==="; }

extract_main_js_from_html() {
  sed -n 's/.*src="\(\/static\/js\/main\.[^"]*\.js\)".*/\1/p' | head -1
}

fetch_main_js_path() {
  local origin="$1"
  local html main
  html="$(curl -fsS "${origin%/}/" 2>/dev/null || true)"
  if [[ -z "$html" ]]; then
    return 1
  fi
  main="$(printf '%s' "$html" | extract_main_js_from_html)"
  if [[ -z "$main" ]]; then
    return 1
  fi
  printf '%s' "$main"
}

section "SEC-005 Phase 4 — frontend mint staging gate"

if ! command -v docker >/dev/null 2>&1; then
  fail "docker required"
  echo "STREAM TICKET PHASE 4: FAIL"
  exit 1
fi

gw_enabled="$("${COMPOSE[@]}" exec -T api-gateway printenv STREAM_TICKET_ENABLED 2>/dev/null | tr -d '\r' || true)"
ds_accept="$("${COMPOSE[@]}" exec -T direct-stream-service printenv STREAM_TICKET_ACCEPT 2>/dev/null | tr -d '\r' || true)"

if [[ "$gw_enabled" != "1" && "$gw_enabled" != "true" ]]; then
  fail "api-gateway STREAM_TICKET_ENABLED not 1 — start auth-e2e overlay"
fi
if [[ "$ds_accept" != "1" && "$ds_accept" != "true" ]]; then
  fail "direct-stream STREAM_TICKET_ACCEPT not 1"
fi
[[ "$failures" -eq 0 ]] && pass "auth-e2e stream ticket flags (mint + ACCEPT)"

section "Frontend bundle — mint build marker"
main_js="$(fetch_main_js_path "$E2E_ORIGIN" || true)"
if [[ -z "$main_js" ]]; then
  fail "could not resolve main.*.js from ${E2E_ORIGIN}/"
else
  pass "e2e index → $main_js"
  body="$(curl -fsS "${E2E_ORIGIN%/}${main_js}" 2>/dev/null || true)"
  if [[ -z "$body" ]]; then
    fail "could not fetch bundle ${main_js}"
  elif printf '%s' "$body" | grep -q 'earflow:stream-ticket-mint:1'; then
    pass "bundle contains earflow:stream-ticket-mint:1 (REACT_APP_STREAM_TICKET_MINT_ENABLED=1)"
  elif printf '%s' "$body" | grep -qF '/api/auth/stream-ticket'; then
    pass "bundle contains /api/auth/stream-ticket mint path (marker inlined by minifier)"
  elif printf '%s' "$body" | grep -q 'earflow:stream-ticket-mint:0'; then
    fail "bundle has mint:0 — rebuild frontend with auth-e2e overlay (AUTH_E2E_STREAM_TICKET_MINT_ENABLED=1)"
  else
    fail "bundle missing stream-ticket mint build marker — rebuild frontend"
  fi
fi

section "Client-path consume (proof token mint → ?st= HEAD)"
if [[ ! -f "$ROOT/scripts/stream-ticket-verify/accept-consume.mjs" ]]; then
  fail "accept-consume.mjs missing"
elif node "$ROOT/scripts/stream-ticket-verify/accept-consume.mjs"; then
  pass "accept-consume.mjs (mint + ticket HEAD + legacy dual-mode)"
else
  fail "accept-consume.mjs"
fi

section "Summary"
if [[ "$failures" -eq 0 ]]; then
  echo ""
  echo "SEC-005 PHASE 4 STAGING: PASS"
  echo "Next: Phase 5 staging (ACCEPT → ENFORCE on auth-e2e). Prod flags stay off until that gate."
  exit 0
fi

echo ""
echo "SEC-005 PHASE 4 STAGING: FAIL ($failures failure(s))"
exit 1
