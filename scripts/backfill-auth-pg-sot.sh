#!/usr/bin/env bash
# PEND-SEC-011 — backfill Postgres auth SoT from Redis (server/staging only).
# Requires: migration 003 applied, AUTH_PG_SOT_MODE=off during backfill.
#
# Usage:
#   export DATABASE_URL=postgres://...
#   export REDIS_AUTH_HOST=127.0.0.1 REDIS_AUTH_PORT=6379 REDIS_PASSWORD=...
#   bash scripts/backfill-auth-pg-sot.sh
# Dry-run (counts only, no PG writes):
#   AUTH_PG_BACKFILL_DRY_RUN=1 bash scripts/backfill-auth-pg-sot.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/backend/security-service"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL required" >&2
  exit 1
fi

echo "[backfill] running auth-pg-backfill (Redis auth layer -> Postgres)"
go run ./cmd/auth-pg-backfill/
