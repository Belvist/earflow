#!/usr/bin/env bash
# Pack PEND-SEC-CAPACITY-001 files for scp to VPS (when remote has no commit yet).
#
# Usage:
#   bash scripts/pack-auth-capacity-bundle.sh
#   scp dist/auth-capacity-bundle.tar.gz root@ru-vmv2-mini:/tmp/
#   ssh root@ru-vmv2-mini 'cd /opt/music-platform && tar -xzf /tmp/auth-capacity-bundle.tar.gz'
#   CAPACITY_GATEWAY_REPLICAS=2 bash scripts/run-auth-capacity.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="$ROOT/dist"
ARCHIVE="$OUT_DIR/auth-capacity-bundle.tar.gz"
mkdir -p "$OUT_DIR"

FILES=(
  scripts/run-auth-capacity.sh
  scripts/verify-auth-capacity.sh
  scripts/pack-auth-capacity-bundle.sh
  scripts/auth-capacity/lib/deviceProof.mjs
  scripts/auth-capacity/bootstrap-sessions.mjs
  scripts/auth-capacity/token-pool.mjs
  scripts/auth-capacity/hot-profile.k6.js
  scripts/auth-capacity/cold-path-load.mjs
  scripts/auth-capacity/revoke-latency.mjs
  scripts/auth-capacity/cleanup-sessions.mjs
)

MISSING=0
for f in "${FILES[@]}"; do
  if [[ ! -f "$ROOT/$f" ]]; then
    echo "MISSING locally: $f" >&2
    MISSING=1
  fi
done
if [[ "$MISSING" -ne 0 ]]; then
  exit 1
fi

tar -czf "$ARCHIVE" "${FILES[@]}"
echo "Created: $ARCHIVE"
echo ""
echo "On VPS (after restore-prod):"
echo "  scp dist/auth-capacity-bundle.tar.gz root@ru-vmv2-mini:/tmp/"
echo "  ssh root@ru-vmv2-mini 'cd /opt/music-platform && tar -xzf /tmp/auth-capacity-bundle.tar.gz'"
echo "  CAPACITY_GATEWAY_REPLICAS=2 bash scripts/run-auth-capacity.sh"
echo "  bash scripts/verify-auth-capacity.sh"
echo ""
echo "Note: capacity uses auth-e2e on http://127.0.0.1:18080 — NOT live prod users."
