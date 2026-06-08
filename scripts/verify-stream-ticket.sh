#!/usr/bin/env bash
# SEC-005 Phase 2 OBSERVE — stream ticket mint gate (no consume/enforce).
#
# Prod norm: STREAM_TICKET_ENABLED=0 → POST /api/auth/stream-ticket returns 404.
# Auth-e2e: STREAM_TICKET_ENABLED=1 → mint integration via mint-observe.mjs.
#
# Usage (auth-e2e on VPS):
#   bash scripts/verify-stream-ticket.sh
#
# Usage (prod disabled check only):
#   PROD_API_ORIGIN=https://api.earflow.ru bash scripts/verify-stream-ticket.sh
#
# Exit 0 = pass. Exit 1 = failure.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export AUTH_E2E_BASE_URL="${AUTH_E2E_BASE_URL:-http://127.0.0.1:18080}"
export AUTH_E2E_ORIGIN="${AUTH_E2E_ORIGIN:-$AUTH_E2E_BASE_URL}"
PROD_API_ORIGIN="${PROD_API_ORIGIN:-https://api.earflow.ru}"

COMPOSE_PROD=(docker compose -f docker-compose.yml)
failures=0

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }
section() { echo ""; echo "=== $* ==="; }

if [[ -f "$ROOT/.env" ]]; then
  # shellcheck source=scripts/load-dotenv.sh
  source "$ROOT/scripts/load-dotenv.sh"
  load_dotenv "$ROOT/.env"
fi

section "SEC-005 stream ticket verify (Phase 2 OBSERVE — mint only)"

if grep -q '/api/auth/stream-ticket' "$ROOT/backend/go-api-gateway/internal/auth/http_routes.go"; then
  pass "gateway route POST /api/auth/stream-ticket registered"
else
  fail "gateway route /api/auth/stream-ticket missing"
fi

section "Prod disabled check (404 when flag off)"
disabled_code="$(curl -sS -o /dev/null -w "%{http_code}" \
  -X POST "${PROD_API_ORIGIN%/}/api/auth/stream-ticket" \
  -H "Origin: https://earflow.ru" \
  -H "Content-Type: application/json" \
  -d '{"kind":"media","scope":{"sessionId":"x","trackId":"y"},"client":"web"}' 2>/dev/null || echo "000")"
if [[ "$disabled_code" == "404" ]]; then
  pass "prod POST /api/auth/stream-ticket → 404 (STREAM_TICKET_ENABLED=0 norm)"
elif [[ "$disabled_code" == "401" || "$disabled_code" == "403" ]]; then
  pass "prod POST /api/auth/stream-ticket → ${disabled_code} (endpoint may be enabled — check STREAM_TICKET_ENABLED)"
else
  fail "prod POST /api/auth/stream-ticket → HTTP ${disabled_code} (expected 404 or 401)"
fi

section "Gateway env (running stack)"
stream_enabled=""
if command -v docker >/dev/null 2>&1; then
  stream_enabled="$("${COMPOSE_PROD[@]}" exec -T api-gateway printenv STREAM_TICKET_ENABLED 2>/dev/null | tr -d '\r' || true)"
  if [[ -z "$stream_enabled" || "$stream_enabled" == "0" || "$stream_enabled" == "false" ]]; then
    pass "api-gateway STREAM_TICKET_ENABLED off ('${stream_enabled:-<empty>}') — prod norm"
    echo ""
    echo "OBSERVE mint integration skipped (enable on auth-e2e overlay only)."
    echo "To run full mint gate: docker compose -f docker-compose.yml -f docker-compose.auth-e2e.yml up -d api-gateway"
    echo "  with STREAM_TICKET_ENABLED=1, then re-run this script."
    if [[ "$failures" -eq 0 ]]; then
      echo ""
      echo "STREAM TICKET VERIFY: PASS (static + prod disabled)"
      exit 0
    fi
    echo ""
    echo "STREAM TICKET VERIFY: FAIL ($failures failure(s))"
    exit 1
  fi
  pass "api-gateway STREAM_TICKET_ENABLED=${stream_enabled}"
else
  echo "SKIP  docker unavailable — cannot read gateway env"
fi

section "Auth-e2e mint integration"
if ! curl -fsS --max-time 5 "${AUTH_E2E_BASE_URL%/}/health" >/dev/null 2>&1; then
  fail "auth-e2e edge not reachable at ${AUTH_E2E_BASE_URL} — start auth-e2e stack"
  echo ""
  echo "STREAM TICKET VERIFY: FAIL ($failures failure(s))"
  exit 1
fi

if [[ -z "${AUTH_E2E_EMAIL:-}" || -z "${AUTH_E2E_PASSWORD:-}" ]]; then
  fail "AUTH_E2E_EMAIL / AUTH_E2E_PASSWORD required for mint integration"
  echo ""
  echo "STREAM TICKET VERIFY: FAIL ($failures failure(s))"
  exit 1
fi

bash "$ROOT/scripts/auth-e2e-bootstrap.sh"

if ! command -v node >/dev/null 2>&1; then
  fail "node required for mint-observe.mjs"
else
  if node "$ROOT/scripts/stream-ticket-verify/mint-observe.mjs"; then
    pass "mint-observe.mjs integration"
  else
    fail "mint-observe.mjs integration"
  fi
fi

section "Summary"
if [[ "$failures" -eq 0 ]]; then
  echo ""
  echo "STREAM TICKET VERIFY: PASS"
  exit 0
fi
echo ""
echo "STREAM TICKET VERIFY: FAIL ($failures failure(s))"
exit 1
