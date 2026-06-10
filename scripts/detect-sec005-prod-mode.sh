#!/usr/bin/env bash
# Detect SEC-005 prod rollout mode: norm | phase6 | split (source or run).
#
# Usage:
#   source scripts/detect-sec005-prod-mode.sh && detect_sec005_prod_mode "$ROOT"
#   echo $SEC005_PROD_MODE   # norm | phase6 | split | unknown

detect_sec005_flag_on() {
  local v="${1:-}"
  v="$(printf '%s' "$v" | tr -d '\r')"
  [[ "$v" == "1" || "$v" == "true" ]]
}

detect_sec005_flag_off() {
  local v="${1:-}"
  v="$(printf '%s' "$v" | tr -d '\r')"
  [[ -z "$v" || "$v" == "0" || "$v" == "false" ]]
}

detect_sec005_bundle_mint_enabled() {
  local origin="${1:-https://earflow.ru}"
  local flags html main body
  flags=(-fsSL --max-time 20)
  if [[ "${CURL_INSECURE:-0}" == "1" ]]; then
    flags+=(-k)
  fi
  html="$(curl "${flags[@]}" "${origin%/}/" 2>/dev/null || true)"
  main="$(printf '%s' "$html" | sed -n 's/.*src="\(\/static\/js\/main\.[^"]*\.js\)".*/\1/p' | head -1)"
  [[ -z "$main" ]] && return 1
  body="$(curl "${flags[@]}" "${origin%/}${main}" 2>/dev/null || true)"
  [[ -z "$body" ]] && return 1
  if printf '%s' "$body" | grep -q 'earflow:stream-ticket-mint:1'; then
    return 0
  fi
  if printf '%s' "$body" | grep -qF '/api/auth/stream-ticket'; then
    return 0
  fi
  return 1
}

detect_sec005_gateway_mint_live() {
  local api_origin="${1:-https://api.earflow.ru}"
  local listener="${2:-https://earflow.ru}"
  local code
  code="$(curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "${api_origin%/}/api/auth/stream-ticket" \
    -H "Origin: ${listener}" \
    -H "Content-Type: application/json" \
    -d '{"kind":"media","scope":{"sessionId":"x","trackId":"y"},"client":"web"}' 2>/dev/null || echo "000")"
  case "$code" in
    401|403) return 0 ;;
    404) return 1 ;;
    *) return 2 ;;
  esac
}

detect_sec005_prod_mode() {
  local root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
  local compose=(docker compose -f "$root/docker-compose.yml")
  local gw_enabled="" ds_accept="" hls_accept="" ds_enforce="" hls_enforce=""
  local mint_bundle=false gw_mint_live=false gw_mint_unknown=false

  SEC005_PROD_MODE="unknown"
  SEC005_SPLIT_REASON=""

  # shellcheck source=scripts/compose-read-service-env.sh
  source "$root/scripts/compose-read-service-env.sh"

  if ! command -v docker >/dev/null 2>&1; then
    SEC005_PROD_MODE="unknown"
    return 0
  fi

  gw_enabled="$(compose_read_service_env api-gateway STREAM_TICKET_ENABLED "${compose[@]}" 2>/dev/null || true)"
  if [[ "$gw_enabled" == MISMATCH:* ]]; then
    SEC005_PROD_MODE="split"
    SEC005_SPLIT_REASON="api-gateway replicas disagree on STREAM_TICKET_ENABLED"
    export SEC005_PROD_MODE SEC005_SPLIT_REASON
    return 0
  fi

  ds_accept="$(compose_read_service_env direct-stream-service STREAM_TICKET_ACCEPT "${compose[@]}" 2>/dev/null || true)"
  hls_accept="$(compose_read_service_env ebap-hls-adapter STREAM_TICKET_ACCEPT "${compose[@]}" 2>/dev/null || true)"
  ds_enforce="$(compose_read_service_env direct-stream-service STREAM_TICKET_ENFORCE "${compose[@]}" 2>/dev/null || true)"
  hls_enforce="$(compose_read_service_env ebap-hls-adapter STREAM_TICKET_ENFORCE "${compose[@]}" 2>/dev/null || true)"
  dsync_accept="$(compose_read_service_env device-sync-service STREAM_TICKET_ACCEPT "${compose[@]}" 2>/dev/null || true)"
  dsync_enforce="$(compose_read_service_env device-sync-service STREAM_TICKET_ENFORCE "${compose[@]}" 2>/dev/null || true)"

  export SEC005_GW_ENABLED="$gw_enabled"
  export SEC005_DS_ACCEPT="$ds_accept"
  export SEC005_HLS_ACCEPT="$hls_accept"
  export SEC005_DS_ENFORCE="$ds_enforce"
  export SEC005_HLS_ENFORCE="$hls_enforce"
  export SEC005_DSYNC_ACCEPT="$dsync_accept"
  export SEC005_DSYNC_ENFORCE="$dsync_enforce"

  if detect_sec005_bundle_mint_enabled "${LISTENER_ORIGIN:-https://earflow.ru}"; then
    mint_bundle=true
  fi
  export SEC005_BUNDLE_MINT="$mint_bundle"

  detect_sec005_gateway_mint_live "${PROD_API_ORIGIN:-https://api.earflow.ru}" "${LISTENER_ORIGIN:-https://earflow.ru}"
  case $? in
    0) gw_mint_live=true ;;
    2) gw_mint_unknown=true ;;
  esac
  export SEC005_GW_MINT_LIVE="$gw_mint_live"

  local gw_on=false ds_on=false hls_on=false
  if [[ "$gw_mint_live" == "true" ]] || detect_sec005_flag_on "$gw_enabled"; then
    gw_on=true
  fi
  detect_sec005_flag_on "$ds_accept" && ds_on=true
  detect_sec005_flag_on "$hls_accept" && hls_on=true

  local ds_enforce_on=false hls_enforce_on=false
  detect_sec005_flag_on "$ds_enforce" && ds_enforce_on=true
  detect_sec005_flag_on "$hls_enforce" && hls_enforce_on=true

  if "$gw_on" && "$ds_on" && "$hls_on" && "$ds_enforce_on" && "$hls_enforce_on"; then
    SEC005_PROD_MODE="phase7"
    export SEC005_PROD_MODE SEC005_SPLIT_REASON
    return 0
  fi

  if "$ds_enforce_on" || "$hls_enforce_on"; then
    if ! "$ds_enforce_on" || ! "$hls_enforce_on"; then
      SEC005_PROD_MODE="split"
      SEC005_SPLIT_REASON="partial ENFORCE (ds='${ds_enforce:-∅}' hls='${hls_enforce:-∅}') — re-run Phase 7 or rollback"
      export SEC005_PROD_MODE SEC005_SPLIT_REASON
      return 0
    fi
    if ! "$gw_on" || ! "$ds_on" || ! "$hls_on"; then
      SEC005_PROD_MODE="split"
      SEC005_SPLIT_REASON="ENFORCE on but mint/ACCEPT incomplete — re-run Phase 7"
      export SEC005_PROD_MODE SEC005_SPLIT_REASON
      return 0
    fi
  fi

  if "$gw_on" && "$ds_on" && "$hls_on"; then
    SEC005_PROD_MODE="phase6"
    export SEC005_PROD_MODE SEC005_SPLIT_REASON
    return 0
  fi

  if ! "$gw_on" && detect_sec005_flag_off "$ds_accept" && detect_sec005_flag_off "$hls_accept"; then
    if [[ "$mint_bundle" == "true" ]]; then
      SEC005_PROD_MODE="split"
      SEC005_SPLIT_REASON="frontend bundle mint:1 but gateway mint off — re-apply Phase 6 (plain docker compose up drops overlay)"
    else
      SEC005_PROD_MODE="norm"
    fi
    export SEC005_PROD_MODE SEC005_SPLIT_REASON
    return 0
  fi

  SEC005_PROD_MODE="split"
  SEC005_SPLIT_REASON="partial STREAM_TICKET flags (gw_mint=${gw_mint_live} gw_env='${gw_enabled:-∅}' ds='${ds_accept:-∅}' hls='${hls_accept:-∅}') — SEC005_PHASE6_CONFIRM=1 npm run run:sec005-phase6-prod-accept"
  export SEC005_PROD_MODE SEC005_SPLIT_REASON
  return 0
}
