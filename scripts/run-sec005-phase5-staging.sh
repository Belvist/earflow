#!/usr/bin/env bash
# SEC-005 Phase 5 — auth-e2e ENFORCE staging (build mint frontend → ENFORCE gate → restore prod).
#
# Usage (VPS):
#   cd /opt/music-platform
#   git pull origin main
#   npm run run:sec005-phase5-staging

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.auth-e2e.yml)

log() { echo "[phase5-staging] $*"; }

export STREAM_TICKET_ENFORCE=1

log "build frontend with REACT_APP_STREAM_TICKET_MINT_ENABLED=1 (auth-e2e overlay)"
"${COMPOSE[@]}" build frontend direct-stream-service ebap-hls-adapter

log "start auth-e2e stack (STREAM_TICKET_ENFORCE=1)"
"${COMPOSE[@]}" up -d \
  postgres redis redis-auth database-service auth-service security-service \
  api-gateway frontend direct-stream-service ebap-hls-adapter auth-e2e-edge

bash "$ROOT/scripts/auth-e2e-wait-healthy.sh"

log "Phase 5 ENFORCE gate"
bash "$ROOT/scripts/verify-stream-ticket-phase5.sh"

log "restore prod norm"
bash "$ROOT/scripts/restore-prod-after-auth-e2e.sh"

log "done — Phase 5 staging PASS; prod STREAM_TICKET_* off; ENFORCE off"
