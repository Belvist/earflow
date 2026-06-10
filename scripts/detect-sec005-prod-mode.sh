#!/usr/bin/env bash
# Detect SEC-005 prod rollout mode: norm | phase6 | split (source or run).
#
# Usage:
#   source scripts/detect-sec005-prod-mode.sh && detect_sec005_prod_mode "$ROOT"
#   echo $SEC005_PROD_MODE   # norm | phase6 | split | unknown
#
# Exit 0 always from detect function; callers decide pass/fail on split.

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

detect_sec005_prod_mode() {
  local root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
  local compose=(docker compose -f "$root/docker-compose.yml")
  local gw_enabled="" ds_accept="" hls_accept="" ds_enforce="" hls_enforce=""
  local mint_bundle=false

  SEC005_PROD_MODE="unknown"
  SEC005_SPLIT_REASON=""

  if ! command -v docker >/dev/null 2>&1; then
    SEC005_PROD_MODE="unknown"
    return 0
  fi

  gw_enabled="$("${compose[@]}" exec -T api-gateway printenv STREAM_TICKET_ENABLED 2>/dev/null | tr -d '\r' | head -1 || true)"
  ds_accept="$("${compose[@]}" exec -T direct-stream-service printenv STREAM_TICKET_ACCEPT 2>/dev/null | tr -d '\r' || true)"
  hls_accept="$("${compose[@]}" exec -T ebap-hls-adapter printenv STREAM_TICKET_ACCEPT 2>/dev/null | tr -d '\r' || true)"
  ds_enforce="$("${compose[@]}" exec -T direct-stream-service printenv STREAM_TICKET_ENFORCE 2>/dev/null | tr -d '\r' || true)"
  hls_enforce="$("${compose[@]}" exec -T ebap-hls-adapter printenv STREAM_TICKET_ENFORCE 2>/dev/null | tr -d '\r' || true)"

  export SEC005_GW_ENABLED="$gw_enabled"
  export SEC005_DS_ACCEPT="$ds_accept"
  export SEC005_HLS_ACCEPT="$hls_accept"
  export SEC005_DS_ENFORCE="$ds_enforce"
  export SEC005_HLS_ENFORCE="$hls_enforce"

  if detect_sec005_bundle_mint_enabled "${LISTENER_ORIGIN:-https://earflow.ru}"; then
    mint_bundle=true
  fi
  export SEC005_BUNDLE_MINT="$mint_bundle"

  local gw_on=false ds_on=false hls_on=false
  detect_sec005_flag_on "$gw_enabled" && gw_on=true
  detect_sec005_flag_on "$ds_accept" && ds_on=true
  detect_sec005_flag_on "$hls_accept" && hls_on=true

  if detect_sec005_flag_on "$ds_enforce" || detect_sec005_flag_on "$hls_enforce"; then
    SEC005_PROD_MODE="split"
    SEC005_SPLIT_REASON="STREAM_TICKET_ENFORCE on prod without Phase 7 gate — unexpected"
    export SEC005_PROD_MODE SEC005_SPLIT_REASON
    return 0
  fi

  if "$gw_on" && "$ds_on" && "$hls_on"; then
    SEC005_PROD_MODE="phase6"
    export SEC005_PROD_MODE SEC005_SPLIT_REASON
    return 0
  fi

  if detect_sec005_flag_off "$gw_enabled" \
    && detect_sec005_flag_off "$ds_accept" \
    && detect_sec005_flag_off "$hls_accept"; then
    if [[ "$mint_bundle" == "true" ]]; then
      SEC005_PROD_MODE="split"
      SEC005_SPLIT_REASON="frontend bundle mint:1 but STREAM_TICKET_* off — run restore-prod fully OR re-apply Phase 6"
    else
      SEC005_PROD_MODE="norm"
    fi
    export SEC005_PROD_MODE SEC005_SPLIT_REASON
    return 0
  fi

  SEC005_PROD_MODE="split"
  SEC005_SPLIT_REASON="partial STREAM_TICKET flags (gw='${gw_enabled:-∅}' ds='${ds_accept:-∅}' hls='${hls_accept:-∅}') — re-run Phase 6 or rollback"
  export SEC005_PROD_MODE SEC005_SPLIT_REASON
  return 0
}
