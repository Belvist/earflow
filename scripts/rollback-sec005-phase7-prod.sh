#!/usr/bin/env bash
# SEC-005 Phase 7 rollback — return to Phase 6 dual-mode (ENFORCE off).
#
# Usage:
#   SEC005_PHASE7_ROLLBACK_CONFIRM=1 npm run rollback:sec005-phase7-prod

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "${SEC005_PHASE7_ROLLBACK_CONFIRM:-}" != "1" ]]; then
  echo "Refusing Phase 7 rollback without SEC005_PHASE7_ROLLBACK_CONFIRM=1" >&2
  exit 1
fi

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.stream-prod-accept.yml)

# shellcheck source=scripts/sec005-prod-overlay.sh
source "$ROOT/scripts/sec005-prod-overlay.sh"

echo "[rollback-phase7] switch overlay to Phase 6 accept"
sec005_prod_overlay_enable "$ROOT" accept

echo "[rollback-phase7] recreate stream services with ENFORCE=0"
"${COMPOSE[@]}" up -d --force-recreate direct-stream-service ebap-hls-adapter nginx

sleep 10

bash "$ROOT/scripts/verify-stream-ticket-phase6-prod.sh"

echo "[rollback-phase7] done — Phase 6 dual-mode restored"
