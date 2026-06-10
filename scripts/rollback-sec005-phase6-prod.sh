#!/usr/bin/env bash
# SEC-005 Phase 6 rollback — restore prod norm (mint off, STREAM_TICKET_* off).
#
# Usage (VPS):
#   cd /opt/music-platform
#   SEC005_ROLLBACK_CONFIRM=1 npm run rollback:sec005-phase6-prod
#
# Same outcome as restore-prod-after-auth-e2e.sh (rebuilds frontend mint:0).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "${SEC005_ROLLBACK_CONFIRM:-}" != "1" ]]; then
  echo "Refusing Phase 6 rollback without SEC005_ROLLBACK_CONFIRM=1" >&2
  exit 1
fi

# shellcheck source=scripts/sec005-phase6-overlay.sh
source "$ROOT/scripts/sec005-phase6-overlay.sh"
sec005_phase6_overlay_disable "$ROOT" || true

echo "[rollback-phase6] restoring prod norm via restore-prod-after-auth-e2e.sh"
RESTORE_PROD_CONFIRM=1 bash "$ROOT/scripts/restore-prod-after-auth-e2e.sh"
echo "[rollback-phase6] done — STREAM_TICKET_ENABLED off, ACCEPT off, frontend mint:0"
