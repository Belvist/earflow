#!/usr/bin/env bash
# Ensure Playwright-in-Docker origin is in AUTH_E2E_ALLOWED_ORIGINS.
# .env may set AUTH_E2E_ALLOWED_ORIGINS without http://auth-e2e-edge:8080 — load_dotenv in verify overwrites shell defaults.
auth_e2e_ensure_docker_origin() {
  local docker_origin="http://auth-e2e-edge:8080"
  local fallback="http://127.0.0.1:18080,http://localhost:18080"
  local current="${AUTH_E2E_ALLOWED_ORIGINS:-$fallback}"
  current="${current// /}"
  current="${current%,}"
  if [[ ",${current}," != *",${docker_origin},"* ]]; then
    export AUTH_E2E_ALLOWED_ORIGINS="${current},${docker_origin}"
  else
    export AUTH_E2E_ALLOWED_ORIGINS="$current"
  fi
}
