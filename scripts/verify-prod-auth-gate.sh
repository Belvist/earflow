#!/usr/bin/env bash
# Hard gate before declaring "prod auth green".
# Server-side checks only; browser matrix is manual (printed at end).
#
# Usage (from laptop against prod):
#   bash scripts/verify-prod-auth-gate.sh
#
# Usage (on VPS, nginx on localhost:8443):
#   API_BASE=https://127.0.0.1:8443 CURL_INSECURE=1 bash scripts/verify-prod-auth-gate.sh
#
# Optional: pin expected frontend bundle after deploy:
#   EXPECTED_MAIN_JS=main.abc12345.js bash scripts/verify-prod-auth-gate.sh
#
# Exit 0 = all automated checks passed. Exit 1 = failure.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LISTENER_ORIGIN="${LISTENER_ORIGIN:-https://earflow.ru}"
AUTH_UI_ORIGIN="${AUTH_UI_ORIGIN:-https://auth.earflow.ru}"
EXPECTED_MAIN_JS="${EXPECTED_MAIN_JS:-}"

failures=0
checks=0

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }
section() { echo ""; echo "=== $* ==="; }

git_sha() {
  if git -C "$ROOT" rev-parse --short HEAD >/dev/null 2>&1; then
    git -C "$ROOT" rev-parse HEAD
    git -C "$ROOT" rev-parse --short HEAD
  else
    echo "unknown (not a git repo or no commits)"
    echo "unknown"
  fi
}

extract_main_js() {
  local url="$1"
  curl -sS --max-time 20 "$url" 2>/dev/null | grep -oE 'main\.[a-f0-9]+\.js' | head -1 || true
}

section "Git source of truth"
FULL_SHA="$(git_sha | sed -n '1p')"
SHORT_SHA="$(git_sha | sed -n '2p')"
echo "SHA (full):  $FULL_SHA"
echo "SHA (short): $SHORT_SHA"
if [[ "$FULL_SHA" == unknown* ]]; then
  fail "git SHA unavailable — deploy from rsync/manual copy is not acceptable for prod auth green"
else
  pass "git SHA recorded ($SHORT_SHA)"
fi
checks=$((checks + 1))

section "Frontend bundle (index.html → main.*.js)"
for label origin in "earflow.ru" "$LISTENER_ORIGIN" "auth.earflow.ru" "$AUTH_UI_ORIGIN"; do
  [[ "$label" == http* ]] && continue
  main_js="$(extract_main_js "$origin/")"
  checks=$((checks + 1))
  if [[ -z "$main_js" ]]; then
    fail "$label — could not find main.*.js in index HTML"
    continue
  fi
  echo "      $label → $main_js"
  if [[ -n "$EXPECTED_MAIN_JS" && "$main_js" != "$EXPECTED_MAIN_JS" ]]; then
    fail "$label — expected $EXPECTED_MAIN_JS got $main_js"
  else
    pass "$label bundle $main_js"
  fi
done

LISTENER_MAIN="$(extract_main_js "${LISTENER_ORIGIN}/")"
AUTH_MAIN="$(extract_main_js "${AUTH_UI_ORIGIN}/")"
if [[ -n "$LISTENER_MAIN" && -n "$AUTH_MAIN" && "$LISTENER_MAIN" != "$AUTH_MAIN" ]]; then
  fail "listener vs auth bundle mismatch: $LISTENER_MAIN vs $AUTH_MAIN"
else
  [[ -n "$LISTENER_MAIN" && -n "$AUTH_MAIN" ]] && pass "earflow.ru and auth.earflow.ru serve same main bundle"
fi

section "Nginx config (optional — run on VPS with docker)"
if command -v docker >/dev/null 2>&1; then
  if docker compose -f "$ROOT/docker-compose.yml" run --rm --no-deps nginx nginx -t >/dev/null 2>&1; then
    pass "docker compose nginx -t"
  else
    fail "docker compose nginx -t (run on VPS: docker compose run --rm --no-deps nginx nginx -t)"
  fi
else
  echo "SKIP  docker not available — run nginx -t on VPS manually"
fi

section "CORS / PoP preflight matrix"
if [[ -x "$ROOT/scripts/verify-cors-pop-preflight.sh" ]] || [[ -f "$ROOT/scripts/verify-cors-pop-preflight.sh" ]]; then
  if bash "$ROOT/scripts/verify-cors-pop-preflight.sh"; then
    pass "verify-cors-pop-preflight.sh"
  else
    fail "verify-cors-pop-preflight.sh — see output above"
  fi
else
  fail "missing scripts/verify-cors-pop-preflight.sh"
fi

section "Summary"
if [[ "$failures" -eq 0 ]]; then
  echo ""
  echo "AUTOMATED GATE: PASS (SHA $SHORT_SHA)"
else
  echo ""
  echo "AUTOMATED GATE: FAIL ($failures failure(s))"
fi

section "MANUAL browser gate (required — not automated here)"
cat <<'EOF'
Hard reload (Ctrl+Shift+R) after clearing site data / unregister SW if needed.

| Step | Expect |
|------|--------|
| login | session cookies set |
| POST /api/auth/device/register | 200 |
| POST /api/auth/refresh | 204 (or 200) |
| GET /api/profile | 200 |
| GET /api/artists/Charli%20XCX/meta | 200 |
| GET /api/artists/A%24AP%20Rocky/meta | 200 |
| GET /api/artists/<unicode>/meta | 200 |
| GET /api/artists/.../tracks?limit=200&offset=0 | 200 |
| Account tab | no redirect to auth |
| POST /api/stream/v3/session | no CORS block |
| POST /api/ebap-hls/v1/session | no CORS block |
| Stale PoP recovery | 401 DEVICE_PROOF_INVALID → register 200 → retry GET 200 |
| Revoke one other session | 200; current profile still 200 |
| Revoke others | 200 OR MFA_STEP_UP_REQUIRED (not silent logout) |

FAIL signals (do not declare green):
- red ErrorBoundary screen
- 401 → 401 without device/register between
- infinite DEVICE_PROOF_INVALID retries
- unexpected redirect to auth.earflow.ru on Account

If ErrorBoundary: window.__EARFLOW_LAST_RENDER_ERROR__ in DevTools console.
EOF

echo ""
if [[ "$failures" -gt 0 ]]; then
  echo "status=prod_auth_not_green (automated checks failed)"
  exit 1
fi
echo "status=automated_ok — complete MANUAL browser gate before prod_auth_green"
exit 0
