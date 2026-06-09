#!/usr/bin/env bash
# SEC-005 Phase 3 ACCEPT — stream ticket consume gate (auth-e2e only).
#
# Prod norm: STREAM_TICKET_ACCEPT=0 → script skips consume integration.
#
# Usage (auth-e2e on VPS):
#   bash scripts/verify-stream-ticket-accept.sh
#
# Exit 0 = pass. Exit 1 = failure.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export AUTH_E2E_BASE_URL="${AUTH_E2E_BASE_URL:-http://127.0.0.1:18080}"
export AUTH_E2E_ORIGIN="${AUTH_E2E_ORIGIN:-$AUTH_E2E_BASE_URL}"
export DIRECT_STREAM_BASE_URL="${DIRECT_STREAM_BASE_URL:-http://127.0.0.1:3096}"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.auth-e2e.yml)
COMPOSE_PROD=(docker compose -f docker-compose.yml)
failures=0

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }
skip() { echo "SKIP  $*"; }
section() { echo ""; echo "=== $* ==="; }

if [[ -f "$ROOT/.env" ]]; then
  # shellcheck source=scripts/load-dotenv.sh
  source "$ROOT/scripts/load-dotenv.sh"
  load_dotenv "$ROOT/.env"
fi

section "SEC-005 stream ticket ACCEPT verify (Phase 3 consume)"

if [[ ! -f "$ROOT/scripts/stream-ticket-verify/accept-consume.mjs" ]]; then
  fail "accept-consume.mjs missing"
fi

section "Prod ACCEPT off (norm)"
if command -v docker >/dev/null 2>&1; then
  ds_accept="$("${COMPOSE_PROD[@]}" exec -T direct-stream-service printenv STREAM_TICKET_ACCEPT 2>/dev/null | tr -d '\r' || true)"
  hls_accept="$("${COMPOSE_PROD[@]}" exec -T ebap-hls-adapter printenv STREAM_TICKET_ACCEPT 2>/dev/null | tr -d '\r' || true)"
  if [[ -z "$ds_accept" || "$ds_accept" == "0" || "$ds_accept" == "false" ]]; then
    pass "direct-stream STREAM_TICKET_ACCEPT off ('${ds_accept:-<empty>}')"
  else
    fail "direct-stream STREAM_TICKET_ACCEPT=${ds_accept} (prod must be 0)"
  fi
  if [[ -z "$hls_accept" || "$hls_accept" == "0" || "$hls_accept" == "false" ]]; then
    pass "ebap-hls STREAM_TICKET_ACCEPT off ('${hls_accept:-<empty>}')"
  else
    fail "ebap-hls STREAM_TICKET_ACCEPT=${hls_accept} (prod must be 0)"
  fi
else
  skip "docker unavailable — prod ACCEPT check skipped"
fi

section "Auth-e2e ACCEPT integration"
if ! command -v docker >/dev/null 2>&1; then
  skip "docker unavailable — consume integration skipped"
elif [[ -z "${AUTH_E2E_EMAIL:-}" || -z "${AUTH_E2E_PASSWORD:-}" ]]; then
  skip "AUTH_E2E_EMAIL/PASSWORD unset — consume integration skipped"
else
  gw_enabled="$("${COMPOSE[@]}" exec -T api-gateway printenv STREAM_TICKET_ENABLED 2>/dev/null | tr -d '\r' || true)"
  ds_accept_e2e="$("${COMPOSE[@]}" exec -T direct-stream-service printenv STREAM_TICKET_ACCEPT 2>/dev/null | tr -d '\r' || true)"
  if [[ "$gw_enabled" != "1" && "$gw_enabled" != "true" ]]; then
    skip "api-gateway STREAM_TICKET_ENABLED not 1 — start auth-e2e overlay first"
  elif [[ "$ds_accept_e2e" != "1" && "$ds_accept_e2e" != "true" ]]; then
    skip "direct-stream STREAM_TICKET_ACCEPT not 1 on auth-e2e overlay"
  else
    pass "auth-e2e STREAM_TICKET_ENABLED=${gw_enabled}"
    pass "auth-e2e direct-stream STREAM_TICKET_ACCEPT=${ds_accept_e2e}"
    if node "$ROOT/scripts/stream-ticket-verify/accept-consume.mjs"; then
      pass "accept-consume.mjs integration"
    else
      fail "accept-consume.mjs integration"
    fi
  fi
fi

if [[ "$failures" -eq 0 ]]; then
  echo ""
  echo "STREAM TICKET ACCEPT VERIFY: PASS"
  exit 0
fi

echo ""
echo "STREAM TICKET ACCEPT VERIFY: FAIL ($failures failure(s))"
exit 1
