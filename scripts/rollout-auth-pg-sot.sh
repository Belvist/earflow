#!/usr/bin/env bash
# PEND-SEC-011 — Postgres auth SoT rollout (VPS / staging).
#
# Phases (run in order; do not skip):
#   migrate      — apply 003_auth_postgres_sot.sql
#   backfill-dry — count Redis sessions/devices (no PG writes)
#   backfill     — copy Redis → Postgres (AUTH_PG_SOT_MODE must stay off)
#   backfill-live — same as backfill when dual_write already enabled (recovery)
#   enable       — set AUTH_PG_SOT_MODE=dual_write + recreate gateway/security
#   verify       — scripts/verify-auth-pg-sot.sh
#   all          — migrate → backfill-dry → backfill → enable → verify
#
# Usage:
#   cd /opt/music-platform
#   bash scripts/rollout-auth-pg-sot.sh migrate
#   bash scripts/rollout-auth-pg-sot.sh all
#
# Non-interactive enable:
#   AUTO_ENABLE=1 bash scripts/rollout-auth-pg-sot.sh enable
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.yml)
MIGRATION="$ROOT/backend/database-service/database/migrations/003_auth_postgres_sot.sql"
PHASE="${1:-all}"

if [[ ! -f "$ROOT/.env" ]]; then
  echo "FAIL: .env missing in $ROOT" >&2
  exit 1
fi

# shellcheck source=scripts/load-dotenv.sh
source "$ROOT/scripts/load-dotenv.sh"
load_dotenv "$ROOT/.env"

: "${DB_USER:?DB_USER required in .env}"
: "${DB_NAME:?DB_NAME required in .env}"
: "${DB_PASSWORD:?DB_PASSWORD required in .env}"

current_sot_mode() {
  grep -E '^AUTH_PG_SOT_MODE=' "$ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r" ' || echo "off"
}

require_sot_off() {
  local mode
  mode="$(current_sot_mode)"
  mode="${mode:-off}"
  if [[ "$mode" != "off" && "$mode" != "" ]]; then
    echo "FAIL: AUTH_PG_SOT_MODE=$mode — must be off for migrate/backfill" >&2
    echo "Rollback: set AUTH_PG_SOT_MODE=off and recreate api-gateway security-service" >&2
    exit 1
  fi
}

run_backfill() {
  local dry="$1"
  echo "=== Backfill (dry=$dry) ==="
  if [[ "$dry" == "1" ]]; then
    export AUTH_PG_BACKFILL_DRY_RUN=1
  else
    unset AUTH_PG_BACKFILL_DRY_RUN
  fi
  echo "Building security-service (auth-pg-backfill binary)..."
  "${COMPOSE[@]}" build security-service
  echo "Running auth-pg-backfill via docker compose..."
  "${COMPOSE[@]}" run --rm --no-deps \
    -e AUTH_PG_BACKFILL_DRY_RUN="${AUTH_PG_BACKFILL_DRY_RUN:-}" \
    --entrypoint /app/auth-pg-backfill \
    security-service
}

phase_migrate() {
  require_sot_off
  if [[ ! -f "$MIGRATION" ]]; then
    echo "FAIL: missing $MIGRATION" >&2
    exit 1
  fi
  echo "=== [1] Postgres migration 003 ==="
  "${COMPOSE[@]}" up -d postgres
  "${COMPOSE[@]}" exec -T postgres pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null
  "${COMPOSE[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" < "$MIGRATION"
  echo "PASS migration 003"
  "${COMPOSE[@]}" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -c \
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('auth_sessions','auth_devices','refresh_tokens','security_events') ORDER BY 1;"
}

phase_backfill_dry() {
  require_sot_off
  run_backfill 1
}

phase_backfill() {
  require_sot_off
  run_backfill 0
}

phase_backfill_live() {
  echo "=== Backfill (live — AUTH_PG_SOT_MODE may be dual_write) ==="
  run_backfill 0
}

phase_enable() {
  echo "=== Enable AUTH_PG_SOT_MODE=dual_write ==="
  if grep -q '^AUTH_PG_SOT_MODE=' "$ROOT/.env"; then
    if [[ "${AUTO_ENABLE:-}" == "1" ]]; then
      sed -i.bak 's/^AUTH_PG_SOT_MODE=.*/AUTH_PG_SOT_MODE=dual_write/' "$ROOT/.env"
    else
      echo "Set AUTH_PG_SOT_MODE=dual_write in .env manually, then rerun: bash scripts/rollout-auth-pg-sot.sh enable"
      echo "Or: AUTO_ENABLE=1 bash scripts/rollout-auth-pg-sot.sh enable"
      exit 1
    fi
  else
    echo 'AUTH_PG_SOT_MODE=dual_write' >> "$ROOT/.env"
  fi
  load_dotenv "$ROOT/.env"
  echo "Building security-service (includes auth-pg-backfill) + api-gateway..."
  "${COMPOSE[@]}" build --no-cache security-service api-gateway
  "${COMPOSE[@]}" up -d --force-recreate security-service api-gateway
  echo "Waiting for health..."
  sleep 5
  "${COMPOSE[@]}" ps security-service api-gateway
  echo "PASS dual_write enabled — run verify + browser revoke checks"
}

phase_verify() {
  bash "$ROOT/scripts/verify-auth-pg-sot.sh"
}

run_phase() {
  case "$1" in
    migrate) phase_migrate ;;
    backfill-dry) phase_backfill_dry ;;
    backfill) phase_backfill ;;
    backfill-live) phase_backfill_live ;;
    enable) phase_enable ;;
    verify) phase_verify ;;
    all)
      phase_migrate
      phase_backfill_dry
      phase_backfill
      if [[ "${AUTO_ENABLE:-}" == "1" ]]; then
        phase_enable
        phase_verify
      else
        echo ""
        echo "Next: review backfill counts, then:"
        echo "  AUTO_ENABLE=1 bash scripts/rollout-auth-pg-sot.sh enable"
        echo "  bash scripts/rollout-auth-pg-sot.sh verify"
      fi
      ;;
    *)
      echo "Unknown phase: $1" >&2
      echo "Usage: bash scripts/rollout-auth-pg-sot.sh {migrate|backfill-dry|backfill|backfill-live|enable|verify|all}" >&2
      exit 1
      ;;
  esac
}

run_phase "$PHASE"
