#!/usr/bin/env bash
# Prod guard: frontend must not serve auth-e2e API base (127.0.0.1:18080) to browsers.
#
# Detects the common failure mode after auth-e2e/capacity overlay when frontend
# container keeps EARFLOW_API_BASE_URL=http://127.0.0.1:18080 while .env is clean.
#
# Usage (public prod — laptop or VPS):
#   bash scripts/verify-frontend-api-base.sh
#
# Usage (VPS, nginx on localhost:8443):
#   LISTENER_ORIGIN=https://127.0.0.1:8443 AUTH_UI_ORIGIN=https://127.0.0.1:8443 \
#     CURL_INSECURE=1 bash scripts/verify-frontend-api-base.sh
#
# Exit 0 = prod-safe API base. Exit 1 = e2e/localhost leak detected.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LISTENER_ORIGIN="${LISTENER_ORIGIN:-https://earflow.ru}"
AUTH_UI_ORIGIN="${AUTH_UI_ORIGIN:-https://auth.earflow.ru}"
CURL_INSECURE="${CURL_INSECURE:-0}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

failures=0
checks=0

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }
skip() { echo "SKIP  $*"; }
section() { echo ""; echo "=== $* ==="; }

curl_common_flags() {
  local -n out=$1
  out=(-fsSL --max-time 20)
  if [[ "$CURL_INSECURE" == "1" ]]; then
    out+=(-k)
  fi
}

# Returns 0 if value is forbidden for prod api base (non-empty leak).
is_forbidden_api_base_value() {
  local v="${1:-}"
  v="$(printf '%s' "$v" | tr -d '\r')"
  if [[ -z "$v" ]]; then
    return 1
  fi
  local lower
  lower="$(printf '%s' "$v" | tr '[:upper:]' '[:lower:]')"
  if [[ "$lower" == *127.0.0.1* ]]; then return 0; fi
  if [[ "$lower" == *localhost* ]]; then return 0; fi
  if [[ "$lower" == *:18080* ]]; then return 0; fi
  if [[ "$lower" == *auth-e2e* ]]; then return 0; fi
  return 1
}

check_env_file() {
  local env_file="$ROOT/.env"
  checks=$((checks + 1))
  if [[ ! -f "$env_file" ]]; then
    skip ".env not found (optional when checking remote runtime only)"
    return
  fi
  local line val
  line="$(grep -E '^EARFLOW_API_BASE_URL=' "$env_file" 2>/dev/null | tail -1 || true)"
  if [[ -z "$line" ]]; then
    pass ".env EARFLOW_API_BASE_URL unset (prod norm)"
    return
  fi
  val="${line#EARFLOW_API_BASE_URL=}"
  val="${val#\"}"
  val="${val%\"}"
  val="${val#\'}"
  val="${val%\'}"
  if is_forbidden_api_base_value "$val"; then
    fail ".env EARFLOW_API_BASE_URL='$val' — remove or run restore-prod-after-auth-e2e.sh"
  else
    pass ".env EARFLOW_API_BASE_URL ok ('${val:-<empty>}')"
  fi
}

check_compose_file_var() {
  checks=$((checks + 1))
  if ! command -v docker >/dev/null 2>&1; then
    skip "docker unavailable — skip compose config check"
    return
  fi
  if [[ ! -f "$ROOT/docker-compose.yml" ]]; then
    skip "docker-compose.yml missing"
    return
  fi
  local rendered val
  rendered="$(docker compose -f "$ROOT/docker-compose.yml" config 2>/dev/null | grep -E 'EARFLOW_API_BASE_URL:' | tail -1 || true)"
  if [[ -z "$rendered" ]]; then
    skip "compose config: EARFLOW_API_BASE_URL not found in render"
    return
  fi
  val="$(printf '%s' "$rendered" | sed -n 's/.*EARFLOW_API_BASE_URL: *//p' | tr -d '\r' | sed 's/^"\(.*\)"$/\1/')"
  if is_forbidden_api_base_value "$val"; then
    fail "docker-compose.yml renders EARFLOW_API_BASE_URL='$val' — prod compose must not embed e2e URL"
  else
    pass "docker-compose.yml EARFLOW_API_BASE_URL ok ('${val:-<empty>}')"
  fi
}

check_frontend_container_env() {
  checks=$((checks + 1))
  if ! command -v docker >/dev/null 2>&1; then
    skip "docker unavailable — skip frontend container env"
    return
  fi
  local val
  val="$(docker compose -f "$ROOT/docker-compose.yml" exec -T frontend printenv EARFLOW_API_BASE_URL 2>/dev/null | tr -d '\r' || true)"
  if [[ -z "$val" ]]; then
    pass "frontend container EARFLOW_API_BASE_URL empty (prod norm)"
    return
  fi
  if is_forbidden_api_base_value "$val"; then
    fail "frontend container EARFLOW_API_BASE_URL='$val' — force-recreate without auth-e2e overlay"
  else
    pass "frontend container EARFLOW_API_BASE_URL ok ('$val')"
  fi
}

check_runtime_config_inside_container() {
  checks=$((checks + 1))
  if ! command -v docker >/dev/null 2>&1; then
    skip "docker unavailable — skip in-container runtime-config"
    return
  fi
  local body api_base
  body="$(docker compose -f "$ROOT/docker-compose.yml" exec -T frontend cat /tmp/runtime-config.js 2>/dev/null | tr -d '\r' || true)"
  if [[ -z "$body" ]]; then
    skip "in-container /tmp/runtime-config.js unreadable"
    return
  fi
  api_base="$(extract_api_base_url "$body")"
  if is_forbidden_api_base_value "$api_base"; then
    fail "frontend /tmp/runtime-config.js apiBaseUrl='$api_base'"
  else
    pass "frontend /tmp/runtime-config.js apiBaseUrl ok ('${api_base:-<empty>}')"
  fi
}

extract_api_base_url() {
  local body="$1"
  printf '%s' "$body" | grep -oE 'apiBaseUrl:\s*"[^"]*"' | head -1 | sed -E 's/apiBaseUrl:[[:space:]]*"//;s/"$//' || true
}

fetch_runtime_config() {
  local origin="$1"
  local flags body
  curl_common_flags flags
  body="$(curl "${flags[@]}" "${origin%/}/runtime-config.js" 2>/dev/null || true)"
  printf '%s' "$body"
}

check_public_runtime_config() {
  local label="$1"
  local origin="$2"
  checks=$((checks + 1))
  local body api_base
  body="$(fetch_runtime_config "$origin")"
  if [[ -z "$body" ]]; then
    fail "$label runtime-config.js — fetch failed (${origin%/}/runtime-config.js)"
    return
  fi
  api_base="$(extract_api_base_url "$body")"
  if is_forbidden_api_base_value "$api_base"; then
    fail "$label runtime-config.js apiBaseUrl='$api_base' — run restore-prod-after-auth-e2e.sh"
  else
    pass "$label runtime-config.js apiBaseUrl ok ('${api_base:-<empty>}')"
  fi
}

extract_main_js_name() {
  local origin="$1"
  local flags html
  curl_common_flags flags
  html="$(curl "${flags[@]}" "${origin%/}/" 2>/dev/null || true)"
  if [[ -z "$html" ]]; then
    return 1
  fi
  printf '%s' "$html" | grep -oE 'main\.[0-9a-zA-Z_-]+\.js' | head -1 || true
}

check_bundle_no_e2e_leak() {
  local label="$1"
  local origin="$2"
  checks=$((checks + 1))
  local main_js flags body
  main_js="$(extract_main_js_name "$origin")"
  if [[ -z "$main_js" ]]; then
    skip "$label main.*.js — could not resolve from index.html"
    return
  fi
  curl_common_flags flags
  body="$(curl "${flags[@]}" "${origin%/}/static/js/${main_js}" 2>/dev/null || true)"
  if [[ -z "$body" ]]; then
    skip "$label bundle $main_js — fetch failed"
    return
  fi
  if printf '%s' "$body" | grep -qE '127\.0\.0\.1:18080|:18080/auth-e2e|auth-e2e-edge'; then
    fail "$label bundle $main_js contains e2e API base leak"
  else
    pass "$label bundle $main_js — no e2e API base string"
  fi
}

section "Frontend API base prod guard"
echo "Listener: $LISTENER_ORIGIN"
echo "Auth UI:  $AUTH_UI_ORIGIN"

section ".env and compose (VPS)"
check_env_file
check_compose_file_var

section "Docker frontend (VPS — when stack running)"
check_frontend_container_env
check_runtime_config_inside_container

section "Public runtime-config.js"
check_public_runtime_config "earflow.ru" "$LISTENER_ORIGIN"
check_public_runtime_config "auth.earflow.ru" "$AUTH_UI_ORIGIN"

section "Bundle sanity (optional)"
check_bundle_no_e2e_leak "earflow.ru" "$LISTENER_ORIGIN"

section "Summary"
if [[ "$failures" -eq 0 ]]; then
  echo ""
  echo "FRONTEND API BASE GUARD: PASS"
  echo "Prod norm: EARFLOW_API_BASE_URL empty; runtime-config apiBaseUrl empty or prod-safe."
  echo "After auth-e2e/capacity always: bash scripts/restore-prod-after-auth-e2e.sh"
  exit 0
fi

echo ""
echo "FRONTEND API BASE GUARD: FAIL ($failures failure(s))"
echo "Fix: bash scripts/restore-prod-after-auth-e2e.sh"
echo "Then: curl -s https://earflow.ru/runtime-config.js | grep apiBaseUrl"
exit 1
