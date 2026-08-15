#!/usr/bin/env bash
# SEC-005 Phase 4 — one-shot auth-e2e staging (build mint frontend → verify → restore prod).
#
# Usage (VPS):
#   cd /opt/music-platform
#   git pull origin main
#   bash scripts/run-sec005-phase4-staging.sh
#
# Exit 0 = Phase 4 gate PASS + prod restored.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.auth-e2e.yml)

log() { echo "[phase4-staging] $*"; }

log "build frontend with REACT_APP_STREAM_TICKET_MINT_ENABLED=1 (auth-e2e overlay)"
"${COMPOSE[@]}" build frontend

log "start auth-e2e stack"
"${COMPOSE[@]}" up -d \
  postgres redis redis-auth database-service auth-core security-service \
  api-gateway frontend direct-stream-service ebap-hls-adapter auth-e2e-edge

bash "$ROOT/scripts/auth-e2e-wait-healthy.sh"

log "Phase 4 gate"
bash "$ROOT/scripts/verify-stream-ticket-phase4.sh"

log "restore prod norm"
bash "$ROOT/scripts/restore-prod-after-auth-e2e.sh"

log "done — Phase 4 staging PASS; prod STREAM_TICKET_* off; frontend mint:0"
