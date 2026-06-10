#!/usr/bin/env bash
# SEC-005 Phase 6 — enable prod ACCEPT dual-mode (NOT ENFORCE).
#
# Prerequisites:
#   - Phase 4 + 5 staging PASS on this host
#   - bash scripts/restore-prod-after-auth-e2e.sh (no auth-e2e overlay leak)
#   - AUTH_E2E_EMAIL / AUTH_E2E_PASSWORD in .env (prod consume gate)
#
# Usage (VPS):
#   cd /opt/music-platform
#   git pull origin main
#   SEC005_PHASE6_CONFIRM=1 npm run run:sec005-phase6-prod-accept
#
# Leaves prod in ACCEPT mode until rollback or Phase 7.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.stream-prod-accept.yml)
COMPOSE_E2E=(docker compose -f docker-compose.yml -f docker-compose.auth-e2e.yml)
COMPOSE_PROD=(docker compose -f docker-compose.yml)

log() { echo "[phase6-prod-accept] $*"; }

# shellcheck source=scripts/sec005-phase6-overlay.sh
source "$ROOT/scripts/sec005-phase6-overlay.sh"

if [[ "${SEC005_PHASE6_CONFIRM:-}" != "1" ]]; then
  echo "Refusing prod Phase 6 without SEC005_PHASE6_CONFIRM=1" >&2
  echo "Required: Phase 4+5 staging PASS + restore-prod clean." >&2
  exit 1
fi

if [[ ! -f "$ROOT/.env" ]]; then
  echo "FAIL: missing .env" >&2
  exit 1
fi

log "preflight — no auth-e2e overlay leak"
e2e_port_up=false
if curl -fsS --max-time 2 "http://127.0.0.1:${AUTH_E2E_HOST_PORT:-18080}/health" >/dev/null 2>&1; then
  e2e_port_up=true
fi
if [[ "$e2e_port_up" == "true" ]]; then
  echo "FAIL: auth-e2e edge still reachable on 127.0.0.1:${AUTH_E2E_HOST_PORT:-18080}" >&2
  echo "Run: bash scripts/restore-prod-after-auth-e2e.sh" >&2
  exit 1
fi

fe_api="$("${COMPOSE_PROD[@]}" exec -T frontend printenv EARFLOW_API_BASE_URL 2>/dev/null | tr -d '\r' || true)"
if [[ -n "$fe_api" && "$fe_api" == *127.0.0.1* ]]; then
  echo "FAIL: frontend EARFLOW_API_BASE_URL='$fe_api' — run restore-prod first" >&2
  exit 1
fi

cookie_domain="$("${COMPOSE_PROD[@]}" exec -T api-gateway printenv COOKIE_DOMAIN 2>/dev/null | tr -d '\r' || true)"
if [[ "$cookie_domain" == "host" ]]; then
  echo "FAIL: api-gateway COOKIE_DOMAIN=host (auth-e2e overlay) — run restore-prod first" >&2
  exit 1
fi

log "enable docker-compose.override.yml → stream-prod-accept (survives plain docker compose up)"
sec005_phase6_overlay_enable "$ROOT"

log "build frontend + stream services with stream-prod-accept overlay"
"${COMPOSE[@]}" build frontend direct-stream-service ebap-hls-adapter api-gateway

log "recreate gateway, frontend, stream services, nginx"
"${COMPOSE[@]}" up -d --force-recreate \
  api-gateway frontend direct-stream-service ebap-hls-adapter nginx

log "wait for health"
sleep 10
if curl -fsS --max-time 15 "${LISTENER_ORIGIN:-https://earflow.ru}/" >/dev/null 2>&1; then
  log "listener reachable"
else
  log "warn: listener not yet reachable — continuing gate anyway"
fi

log "Phase 6 prod ACCEPT gate"
bash "$ROOT/scripts/verify-stream-ticket-phase6-prod.sh"

log "done — prod ACCEPT active (dual-mode). ENFORCE stays off."
log "Manual: play 30s on https://earflow.ru; DevTools Network → stream URLs may include ?st="
log "Rollback: SEC005_ROLLBACK_CONFIRM=1 npm run rollback:sec005-phase6-prod"
