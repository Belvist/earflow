#!/usr/bin/env bash
# Wave B + Phase 8 — prod deploy after git pull (listener auth hardening + WS tickets).
#
# Usage (VPS):
#   cd /opt/music-platform
#   git pull origin main
#   bash scripts/run-auth-wave-b-prod-deploy.sh
#
# Does NOT change SEC-005 phase (Phase 6/7 overlay stays). Rebuilds services with new code.
# Exit 0 = containers up + verify:auth-kit PASS.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[wave-b-deploy] rebuild api-gateway security-service device-sync-service frontend"
docker compose build --no-cache api-gateway security-service device-sync-service frontend
docker compose up -d api-gateway security-service device-sync-service frontend

echo "[wave-b-deploy] wait for health (30s)"
sleep 30

echo "[wave-b-deploy] verify auth-kit + sec005 health"
npm run verify:auth-kit
npm run verify:sec005-prod-health

echo "[wave-b-deploy] done — manual: Profile → Сеансы (devices, password, telegram); playback 30s on earflow.ru"
