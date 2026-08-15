#!/usr/bin/env bash
# Shared auth-e2e environment defaults (source, do not execute).
# Used by verify-auth-security-replay, run-auth-fullstack-e2e, etc.

auth_e2e_export_defaults() {
  local root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

  if [[ -f "$root/.env" ]]; then
    # shellcheck source=scripts/load-dotenv.sh
    source "$root/scripts/load-dotenv.sh"
    load_dotenv "$root/.env"
  fi

  export AUTH_E2E_BASE_URL="${AUTH_E2E_BASE_URL:-http://127.0.0.1:18080}"
  export AUTH_E2E_ORIGIN="${AUTH_E2E_ORIGIN:-$AUTH_E2E_BASE_URL}"
  export AUTH_E2E_HOST_PORT="${AUTH_E2E_HOST_PORT:-18080}"
  export AUTH_E2E_EMAIL="${AUTH_E2E_EMAIL:-pop-e2e@earflow.test}"
  export AUTH_E2E_PASSWORD="${AUTH_E2E_PASSWORD:-PopE2eTest1}"
  export AUTH_E2E_USERNAME="${AUTH_E2E_USERNAME:-pope2e}"
  export AUTH_E2E_ALLOWED_ORIGINS="${AUTH_E2E_ALLOWED_ORIGINS:-http://127.0.0.1:18080,http://localhost:18080,http://auth-e2e-edge:8080}"
  export AUTH_E2E_COOKIE_DOMAIN="${AUTH_E2E_COOKIE_DOMAIN:-host}"
  export AUTH_E2E_COOKIE_SECURE="${AUTH_E2E_COOKIE_SECURE:-false}"
  export AUTH_E2E_COOKIE_SAMESITE="${AUTH_E2E_COOKIE_SAMESITE:-Lax}"

  if [[ -f "$root/scripts/auth-e2e-ensure-origins.sh" ]]; then
    # shellcheck source=scripts/auth-e2e-ensure-origins.sh
    source "$root/scripts/auth-e2e-ensure-origins.sh"
    auth_e2e_ensure_docker_origin
  fi
}

auth_e2e_compose_up() {
  local root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
  shift || true
  local services=(
    postgres redis redis-auth database-service auth-core security-service
    api-gateway frontend auth-e2e-edge
  )
  if [[ $# -gt 0 ]]; then
    services=("$@")
  fi
  docker compose -f "$root/docker-compose.yml" -f "$root/docker-compose.auth-e2e.yml" \
    up -d --force-recreate "${services[@]}"
}
