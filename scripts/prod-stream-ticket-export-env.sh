#!/usr/bin/env bash
# Shared prod URL defaults for SEC-005 Phase 6+ gates (source, do not execute).

prod_stream_ticket_export_defaults() {
  local root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

  if [[ -f "$root/.env" ]]; then
    # shellcheck source=scripts/load-dotenv.sh
    source "$root/scripts/load-dotenv.sh"
    load_dotenv "$root/.env"
  fi

  export PROD_API_ORIGIN="${PROD_API_ORIGIN:-https://api.earflow.ru}"
  export LISTENER_ORIGIN="${LISTENER_ORIGIN:-https://earflow.ru}"
  export DIRECT_STREAM_BASE_URL="${DIRECT_STREAM_PUBLIC_ORIGIN:-https://strmhaha.earflow.ru}"
  export AUTH_E2E_BASE_URL="${AUTH_E2E_BASE_URL:-$PROD_API_ORIGIN}"
  export AUTH_E2E_ORIGIN="${AUTH_E2E_ORIGIN:-$LISTENER_ORIGIN}"
}
