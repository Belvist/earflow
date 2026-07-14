#!/usr/bin/env bash
# CORS preflight gate for PoP headers on cross-origin listener API (earflow.ru → api.earflow.ru).
# Run after nginx deploy and before closing PoP/auth rollout.
#
# Usage (public hostname — from laptop or when nginx listens on 443):
#   bash scripts/verify-cors-pop-preflight.sh
#
# Usage (on VPS when public 443 down but nginx bound to localhost — see docker-compose 127.0.0.1:8443):
#   API_BASE=https://127.0.0.1:8443 CURL_INSECURE=1 bash scripts/verify-cors-pop-preflight.sh
#
# Exit 0 = all checks passed. Exit 1 = connectivity or CORS header failures.

set -uo pipefail

API_BASE="${API_BASE:-https://api.earflow.ru}"
ORIGIN="${ORIGIN:-https://earflow.ru}"
API_HOST="${API_HOST:-api.earflow.ru}"
CURL_INSECURE="${CURL_INSECURE:-0}"

POP_REQUIRED=(
  x-auth-device-id
  x-auth-device-proof
  x-auth-device-proof-ts
  x-auth-device-proof-nonce
)

failures=0
checks=0
connectivity_ok=0

CURL_OPTS=(-sS)
if [[ "$CURL_INSECURE" == "1" ]]; then
  CURL_OPTS+=(-k)
fi
if [[ "$API_BASE" == *"127.0.0.1"* ]] || [[ "$API_BASE" == *"localhost"* ]]; then
  CURL_OPTS+=(-H "Host: ${API_HOST}")
fi

require_in_allow_headers() {
  local label="$1"
  local allow_headers="$2"
  shift 2
  local h line
  line="$(echo "$allow_headers" | tr '[:upper:]' '[:lower:]')"
  for h in "$@"; do
    if ! echo "$line" | grep -q "$h"; then
      echo "FAIL [$label] missing Allow-Header: $h"
      echo "      got: $allow_headers"
      failures=$((failures + 1))
      return 1
    fi
  done
  return 0
}

preflight() {
  local label="$1"
  local path="$2"
  local method="$3"
  local request_headers="$4"
  shift 4
  local -a required=("$@")

  checks=$((checks + 1))
  local url="${API_BASE}${path}"
  local resp allow curl_status=0

  resp="$(curl "${CURL_OPTS[@]}" -D - -o /dev/null -X OPTIONS "$url" \
    -H "Origin: ${ORIGIN}" \
    -H "Access-Control-Request-Method: ${method}" \
    -H "Access-Control-Request-Headers: ${request_headers}" \
    2>&1)" || curl_status=$?

  if [[ "$curl_status" -ne 0 ]]; then
    echo "FAIL [$label] curl error for $url"
    echo "$resp"
    if echo "$resp" | grep -qi "couldn't connect\|connection refused\|failed to connect"; then
      echo "      hint: nginx not listening on target (curl 7). Check: docker compose ps nginx"
    fi
    failures=$((failures + 1))
    return
  fi

  connectivity_ok=1
  allow="$(echo "$resp" | awk -F': ' 'tolower($1)=="access-control-allow-headers"{print $2; exit}' | tr -d '\r')"

  if [[ -z "$allow" ]]; then
    echo "FAIL [$label] no Access-Control-Allow-Headers in OPTIONS response"
    echo "$resp" | sed -n '1,20p'
    failures=$((failures + 1))
    return
  fi

  if require_in_allow_headers "$label" "$allow" "${required[@]}"; then
    echo "OK   [$label]"
  fi
}

echo "=== CORS/PoP preflight matrix ==="
echo "API_BASE=$API_BASE ORIGIN=$ORIGIN API_HOST=$API_HOST"
if [[ "$CURL_INSECURE" == "1" ]]; then
  echo "CURL_INSECURE=1 (TLS verify off — localhost tunnel only)"
fi
echo

preflight "stream/v3/session" "/api/stream/v3/session" "POST" \
  "content-type,x-csrf-token,x-auth-device-id,x-auth-device-proof,x-auth-device-proof-ts,x-auth-device-proof-nonce" \
  "${POP_REQUIRED[@]}" content-type x-csrf-token

preflight "stream/v2/session" "/api/stream/v2/session" "POST" \
  "content-type,x-csrf-token,x-auth-device-id,x-auth-device-proof,x-auth-device-proof-ts,x-auth-device-proof-nonce" \
  "${POP_REQUIRED[@]}" content-type x-csrf-token

preflight "ebap-hls/v1/session" "/api/ebap-hls/v1/session" "POST" \
  "content-type,x-csrf-token,x-auth-device-id,x-auth-device-proof,x-auth-device-proof-ts,x-auth-device-proof-nonce,x-lyrics-key" \
  "${POP_REQUIRED[@]}" content-type x-csrf-token x-lyrics-key

preflight "api/profile (general /api/)" "/api/profile" "GET" \
  "content-type,x-csrf-token,x-auth-device-id,x-auth-device-proof,x-auth-device-proof-ts,x-auth-device-proof-nonce" \
  "${POP_REQUIRED[@]}" content-type x-csrf-token

preflight "auth/refresh (general /api/)" "/api/auth/refresh" "POST" \
  "content-type,x-csrf-token,x-auth-device-id,x-auth-device-proof,x-auth-device-proof-ts,x-auth-device-proof-nonce" \
  "${POP_REQUIRED[@]}" content-type x-csrf-token

preflight "auth/sessions/revoke-others" "/api/auth/sessions/revoke-others" "POST" \
  "content-type,x-csrf-token,x-auth-device-id,x-auth-device-proof,x-auth-device-proof-ts,x-auth-device-proof-nonce" \
  "${POP_REQUIRED[@]}" content-type x-csrf-token

preflight "auth/sessions/revoke" "/api/auth/sessions/revoke" "POST" \
  "content-type,x-csrf-token,x-auth-device-id,x-auth-device-proof,x-auth-device-proof-ts,x-auth-device-proof-nonce" \
  "${POP_REQUIRED[@]}" content-type x-csrf-token

preflight "artists meta (general /api/)" "/api/artists/test/meta" "GET" \
  "content-type,x-csrf-token,x-auth-device-id,x-auth-device-proof,x-auth-device-proof-ts,x-auth-device-proof-nonce" \
  "${POP_REQUIRED[@]}" content-type x-csrf-token

preflight "stream/v2/crypt" "/api/stream/v2/crypt/test" "GET" \
  "content-type,authorization,x-auth-device-id,x-auth-device-proof,x-auth-device-proof-ts,x-auth-device-proof-nonce" \
  "${POP_REQUIRED[@]}" content-type

echo
echo "=== summary: $((checks - failures))/$checks passed, $failures failed ==="

if [[ "$connectivity_ok" -eq 0 ]]; then
  echo
  echo "All requests failed to connect — this is NOT a CORS header bug."
  echo "1) docker compose -f docker-compose.yml ps nginx"
  echo "2) docker compose -f docker-compose.yml logs nginx --tail=40"
  echo "3) ss -tlnp | grep ':443'"
  echo "4) If nginx is Up but public DNS/firewall blocks loopback test:"
  echo "   API_BASE=https://127.0.0.1:8443 CURL_INSECURE=1 bash scripts/verify-cors-pop-preflight.sh"
  exit 1
fi

if [[ "$failures" -gt 0 ]]; then
  echo "Fix nginx OPTIONS Allow-Headers (use \$earflow_cors_auth_* maps) and re-run."
  exit 1
fi

echo "All preflight checks passed."
