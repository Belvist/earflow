#!/usr/bin/env bash
# Wait until auth-e2e stack is ready (edge + gateway + auth).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="${AUTH_E2E_BASE_URL:-http://127.0.0.1:18080}"
MAX_WAIT="${AUTH_E2E_WAIT_SECONDS:-300}"
INTERVAL=5

deadline=$((SECONDS + MAX_WAIT))

echo "[auth-e2e-wait] base URL: $BASE (timeout ${MAX_WAIT}s)"

while (( SECONDS < deadline )); do
  if ! curl -sf "$BASE/health" >/dev/null 2>&1; then
    sleep "$INTERVAL"
    continue
  fi
  api_code="$(curl -sS -o /dev/null -w "%{http_code}" "$BASE/api/version" 2>/dev/null || echo "000")"
  if [[ "$api_code" == "502" || "$api_code" == "503" || "$api_code" == "504" || "$api_code" == "000" ]]; then
    echo "[auth-e2e-wait] edge /health OK but api-gateway via /api/version = HTTP $api_code — retry..." >&2
    sleep "$INTERVAL"
    continue
  fi
  if curl -sf -o /dev/null -w "%{http_code}" "$BASE/" | grep -qE '200|304'; then
    echo "[auth-e2e-wait] edge OK (api/version HTTP $api_code)"
    exit 0
  fi
  sleep "$INTERVAL"
done

echo "[auth-e2e-wait] TIMEOUT waiting for $BASE" >&2
exit 1
