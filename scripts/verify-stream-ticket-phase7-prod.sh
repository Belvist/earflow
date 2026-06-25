#!/usr/bin/env bash
# SEC-005 Phase 7 — prod ENFORCE gate (ticket required; legacy cookie → 401).
#
# Usage (VPS):
#   bash scripts/verify-stream-ticket-phase7-prod.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck source=scripts/prod-stream-ticket-export-env.sh
source "$ROOT/scripts/prod-stream-ticket-export-env.sh"
prod_stream_ticket_export_defaults "$ROOT"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.stream-prod-enforce.yml)
COMPOSE_AUTO=(docker compose -f docker-compose.yml)
# shellcheck source=scripts/compose-read-service-env.sh
source "$ROOT/scripts/compose-read-service-env.sh"
failures=0

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }
section() { echo ""; echo "=== $* ==="; }

section "SEC-005 Phase 7 — prod ENFORCE gate"
echo "API:     ${PROD_API_ORIGIN}"
echo "Listener:${LISTENER_ORIGIN}"
echo "Stream:  ${DIRECT_STREAM_BASE_URL}"

if ! command -v docker >/dev/null 2>&1; then
  fail "docker required"
  echo "SEC-005 PHASE 7 PROD: FAIL"
  exit 1
fi

section "Container flags (ACCEPT + ENFORCE on)"
gw_enabled="$(compose_read_service_env api-gateway STREAM_TICKET_ENABLED "${COMPOSE_AUTO[@]}" 2>/dev/null || true)"
ds_accept="$(compose_read_service_env direct-stream-service STREAM_TICKET_ACCEPT "${COMPOSE_AUTO[@]}" 2>/dev/null || true)"
hls_accept="$(compose_read_service_env ebap-hls-adapter STREAM_TICKET_ACCEPT "${COMPOSE_AUTO[@]}" 2>/dev/null || true)"
ds_enforce="$(compose_read_service_env direct-stream-service STREAM_TICKET_ENFORCE "${COMPOSE_AUTO[@]}" 2>/dev/null || true)"
hls_enforce="$(compose_read_service_env ebap-hls-adapter STREAM_TICKET_ENFORCE "${COMPOSE_AUTO[@]}" 2>/dev/null || true)"

mint_code="$(curl -sS -o /dev/null -w "%{http_code}" \
  -X POST "${PROD_API_ORIGIN%/}/api/auth/stream-ticket" \
  -H "Origin: ${LISTENER_ORIGIN}" \
  -H "Content-Type: application/json" \
  -d '{"kind":"media","scope":{"sessionId":"x","trackId":"y"},"client":"web"}' 2>/dev/null || echo "000")"
if [[ "$mint_code" == "401" || "$mint_code" == "403" ]]; then
  pass "gateway stream-ticket mint live (HTTP ${mint_code})"
elif [[ "$gw_enabled" == "1" || "$gw_enabled" == "true" ]]; then
  pass "api-gateway STREAM_TICKET_ENABLED=${gw_enabled}"
else
  fail "gateway mint HTTP ${mint_code} (want 401/403); STREAM_TICKET_ENABLED='${gw_enabled:-<empty>}'"
fi

if [[ "$ds_accept" == "1" || "$ds_accept" == "true" ]]; then
  pass "direct-stream STREAM_TICKET_ACCEPT=${ds_accept}"
else
  fail "direct-stream STREAM_TICKET_ACCEPT='${ds_accept:-<empty>}' (want 1)"
fi
if [[ "$hls_accept" == "1" || "$hls_accept" == "true" ]]; then
  pass "ebap-hls STREAM_TICKET_ACCEPT=${hls_accept}"
else
  fail "ebap-hls STREAM_TICKET_ACCEPT='${hls_accept:-<empty>}' (want 1)"
fi
if [[ "$ds_enforce" == "1" || "$ds_enforce" == "true" ]]; then
  pass "direct-stream STREAM_TICKET_ENFORCE=${ds_enforce}"
else
  fail "direct-stream STREAM_TICKET_ENFORCE='${ds_enforce:-<empty>}' (want 1)"
fi
if [[ "$hls_enforce" == "1" || "$hls_enforce" == "true" ]]; then
  pass "ebap-hls STREAM_TICKET_ENFORCE=${hls_enforce}"
else
  fail "ebap-hls STREAM_TICKET_ENFORCE='${hls_enforce:-<empty>}' (want 1)"
fi

section "Frontend bundle — mint:1 required"
main_js="$(curl -fsSL --max-time 25 "${LISTENER_ORIGIN%/}/" 2>/dev/null | sed -n 's/.*src="\(\/static\/js\/main\.[^"]*\.js\)".*/\1/p' | head -1 || true)"
if [[ -z "$main_js" ]]; then
  fail "could not resolve main.*.js"
else
  body="$(curl -fsSL --max-time 25 "${LISTENER_ORIGIN%/}${main_js}" 2>/dev/null || true)"
  if printf '%s' "$body" | grep -qE 'earflow:stream-ticket-mint:1|/api/auth/stream-ticket'; then
    pass "bundle ${main_js} has stream-ticket mint"
  else
    fail "bundle missing mint marker — ENFORCE requires frontend mint:1"
  fi
fi

section "ENFORCE consume (ticket OK, legacy cookie 401)"
echo "consume AUTH_E2E_BASE_URL=${AUTH_E2E_BASE_URL}"
echo "consume DIRECT_STREAM_BASE_URL=${DIRECT_STREAM_BASE_URL}"
if [[ -z "${AUTH_E2E_EMAIL:-}" || -z "${AUTH_E2E_PASSWORD:-}" ]]; then
  fail "AUTH_E2E_EMAIL / AUTH_E2E_PASSWORD required"
elif node "$ROOT/scripts/stream-ticket-verify/enforce-consume.mjs"; then
  pass "enforce-consume.mjs on prod origins"
else
  fail "enforce-consume.mjs on prod origins"
fi

section "Summary"
if [[ "$failures" -eq 0 ]]; then
  echo ""
  echo "SEC-005 PHASE 7 PROD ENFORCE: PASS"
  echo "Rollback to Phase 6 dual-mode: SEC005_PHASE7_ROLLBACK_CONFIRM=1 npm run rollback:sec005-phase7-prod"
  exit 0
fi

echo ""
echo "SEC-005 PHASE 7 PROD ENFORCE: FAIL ($failures failure(s))"
exit 1
