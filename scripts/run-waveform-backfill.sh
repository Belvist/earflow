#!/usr/bin/env bash
# PEND-WAVE-001 — one-time waveform peaks backfill.
# Run on VPS where docker is available:
#   bash scripts/run-waveform-backfill.sh
#
# This marks existing tracks (uploaded before waveform_peaks migration) as
# waveform_status='pending' so transcode-worker picks them up for processing.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== PEND-WAVE-001: Waveform peaks backfill ==="

if ! command -v docker &>/dev/null; then
    echo "FAIL  docker not available — run on VPS"
    exit 1
fi

# Load env for DB credentials
if [[ -f "$PROJECT_DIR/.env" ]]; then
    # shellcheck disable=SC1091
    set -a; source "$PROJECT_DIR/.env"; set +a
fi

DB_USER="${DB_USER:-earflow}"
DB_NAME="${DB_NAME:-earflow}"

echo "Copying SQL to container..."
docker cp "$SCRIPT_DIR/backfill-waveform-status.sql" music-postgres:/tmp/backfill-waveform-status.sql

echo "Running backfill..."
docker exec music-postgres psql -U "$DB_USER" -d "$DB_NAME" -f /tmp/backfill-waveform-status.sql

echo ""
echo "Verify: tracks with waveform_status='pending' waiting for transcode-worker:"
docker exec music-postgres psql -U "$DB_USER" -d "$DB_NAME" -c \
    "SELECT waveform_status, count(*) FROM songs WHERE is_available = true GROUP BY waveform_status ORDER BY 1;"

echo ""
echo "DONE  transcode-worker will process pending tracks on next poll cycle."
