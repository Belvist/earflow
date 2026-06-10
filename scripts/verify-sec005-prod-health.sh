#!/usr/bin/env bash
# SEC-005 prod health — correct gate for current rollout mode (norm vs Phase 6).
#
# Usage:
#   npm run verify:sec005-prod-health
#
# Exit 0 = healthy for current mode. Exit 1 = split-brain or gate failure.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck source=scripts/detect-sec005-prod-mode.sh
source "$ROOT/scripts/detect-sec005-prod-mode.sh"
detect_sec005_prod_mode "$ROOT"

echo ""
echo "=== SEC-005 prod health (mode: ${SEC005_PROD_MODE}) ==="
if [[ -n "${SEC005_SPLIT_REASON:-}" ]]; then
  echo "Reason: $SEC005_SPLIT_REASON"
fi
echo "gateway STREAM_TICKET_ENABLED='${SEC005_GW_ENABLED:-<unknown>}' mint_live=${SEC005_GW_MINT_LIVE:-unknown}"
echo "direct-stream ACCEPT='${SEC005_DS_ACCEPT:-<unknown>}' ebap-hls ACCEPT='${SEC005_HLS_ACCEPT:-<unknown>}'"
echo "bundle mint marker on earflow.ru: ${SEC005_BUNDLE_MINT:-unknown}"
echo ""

case "$SEC005_PROD_MODE" in
  phase6)
    echo "Phase 6 ACCEPT active — running verify-stream-ticket-phase6-prod.sh"
    exec bash "$ROOT/scripts/verify-stream-ticket-phase6-prod.sh"
    ;;
  norm)
    echo "Prod norm (stream tickets off) — running verify-stream-ticket.sh + ACCEPT off"
    failures=0
    bash "$ROOT/scripts/verify-stream-ticket.sh" || failures=$((failures + 1))
    bash "$ROOT/scripts/verify-stream-ticket-accept.sh" || failures=$((failures + 1))
    if [[ "$failures" -eq 0 ]]; then
      echo ""
      echo "SEC-005 PROD HEALTH: PASS (norm)"
      exit 0
    fi
    echo ""
    echo "SEC-005 PROD HEALTH: FAIL (norm, $failures gate(s))"
    exit 1
    ;;
  split)
    echo ""
    echo "SEC-005 PROD HEALTH: FAIL — split-brain deployment"
    echo ""
    echo "Fix (pick one):"
    echo "  Re-apply Phase 6:  SEC005_PHASE6_CONFIRM=1 npm run run:sec005-phase6-prod-accept"
    echo "  Rollback to norm:   SEC005_ROLLBACK_CONFIRM=1 npm run rollback:sec005-phase6-prod"
    echo ""
    echo "Do NOT run restore-prod-after-auth-e2e.sh during Phase 6 soak — it disables gateway mint"
    echo "while frontend may still request tickets (mint 404, broken playback)."
    exit 1
    ;;
  *)
    echo "SEC-005 PROD HEALTH: SKIP — docker/stack unavailable"
    exit 1
    ;;
esac
