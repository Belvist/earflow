#!/usr/bin/env bash
# HLS prefetch prod gate — evidence ladder (prepared ≠ closed).
#
# Proves:
#   1. nginx CORS Allow-Headers includes X-Earflow-Session-Intent (browser preflight)
#   2. POST play session sets Set-Cookie: mp_hls exactly once
#   3. POST prefetch (body or header) does NOT set Set-Cookie: mp_hls
#
# Usage (VPS after deploy):
#   DEPLOY_SERVICES="nginx ebap-hls-adapter api-gateway" bash scripts/vps-deploy-from-git.sh
#   bash scripts/verify-hls-prefetch-prod.sh
#
# Authenticated session POST checks (optional — required to close gate):
#   export PROD_GATEWAY_COOKIE='mp_auth=...; mp_sid=...'
#   export PROD_CSRF_TOKEN='...'
#   export IT_TRACK_READY_ID=123
#   bash scripts/verify-hls-prefetch-prod.sh
#
# Exit 0 = all executed checks PASS. Exit 1 = any FAIL.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROD_API_ORIGIN="${PROD_API_ORIGIN:-https://api.earflow.ru}"
LISTENER_ORIGIN="${LISTENER_ORIGIN:-https://earflow.ru}"
TRACK_ID="${IT_TRACK_READY_ID:-${HLS_PREFETCH_TRACK_ID:-}}"

failures=0
session_checks=0
_last_mp_hls_count=0

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }
skip() { echo "SKIP  $*"; }
section() { echo ""; echo "=== $* ==="; }

count_set_cookie_name() {
  local headers_file="$1"
  local name="$2"
  awk -v want="$name" '
    BEGIN { IGNORECASE=1; n=0 }
    /^set-cookie:/ {
      line=$0
      sub(/^[^:]*:[ \t]*/, "", line)
      split(line, parts, ";")
      gsub(/^[ \t]+|[ \t]+$/, "", parts[1])
      split(parts[1], kv, "=")
      if (tolower(kv[1]) == tolower(want)) n++
    }
    END { print n+0 }
  ' "$headers_file"
}

section "HLS prefetch prod gate"
echo "API:      ${PROD_API_ORIGIN}"
echo "Origin:   ${LISTENER_ORIGIN}"
echo "Track ID: ${TRACK_ID:-<unset — session POST checks skipped>}"

section "Repo config (pre-deploy sanity)"
if grep -q 'X-Earflow-Session-Intent' "$ROOT/nginx/conf.d/10-global-maps.conf"; then
  pass "nginx/conf.d/10-global-maps.conf includes X-Earflow-Session-Intent"
else
  fail "nginx/conf.d/10-global-maps.conf missing X-Earflow-Session-Intent"
fi

if grep -q 'prefetchIntent' "$ROOT/backend/ebap-hls-adapter/src/main.ts"; then
  pass "ebap-hls-adapter handleSession has prefetchIntent branch"
else
  fail "ebap-hls-adapter prefetchIntent not found in main.ts"
fi

section "Prod CORS preflight (OPTIONS)"
opts_headers="$(mktemp)"
opts_code="$(curl -sS -D "$opts_headers" -o /dev/null -w '%{http_code}' \
  -X OPTIONS "${PROD_API_ORIGIN%/}/api/ebap-hls/v1/session" \
  -H "Origin: ${LISTENER_ORIGIN}" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,x-csrf-token,x-earflow-session-intent" \
  2>/dev/null || echo "000")"

if [[ "$opts_code" == "204" || "$opts_code" == "200" ]]; then
  pass "OPTIONS /api/ebap-hls/v1/session HTTP ${opts_code}"
else
  fail "OPTIONS /api/ebap-hls/v1/session HTTP ${opts_code} (want 204)"
fi

allow_headers="$(grep -i '^access-control-allow-headers:' "$opts_headers" | tail -1 | cut -d: -f2- | tr -d '\r' | xargs || true)"
if [[ "$allow_headers" == *"X-Earflow-Session-Intent"* ]]; then
  pass "Allow-Headers includes X-Earflow-Session-Intent"
else
  fail "Allow-Headers missing X-Earflow-Session-Intent (got: ${allow_headers:-<empty>})"
fi
rm -f "$opts_headers"

section "Prod session POST (requires auth cookies)"
if [[ -z "${PROD_GATEWAY_COOKIE:-}" || -z "${PROD_CSRF_TOKEN:-}" ]]; then
  skip "PROD_GATEWAY_COOKIE / PROD_CSRF_TOKEN unset — play/prefetch Set-Cookie checks not run"
  skip "Export from browser DevTools after login on ${LISTENER_ORIGIN}, then re-run"
else
  if [[ -z "$TRACK_ID" || ! "$TRACK_ID" =~ ^[0-9]+$ ]]; then
    skip "IT_TRACK_READY_ID / HLS_PREFETCH_TRACK_ID unset — session POST checks skipped"
  else
    post_session() {
      local label="$1"
      local body="$2"
      local extra_header="${3:-}"
      local hdr_file body_file code mp_hls_count master_url
      hdr_file="$(mktemp)"
      body_file="$(mktemp)"
      local curl_args=(
        -sS -D "$hdr_file" -o "$body_file" -w '%{http_code}'
        -X POST "${PROD_API_ORIGIN%/}/api/ebap-hls/v1/session"
        -H "Origin: ${LISTENER_ORIGIN}"
        -H "Content-Type: application/json"
        -H "Cookie: ${PROD_GATEWAY_COOKIE}"
        -H "X-CSRF-Token: ${PROD_CSRF_TOKEN}"
        -d "$body"
      )
      if [[ -n "$extra_header" ]]; then
        curl_args+=(-H "$extra_header")
      fi
      code="$(curl "${curl_args[@]}" 2>/dev/null || echo "000")"
      mp_hls_count="$(count_set_cookie_name "$hdr_file" "mp_hls")"
      master_url="$(grep -o '"masterUrl":"[^"]*"' "$body_file" | head -1 | sed 's/"masterUrl":"//;s/"$//' || true)"
      session_checks=1

      if [[ "$code" != "200" ]]; then
        fail "${label}: HTTP ${code} (want 200)"
      else
        pass "${label}: HTTP 200"
      fi

      if [[ -n "$master_url" ]]; then
        pass "${label}: response has masterUrl"
      else
        fail "${label}: response missing masterUrl"
      fi

      _last_mp_hls_count="$mp_hls_count"
      echo "       ${label}: Set-Cookie mp_hls count=${mp_hls_count}"
      rm -f "$hdr_file" "$body_file"
    }

    post_session "play (default)" "{\"trackId\":${TRACK_ID}}" ""
    if [[ "$_last_mp_hls_count" == "1" ]]; then
      pass "play sets mp_hls exactly once"
    else
      fail "play Set-Cookie mp_hls count=${_last_mp_hls_count} (want 1)"
    fi

    post_session "prefetch body" "{\"trackId\":${TRACK_ID},\"prefetch\":true}" ""
    if [[ "$_last_mp_hls_count" == "0" ]]; then
      pass "prefetch body does not set mp_hls"
    else
      fail "prefetch body Set-Cookie mp_hls count=${_last_mp_hls_count} (want 0)"
    fi

    post_session "prefetch header" "{\"trackId\":${TRACK_ID}}" "X-Earflow-Session-Intent: prefetch"
    if [[ "$_last_mp_hls_count" == "0" ]]; then
      pass "prefetch header does not set mp_hls"
    else
      fail "prefetch header Set-Cookie mp_hls count=${_last_mp_hls_count} (want 0)"
    fi
  fi
fi

section "Summary"
if [[ "$session_checks" -eq 0 ]]; then
  echo "Gate: OPEN — prod session POST evidence missing (auth cookies or track id)."
  echo "Deploy on VPS:"
  echo "  DEPLOY_SERVICES=\"nginx ebap-hls-adapter api-gateway\" bash scripts/vps-deploy-from-git.sh"
  echo "Then re-run with PROD_GATEWAY_COOKIE + PROD_CSRF_TOKEN + IT_TRACK_READY_ID."
fi

if [[ "$failures" -eq 0 ]]; then
  if [[ "$session_checks" -eq 1 ]]; then
    echo "HLS prefetch prod gate: PASS (CORS + session contract)"
    exit 0
  fi
  echo "HLS prefetch prod gate: PARTIAL PASS (config/CORS only — session POST not verified)"
  exit 1
fi

echo "HLS prefetch prod gate: FAIL (${failures} check(s))"
exit 1
