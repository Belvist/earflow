#!/usr/bin/env bash
# Ensures critical monorepo paths exist (frontend + backend + ios-app).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REQUIRED=(
  "frontend/package.json"
  "ios-app/project.yml"
  "ios-app/Earflow/App/EarflowApp.swift"
  "backend/go-api-gateway/gateway.yaml"
  "backend/database-service/server.js"
  "backend/auth-service/server.js"
  "backend/device-sync-service"
  "backend/ebap-hls-adapter/src/main.ts"
  "artist-frontend/package.json"
  "docs/ARCHITECTURE_INVARIANTS.md"
  "docs/IOS_APP.md"
  "scripts/verify-ios-native.sh"
)

MISSING=0
for path in "${REQUIRED[@]}"; do
  if [[ ! -e "$path" ]]; then
    echo "MISSING: $path"
    MISSING=$((MISSING + 1))
  fi
done

BACKEND_COUNT="$(find backend -type f 2>/dev/null | wc -l | tr -d ' ')"
if [[ "${BACKEND_COUNT:-0}" -lt 100 ]]; then
  echo "FAIL: backend tree too small ($BACKEND_COUNT files) — restore from full monorepo"
  MISSING=$((MISSING + 1))
fi

if [[ "$MISSING" -gt 0 ]]; then
  echo "FAIL: monorepo integrity ($MISSING issue(s))"
  exit 1
fi

echo "OK: monorepo integrity (backend files=$BACKEND_COUNT)"
