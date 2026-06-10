#!/usr/bin/env bash
# Restore production api-gateway + frontend after auth-e2e DoD overlay
# or SEC-005 Phase 6 rollback (see scripts/rollback-sec005-phase6-prod.sh).
#
# The DoD runner uses docker-compose.auth-e2e.yml which temporarily sets:
#   frontend.EARFLOW_API_BASE_URL → http://127.0.0.1:18080
#   api-gateway COOKIE_DOMAIN/ALLOWED_ORIGINS → e2e values
#   api-gateway STREAM_TICKET_ENABLED → 1 (SEC-005 OBSERVE on e2e only)
#
# Run this before serving earflow.ru / auth.earflow.ru again.
#
# Usage:
#   cd /opt/music-platform
#   git pull origin main
#   bash scripts/restore-prod-after-auth-e2e.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE_PROD=(docker compose -f docker-compose.yml)
COMPOSE_E2E=(docker compose -f docker-compose.yml -f docker-compose.auth-e2e.yml)

log() { echo "[restore-prod] $*"; }

if [[ ! -f "$ROOT/.env" ]]; then
  echo "FAIL: missing .env" >&2
  exit 1
fi

log "stop auth-e2e edge (port 18080) if running"
"${COMPOSE_E2E[@]}" stop auth-e2e-edge 2>/dev/null || true
"${COMPOSE_E2E[@]}" rm -f auth-e2e-edge 2>/dev/null || true

log "build api-gateway + frontend (prod compose only — no e2e overlay)"
"${COMPOSE_PROD[@]}" build api-gateway frontend

log "recreate api-gateway, frontend, direct-stream, ebap-hls, nginx with prod .env"
"${COMPOSE_PROD[@]}" up -d --force-recreate api-gateway frontend direct-stream-service ebap-hls-adapter nginx

log "wait for health"
sleep 5

API_URL="$("${COMPOSE_PROD[@]}" exec -T frontend printenv EARFLOW_API_BASE_URL 2>/dev/null | tr -d '\r' || true)"
COOKIE_DOMAIN="$("${COMPOSE_PROD[@]}" exec -T api-gateway printenv COOKIE_DOMAIN 2>/dev/null | tr -d '\r' || true)"
ALLOWED="$("${COMPOSE_PROD[@]}" exec -T api-gateway printenv ALLOWED_ORIGINS 2>/dev/null | tr -d '\r' || true)"

log "frontend EARFLOW_API_BASE_URL='${API_URL:-<empty>}' (prod: empty = same-origin via nginx)"
log "api-gateway COOKIE_DOMAIN='${COOKIE_DOMAIN:-<empty>}'"
log "api-gateway ALLOWED_ORIGINS='${ALLOWED:-<empty>}'"

if [[ -n "$API_URL" && "$API_URL" == *127.0.0.1* ]]; then
  echo "FAIL: frontend still points at e2e URL — check .env EARFLOW_API_BASE_URL and recreate frontend" >&2
  exit 1
fi

if [[ "$COOKIE_DOMAIN" == "host" ]]; then
  echo "FAIL: api-gateway still on e2e COOKIE_DOMAIN=host — rerun without auth-e2e overlay" >&2
  exit 1
fi

STREAM_ENABLED="$("${COMPOSE_PROD[@]}" exec -T api-gateway printenv STREAM_TICKET_ENABLED 2>/dev/null | tr -d '\r' || true)"
STREAM_OBSERVE="$("${COMPOSE_PROD[@]}" exec -T api-gateway printenv STREAM_TICKET_OBSERVE 2>/dev/null | tr -d '\r' || true)"
log "api-gateway STREAM_TICKET_ENABLED='${STREAM_ENABLED:-<empty>}' (prod: empty or 0)"
log "api-gateway STREAM_TICKET_OBSERVE='${STREAM_OBSERVE:-<empty>}' (prod: empty or 0)"

if [[ "$STREAM_ENABLED" == "1" || "$STREAM_ENABLED" == "true" ]]; then
  echo "FAIL: api-gateway STREAM_TICKET_ENABLED still on — force-recreate api-gateway with prod compose only" >&2
  exit 1
fi

DS_ACCEPT="$("${COMPOSE_PROD[@]}" exec -T direct-stream-service printenv STREAM_TICKET_ACCEPT 2>/dev/null | tr -d '\r' || true)"
HLS_ACCEPT="$("${COMPOSE_PROD[@]}" exec -T ebap-hls-adapter printenv STREAM_TICKET_ACCEPT 2>/dev/null | tr -d '\r' || true)"
log "direct-stream STREAM_TICKET_ACCEPT='${DS_ACCEPT:-<empty>}' (prod: empty or 0)"
log "ebap-hls STREAM_TICKET_ACCEPT='${HLS_ACCEPT:-<empty>}' (prod: empty or 0)"
if [[ "$DS_ACCEPT" == "1" || "$DS_ACCEPT" == "true" ]]; then
  echo "FAIL: direct-stream STREAM_TICKET_ACCEPT still on — recreate without auth-e2e overlay" >&2
  exit 1
fi
if [[ "$HLS_ACCEPT" == "1" || "$HLS_ACCEPT" == "true" ]]; then
  echo "FAIL: ebap-hls STREAM_TICKET_ACCEPT still on — recreate without auth-e2e overlay" >&2
  exit 1
fi

DS_ENFORCE="$("${COMPOSE_PROD[@]}" exec -T direct-stream-service printenv STREAM_TICKET_ENFORCE 2>/dev/null | tr -d '\r' || true)"
HLS_ENFORCE="$("${COMPOSE_PROD[@]}" exec -T ebap-hls-adapter printenv STREAM_TICKET_ENFORCE 2>/dev/null | tr -d '\r' || true)"
log "direct-stream STREAM_TICKET_ENFORCE='${DS_ENFORCE:-<empty>}' (prod: empty or 0)"
log "ebap-hls STREAM_TICKET_ENFORCE='${HLS_ENFORCE:-<empty>}' (prod: empty or 0)"
if [[ "$DS_ENFORCE" == "1" || "$DS_ENFORCE" == "true" ]]; then
  echo "FAIL: direct-stream STREAM_TICKET_ENFORCE still on — recreate without auth-e2e overlay" >&2
  exit 1
fi
if [[ "$HLS_ENFORCE" == "1" || "$HLS_ENFORCE" == "true" ]]; then
  echo "FAIL: ebap-hls STREAM_TICKET_ENFORCE still on — recreate without auth-e2e overlay" >&2
  exit 1
fi

log "nginx config test"
"${COMPOSE_PROD[@]}" exec -T nginx nginx -t

log "smoke: verify-auth-proof-token.sh (infra)"
bash "$ROOT/scripts/verify-auth-proof-token.sh" || true

log "verify frontend API base guard"
bash "$ROOT/scripts/verify-frontend-api-base.sh"

log "verify stream ticket prod gate (STREAM_TICKET_ENABLED off → 404)"
bash "$ROOT/scripts/verify-stream-ticket.sh"

log "verify stream ticket ACCEPT off on prod (consume dual-mode disabled)"
bash "$ROOT/scripts/verify-stream-ticket-accept.sh"

log "done — hard refresh browser (Ctrl+Shift+R) on earflow.ru / auth.earflow.ru"
log "DevTools: hot GET /api/profile should use https://api.earflow.ru or same-origin, NOT 127.0.0.1:18080"
