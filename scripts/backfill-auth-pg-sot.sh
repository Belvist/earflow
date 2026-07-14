#!/usr/bin/env bash
# PEND-SEC-011 — backfill Postgres auth SoT from Redis (server/staging only).
# Requires: migration 003 applied, AUTH_PG_SOT_MODE=off during backfill.
#
# Usage:
#   bash scripts/backfill-auth-pg-sot.sh
# Dry-run (counts only, no PG writes):
#   AUTH_PG_BACKFILL_DRY_RUN=1 bash scripts/backfill-auth-pg-sot.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.yml)

echo "[backfill] building security-service + running /app/auth-pg-backfill in docker"
"${COMPOSE[@]}" build security-service
"${COMPOSE[@]}" run --rm --no-deps \
  -e AUTH_PG_BACKFILL_DRY_RUN="${AUTH_PG_BACKFILL_DRY_RUN:-}" \
  --entrypoint /app/auth-pg-backfill \
  security-service
