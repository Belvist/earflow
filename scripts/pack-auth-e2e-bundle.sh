#!/usr/bin/env bash
# Pack PEND-SEC-001 files for scp to VPS (when remote has no commit yet).
# Usage: bash scripts/pack-auth-e2e-bundle.sh
#        scp dist/auth-e2e-bundle.tar.gz root@ru-vmv2-mini:/tmp/
#        ssh root@ru-vmv2-mini 'cd /opt/music-platform && tar -xzf /tmp/auth-e2e-bundle.tar.gz'
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="$ROOT/dist"
ARCHIVE="$OUT_DIR/auth-e2e-bundle.tar.gz"
mkdir -p "$OUT_DIR"

FILES=(
  docker-compose.auth-e2e.yml
  nginx/auth-e2e-edge.conf
  frontend/e2e/device-proof-fullstack.spec.js
  frontend/e2e/helpers/popFullStack.browser.js
  frontend/playwright.auth-fullstack.config.js
  scripts/run-auth-fullstack-e2e.sh
  scripts/auth-e2e-wait-healthy.sh
  scripts/auth-e2e-bootstrap.sh
  scripts/pack-auth-e2e-bundle.sh
  docs/AUTH_FULLSTACK_E2E_RUNBOOK.md
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
echo "On VPS:"
echo "  scp dist/auth-e2e-bundle.tar.gz root@HOST:/tmp/"
echo "  ssh root@HOST 'cd /opt/music-platform && tar -xzf /tmp/auth-e2e-bundle.tar.gz'"
echo "  bash scripts/run-auth-fullstack-e2e.sh"
