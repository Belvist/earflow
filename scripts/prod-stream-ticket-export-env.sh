#!/usr/bin/env bash
# Shared prod URL defaults for SEC-005 Phase 6+ gates (source, do not execute).

prod_stream_ticket_is_e2e_origin() {
  local v="${1:-}"
  v="$(printf '%s' "$v" | tr '[:upper:]' '[:lower:]' | tr -d '\r')"
  [[ -z "$v" ]] && return 1
  [[ "$v" == *127.0.0.1* ]] && return 0
  [[ "$v" == *localhost* ]] && return 0
  [[ "$v" == *:18080* ]] && return 0
  [[ "$v" == *auth-e2e* ]] && return 0
  return 1
}

prod_stream_ticket_export_defaults() {
  local root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
  local cred_email cred_password

  if [[ -f "$root/.env" ]]; then
    # shellcheck source=scripts/load-dotenv.sh
    source "$root/scripts/load-dotenv.sh"
    load_dotenv "$root/.env"
  fi

  cred_email="${AUTH_E2E_EMAIL:-}"
  cred_password="${AUTH_E2E_PASSWORD:-}"

  export PROD_API_ORIGIN="${PROD_API_ORIGIN:-https://api.earflow.ru}"
  export LISTENER_ORIGIN="${LISTENER_ORIGIN:-https://earflow.ru}"
  export DIRECT_STREAM_BASE_URL="${DIRECT_STREAM_PUBLIC_ORIGIN:-https://strmhaha.earflow.ru}"

  # Phase 6 prod gate must never use auth-e2e URLs left in .env (common after DoD runs).
  if prod_stream_ticket_is_e2e_origin "${AUTH_E2E_BASE_URL:-}"; then
    export AUTH_E2E_BASE_URL="$PROD_API_ORIGIN"
  else
    export AUTH_E2E_BASE_URL="${AUTH_E2E_BASE_URL:-$PROD_API_ORIGIN}"
  fi
  if prod_stream_ticket_is_e2e_origin "${AUTH_E2E_ORIGIN:-}"; then
    export AUTH_E2E_ORIGIN="$LISTENER_ORIGIN"
  else
    export AUTH_E2E_ORIGIN="${AUTH_E2E_ORIGIN:-$LISTENER_ORIGIN}"
  fi

  export AUTH_E2E_EMAIL="$cred_email"
  export AUTH_E2E_PASSWORD="$cred_password"
}
