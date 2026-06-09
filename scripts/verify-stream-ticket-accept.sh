#!/usr/bin/env bash
# SEC-005 Phase 3 ACCEPT — stream ticket consume gate (auth-e2e only).
#
# Prod norm: STREAM_TICKET_ACCEPT=0 → verified after restore-prod-after-auth-e2e.sh
#
# Usage (auth-e2e on VPS):
#   bash scripts/verify-stream-ticket-accept.sh
#
# Exit 0 = pass. Exit 1 = failure.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck source=scripts/auth-e2e-export-env.sh
source "$ROOT/scripts/auth-e2e-export-env.sh"
auth_e2e_export_defaults "$ROOT"

export DIRECT_STREAM_BASE_URL="${DIRECT_STREAM_BASE_URL:-http://127.0.0.1:3096}"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.auth-e2e.yml)
COMPOSE_PROD=(docker compose -f docker-compose.yml)
failures=0

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }
skip() { echo "SKIP  $*"; }
section() { echo ""; echo "=== $* ==="; }

resolve_auth_e2e_track_id() {
  if [[ -n "${AUTH_E2E_TRACK_ID:-}" ]]; then
    pass "AUTH_E2E_TRACK_ID preset (${AUTH_E2E_TRACK_ID})"
    return 0
  fi
  if ! command -v docker >/dev/null 2>&1; then
    skip "docker unavailable — AUTH_E2E_TRACK_ID not resolved from postgres"
    return 0
  fi
  local db_user db_name tid
  db_user="${DB_USER:-}"
  db_name="${DB_NAME:-}"
  if [[ -z "$db_user" || -z "$db_name" ]]; then
    skip "DB_USER/DB_NAME unset — accept-consume will probe via API"
    return 0
  fi
  tid="$("${COMPOSE[@]}" exec -T postgres psql -U "$db_user" -d "$db_name" -tAc \
    "SELECT id FROM songs WHERE file_path IS NOT NULL AND btrim(file_path) <> '' ORDER BY id ASC LIMIT 1;" 2>/dev/null | tr -d ' \r\n' || true)"
  if [[ -n "$tid" && "$tid" =~ ^[0-9]+$ ]]; then
    export AUTH_E2E_TRACK_ID="$tid"
    pass "resolved AUTH_E2E_TRACK_ID=${tid} from postgres"
  else
    skip "no songs.file_path row in postgres — accept-consume will probe via recommendations API"
  fi
}

section "SEC-005 stream ticket ACCEPT verify (Phase 3 consume)"

if [[ ! -f "$ROOT/scripts/stream-ticket-verify/accept-consume.mjs" ]]; then
  fail "accept-consume.mjs missing"
fi

gw_enabled=""
if command -v docker >/dev/null 2>&1; then
  gw_enabled="$("${COMPOSE[@]}" exec -T api-gateway printenv STREAM_TICKET_ENABLED 2>/dev/null | tr -d '\r' || true)"
  if [[ -z "$gw_enabled" ]]; then
    gw_enabled="$("${COMPOSE_PROD[@]}" exec -T api-gateway printenv STREAM_TICKET_ENABLED 2>/dev/null | tr -d '\r' || true)"
  fi
fi

e2e_active=false
if [[ "$gw_enabled" == "1" || "$gw_enabled" == "true" ]]; then
  e2e_active=true
fi

section "Prod ACCEPT off (norm)"
if [[ "$e2e_active" == "true" ]]; then
  skip "prod ACCEPT check deferred (auth-e2e overlay active — run restore-prod-after-auth-e2e.sh to verify prod norm)"
elif ! command -v docker >/dev/null 2>&1; then
  skip "docker unavailable — prod ACCEPT check skipped"
else
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
fi

section "Auth-e2e ACCEPT integration"
if ! command -v docker >/dev/null 2>&1; then
  skip "docker unavailable — consume integration skipped"
elif [[ "$e2e_active" != "true" ]]; then
  skip "api-gateway STREAM_TICKET_ENABLED not 1 — start auth-e2e overlay first"
elif [[ -z "${AUTH_E2E_EMAIL:-}" || -z "${AUTH_E2E_PASSWORD:-}" ]]; then
  skip "AUTH_E2E_EMAIL/PASSWORD unset — consume integration skipped"
else
  ds_accept_e2e="$("${COMPOSE[@]}" exec -T direct-stream-service printenv STREAM_TICKET_ACCEPT 2>/dev/null | tr -d '\r' || true)"
  if [[ "$ds_accept_e2e" != "1" && "$ds_accept_e2e" != "true" ]]; then
    fail "direct-stream STREAM_TICKET_ACCEPT not 1 on auth-e2e overlay ('${ds_accept_e2e:-<empty>}')"
  else
    pass "auth-e2e STREAM_TICKET_ENABLED=${gw_enabled}"
    pass "auth-e2e direct-stream STREAM_TICKET_ACCEPT=${ds_accept_e2e}"
    resolve_auth_e2e_track_id
    bash "$ROOT/scripts/auth-e2e-bootstrap.sh"
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
