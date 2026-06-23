#!/usr/bin/env bash
# SEC-005 Phase 7 — enable prod ENFORCE (legacy stream cookie → 401).
#
# Prerequisites:
#   Phase 6 prod ACCEPT PASS + soak
#   AUTH_E2E_EMAIL / AUTH_E2E_PASSWORD in .env
#
# Usage (VPS):
#   SEC005_PHASE7_CONFIRM=1 npm run run:sec005-phase7-prod-enforce

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.stream-prod-enforce.yml)
COMPOSE_AUTO=(docker compose -f docker-compose.yml)

log() { echo "[phase7-prod-enforce] $*"; }

# shellcheck source=scripts/sec005-prod-overlay.sh
source "$ROOT/scripts/sec005-prod-overlay.sh"
# shellcheck source=scripts/compose-read-service-env.sh
source "$ROOT/scripts/compose-read-service-env.sh"

if [[ "${SEC005_PHASE7_CONFIRM:-}" != "1" ]]; then
  echo "Refusing prod Phase 7 without SEC005_PHASE7_CONFIRM=1" >&2
  echo "Required: Phase 6 soak complete; verify:stream-ticket-phase6-prod PASS." >&2
  exit 1
fi

if [[ ! -f "$ROOT/.env" ]]; then
  echo "FAIL: missing .env" >&2
  exit 1
fi

log "preflight — Phase 6 mint must be live"
mint_code="$(curl -sS -o /dev/null -w "%{http_code}" \
  -X POST "${PROD_API_ORIGIN:-https://api.earflow.ru}/api/auth/stream-ticket" \
  -H "Origin: ${LISTENER_ORIGIN:-https://earflow.ru}" \
  -H "Content-Type: application/json" \
  -d '{"kind":"media","scope":{"sessionId":"x","trackId":"y"},"client":"web"}' 2>/dev/null || echo "000")"
if [[ "$mint_code" != "401" && "$mint_code" != "403" ]]; then
  echo "FAIL: gateway mint not live (HTTP ${mint_code}) — run Phase 6 first:" >&2
  echo "  SEC005_PHASE6_CONFIRM=1 npm run run:sec005-phase6-prod-accept" >&2
  exit 1
fi

ds_accept="$(compose_read_service_env direct-stream-service STREAM_TICKET_ACCEPT "${COMPOSE_AUTO[@]}" 2>/dev/null || true)"
if [[ "$ds_accept" != "1" && "$ds_accept" != "true" ]]; then
  echo "FAIL: direct-stream STREAM_TICKET_ACCEPT not 1 — run Phase 6 first" >&2
  exit 1
fi

log "enable docker-compose.override.yml → stream-prod-enforce"
sec005_prod_overlay_enable "$ROOT" enforce

log "recreate stream services + nginx (ENFORCE=1)"
"${COMPOSE[@]}" up -d --force-recreate direct-stream-service ebap-hls-adapter nginx

log "wait for health"
sleep 12

log "Phase 7 prod ENFORCE gate"
bash "$ROOT/scripts/verify-stream-ticket-phase7-prod.sh"

log "done — prod ENFORCE active. Manual: 30s playback on earflow.ru (must use ?st= tickets)."
log "Rollback: SEC005_PHASE7_ROLLBACK_CONFIRM=1 npm run rollback:sec005-phase7-prod"
