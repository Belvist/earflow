#!/usr/bin/env bash
# SEC-005 Phase 6 — prod ACCEPT gate (dual-mode, ENFORCE off).
#
# Prerequisites:
#   docker compose -f docker-compose.yml -f docker-compose.stream-prod-accept.yml up -d
#   frontend rebuilt with REACT_APP_STREAM_TICKET_MINT_ENABLED=1
#
# Usage (VPS):
#   bash scripts/verify-stream-ticket-phase6-prod.sh
#
# Exit 0 = Phase 6 prod ACCEPT PASS. Exit 1 = failure.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck source=scripts/prod-stream-ticket-export-env.sh
source "$ROOT/scripts/prod-stream-ticket-export-env.sh"
prod_stream_ticket_export_defaults "$ROOT"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.stream-prod-accept.yml)
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
  local flags html main
  flags=(-fsSL --max-time 25)
  if [[ "${CURL_INSECURE:-0}" == "1" ]]; then
    flags+=(-k)
  fi
  html="$(curl "${flags[@]}" "${origin%/}/" 2>/dev/null || true)"
  if [[ -z "$html" ]]; then
    return 1
  fi
  main="$(printf '%s' "$html" | extract_main_js_from_html)"
  if [[ -z "$main" ]]; then
    return 1
  fi
  printf '%s' "$main"
}

section "SEC-005 Phase 6 — prod ACCEPT gate"
echo "API:     ${PROD_API_ORIGIN}"
echo "Listener:${LISTENER_ORIGIN}"
echo "Stream:  ${DIRECT_STREAM_BASE_URL}"

if ! command -v docker >/dev/null 2>&1; then
  fail "docker required"
  echo "SEC-005 PHASE 6 PROD: FAIL"
  exit 1
fi

section "Container flags (ACCEPT on, ENFORCE off)"
gw_enabled="$("${COMPOSE[@]}" exec -T api-gateway printenv STREAM_TICKET_ENABLED 2>/dev/null | tr -d '\r' || true)"
ds_accept="$("${COMPOSE[@]}" exec -T direct-stream-service printenv STREAM_TICKET_ACCEPT 2>/dev/null | tr -d '\r' || true)"
hls_accept="$("${COMPOSE[@]}" exec -T ebap-hls-adapter printenv STREAM_TICKET_ACCEPT 2>/dev/null | tr -d '\r' || true)"
ds_enforce="$("${COMPOSE[@]}" exec -T direct-stream-service printenv STREAM_TICKET_ENFORCE 2>/dev/null | tr -d '\r' || true)"
hls_enforce="$("${COMPOSE[@]}" exec -T ebap-hls-adapter printenv STREAM_TICKET_ENFORCE 2>/dev/null | tr -d '\r' || true)"
fe_api="$("${COMPOSE[@]}" exec -T frontend printenv EARFLOW_API_BASE_URL 2>/dev/null | tr -d '\r' || true)"

if [[ "$gw_enabled" == "1" || "$gw_enabled" == "true" ]]; then
  pass "api-gateway STREAM_TICKET_ENABLED=${gw_enabled}"
else
  fail "api-gateway STREAM_TICKET_ENABLED='${gw_enabled:-<empty>}' (want 1)"
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
if [[ -z "$ds_enforce" || "$ds_enforce" == "0" || "$ds_enforce" == "false" ]]; then
  pass "direct-stream STREAM_TICKET_ENFORCE off ('${ds_enforce:-<empty>}')"
else
  fail "direct-stream STREAM_TICKET_ENFORCE=${ds_enforce} (Phase 6 must stay off)"
fi
if [[ -z "$hls_enforce" || "$hls_enforce" == "0" || "$hls_enforce" == "false" ]]; then
  pass "ebap-hls STREAM_TICKET_ENFORCE off ('${hls_enforce:-<empty>}')"
else
  fail "ebap-hls STREAM_TICKET_ENFORCE=${hls_enforce} (Phase 6 must stay off)"
fi
if [[ -n "$fe_api" && "$fe_api" == *127.0.0.1* ]]; then
  fail "frontend EARFLOW_API_BASE_URL='$fe_api' — run restore-prod before Phase 6"
else
  pass "frontend EARFLOW_API_BASE_URL ok ('${fe_api:-<empty>}')"
fi

section "Gateway mint endpoint live (unauthenticated → 401/403, not 404)"
mint_code="$(curl -sS -o /dev/null -w "%{http_code}" \
  -X POST "${PROD_API_ORIGIN%/}/api/auth/stream-ticket" \
  -H "Origin: ${LISTENER_ORIGIN}" \
  -H "Content-Type: application/json" \
  -d '{"kind":"media","scope":{"sessionId":"x","trackId":"y"},"client":"web"}' 2>/dev/null || echo "000")"
if [[ "$mint_code" == "404" ]]; then
  fail "POST /api/auth/stream-ticket → 404 (STREAM_TICKET_ENABLED still off?)"
elif [[ "$mint_code" == "401" || "$mint_code" == "403" ]]; then
  pass "POST /api/auth/stream-ticket → ${mint_code} (endpoint enabled)"
else
  fail "POST /api/auth/stream-ticket → HTTP ${mint_code} (expected 401/403)"
fi

section "Frontend bundle — mint build marker (${LISTENER_ORIGIN})"
main_js="$(fetch_main_js_path "$LISTENER_ORIGIN" || true)"
if [[ -z "$main_js" ]]; then
  fail "could not resolve main.*.js from ${LISTENER_ORIGIN}/"
else
  pass "listener index → $main_js"
  flags=(-fsSL --max-time 25)
  if [[ "${CURL_INSECURE:-0}" == "1" ]]; then
    flags+=(-k)
  fi
  body="$(curl "${flags[@]}" "${LISTENER_ORIGIN%/}${main_js}" 2>/dev/null || true)"
  if [[ -z "$body" ]]; then
    fail "could not fetch bundle ${main_js}"
  elif printf '%s' "$body" | grep -q 'earflow:stream-ticket-mint:1'; then
    pass "bundle contains earflow:stream-ticket-mint:1"
  elif printf '%s' "$body" | grep -qF '/api/auth/stream-ticket'; then
    pass "bundle contains /api/auth/stream-ticket mint path"
  elif printf '%s' "$body" | grep -q 'earflow:stream-ticket-mint:0'; then
    fail "bundle has mint:0 — rebuild frontend with stream-prod-accept overlay"
  else
    fail "bundle missing stream-ticket mint marker"
  fi
fi

section "Frontend API base guard"
if bash "$ROOT/scripts/verify-frontend-api-base.sh"; then
  pass "verify-frontend-api-base.sh"
else
  fail "verify-frontend-api-base.sh"
fi

section "Prod consume (mint + ?st= + legacy dual-mode)"
if [[ -z "${AUTH_E2E_EMAIL:-}" || -z "${AUTH_E2E_PASSWORD:-}" ]]; then
  fail "AUTH_E2E_EMAIL / AUTH_E2E_PASSWORD required in .env for prod consume gate"
elif [[ ! -f "$ROOT/scripts/stream-ticket-verify/accept-consume.mjs" ]]; then
  fail "accept-consume.mjs missing"
elif node "$ROOT/scripts/stream-ticket-verify/accept-consume.mjs"; then
  pass "accept-consume.mjs on prod origins"
else
  fail "accept-consume.mjs on prod origins"
fi

section "Summary"
if [[ "$failures" -eq 0 ]]; then
  echo ""
  echo "SEC-005 PHASE 6 PROD ACCEPT: PASS"
  echo "Soak: 30s playback on earflow.ru; watch direct-stream legacy_fallback metric."
  echo "Next: Phase 7 prod ENFORCE — only after soak; rollback: npm run rollback:sec005-phase6-prod"
  exit 0
fi

echo ""
echo "SEC-005 PHASE 6 PROD ACCEPT: FAIL ($failures failure(s))"
exit 1
