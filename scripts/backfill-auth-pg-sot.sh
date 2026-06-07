#!/usr/bin/env bash
# PEND-SEC-011 — backfill Postgres auth SoT from Redis (server/staging only).
# Requires: migration 003 applied, AUTH_PG_SOT_MODE=off during backfill.
#
# Usage:
#   bash scripts/backfill-auth-pg-sot.sh
# Dry-run (counts only, no PG writes):
#   AUTH_PG_BACKFILL_DRY_RUN=1 bash scripts/backfill-auth-pg-sot.sh
#
# Prefer docker (no host Go required):
#   docker compose run --rm --no-deps --entrypoint /app/auth-pg-backfill security-service
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if docker compose -f docker-compose.yml images security-service 2>/dev/null | grep -q security-service; then
  echo "[backfill] via docker compose (security-service /app/auth-pg-backfill)"
  docker compose -f docker-compose.yml run --rm --no-deps \
    -e AUTH_PG_BACKFILL_DRY_RUN="${AUTH_PG_BACKFILL_DRY_RUN:-}" \
    --entrypoint /app/auth-pg-backfill \
    security-service
  exit 0
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  if [[ -f "$ROOT/.env" ]]; then
    # shellcheck disable=SC1091
    set -a
    source "$ROOT/.env"
    set +a
    if [[ -n "${DB_USER:-}" && -n "${DB_PASSWORD:-}" && -n "${DB_NAME:-}" ]]; then
      export DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST:-127.0.0.1}:${DB_PORT:-5432}/${DB_NAME}?sslmode=disable"
    fi
  fi
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL required (or .env with DB_* for host go run)" >&2
  exit 1
fi

echo "[backfill] via host go run (build security-service image for docker path)"
cd "$ROOT/backend/security-service"
go run ./cmd/auth-pg-backfill/
