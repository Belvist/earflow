#!/usr/bin/env bash
# Full auth + SEC-005 security replay — run before accepting Phase 3 checklist.
#
# Default (prod-safe): automated prod gates only — does NOT enable e2e overlay.
#
# Full cycle on VPS (e2e mint + optional browser DoD + mandatory restore):
#   FULL_E2E=1 bash scripts/verify-auth-security-replay.sh
#
# Browser DoD only (requires auth-e2e stack):
#   RUN_BROWSER_DOD=1 bash scripts/verify-auth-security-replay.sh
#
# Exit 0 = all requested gates PASS.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FULL_E2E="${FULL_E2E:-0}"
RUN_BROWSER_DOD="${RUN_BROWSER_DOD:-0}"
SKIP_VALIDATE_AI="${SKIP_VALIDATE_AI:-}"
failures=0

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }
section() { echo ""; echo "=== $* ==="; }

run_step() {
  local name="$1"
  shift
  section "$name"
  if "$@"; then
    pass "$name"
  else
    fail "$name (exit $?)"
  fi
}

should_skip_validate_ai() {
  if [[ "$SKIP_VALIDATE_AI" == "1" ]]; then
    return 0
  fi
  if [[ ! -f "$ROOT/AGENTS.md" ]]; then
    return 0
  fi
  return 1
}

section "Auth security replay — git"
if git rev-parse --short HEAD >/dev/null 2>&1; then
  echo "SHA: $(git rev-parse HEAD) ($(git rev-parse --short HEAD))"
  pass "git SHA recorded"
else
  fail "not a git repo"
fi

section "Layer A — prod gates (always)"
if should_skip_validate_ai; then
  echo "SKIP  validate:ai — VPS slim deploy (AGENTS.md / .cursor not in checkout; CI/dev only)"
  echo "      Force run: SKIP_VALIDATE_AI=0 npm run validate:ai on full git clone"
  pass "validate:ai skipped (VPS norm)"
else
  run_step "validate:ai" npm run validate:ai
fi
run_step "verify:frontend-api-base" bash "$ROOT/scripts/verify-frontend-api-base.sh"
run_step "verify:stream-ticket (prod off)" bash "$ROOT/scripts/verify-stream-ticket.sh"
run_step "verify-auth-proof-token (infra)" bash "$ROOT/scripts/verify-auth-proof-token.sh"
run_step "verify:prod-auth-gate" bash "$ROOT/scripts/verify-prod-auth-gate.sh"

section "Layer A — prod env sanity"
if command -v docker >/dev/null 2>&1; then
  stream_en="$(docker compose -f docker-compose.yml exec -T api-gateway printenv STREAM_TICKET_ENABLED 2>/dev/null | tr -d '\r' || true)"
  stream_obs="$(docker compose -f docker-compose.yml exec -T api-gateway printenv STREAM_TICKET_OBSERVE 2>/dev/null | tr -d '\r' || true)"
  api_base="$(docker compose -f docker-compose.yml exec -T frontend printenv EARFLOW_API_BASE_URL 2>/dev/null | tr -d '\r' || true)"
  cookie_dom="$(docker compose -f docker-compose.yml exec -T api-gateway printenv COOKIE_DOMAIN 2>/dev/null | tr -d '\r' || true)"

  if [[ -z "$stream_en" || "$stream_en" == "0" || "$stream_en" == "false" ]]; then
    pass "STREAM_TICKET_ENABLED off ('${stream_en:-<empty>}')"
  else
    fail "STREAM_TICKET_ENABLED still on: $stream_en — run restore-prod-after-auth-e2e.sh"
  fi

  if [[ -z "$stream_obs" || "$stream_obs" == "0" || "$stream_obs" == "false" ]]; then
    pass "STREAM_TICKET_OBSERVE off ('${stream_obs:-<empty>}')"
  else
    fail "STREAM_TICKET_OBSERVE still on: $stream_obs"
  fi

  if [[ -z "$api_base" || "$api_base" != *127.0.0.1* ]]; then
    pass "frontend EARFLOW_API_BASE_URL ok ('${api_base:-<empty>}')"
  else
    fail "frontend still on e2e API base: $api_base"
  fi

  if [[ "$cookie_dom" == ".earflow.ru" || "$cookie_dom" == "host" ]]; then
    pass "COOKIE_DOMAIN='$cookie_dom'"
  elif [[ -z "$cookie_dom" ]]; then
    fail "COOKIE_DOMAIN empty on prod stack"
  else
    fail "unexpected COOKIE_DOMAIN='$cookie_dom'"
  fi

  log_lines="$(docker compose -f docker-compose.yml logs api-gateway --tail=200 2>/dev/null | grep -i stream_ticket_mint || true)"
  if [[ -z "$log_lines" ]]; then
    pass "no stream_ticket_mint in recent prod api-gateway logs (mint off — expected)"
  else
    if echo "$log_lines" | grep -qE '"ticket"|eyJ[A-Za-z0-9_-]+\.'; then
      fail "stream_ticket_mint logs may contain ticket/JWT — review manually"
      echo "$log_lines" | head -5
    else
      pass "stream_ticket_mint present but no obvious ticket body in sample"
      echo "$log_lines" | head -3
    fi
  fi
else
  echo "SKIP  docker not available — run env checks on VPS"
fi

if [[ "$FULL_E2E" == "1" ]]; then
  section "Layer B — auth-e2e overlay (FULL_E2E=1)"
  # shellcheck source=scripts/auth-e2e-export-env.sh
  source "$ROOT/scripts/auth-e2e-export-env.sh"
  auth_e2e_export_defaults "$ROOT"
  echo "AUTH_E2E_EMAIL=$AUTH_E2E_EMAIL"
  echo "Starting auth-e2e stack (STREAM_TICKET_ENABLED=1 from overlay)…"

  if auth_e2e_compose_up "$ROOT" \
    postgres redis redis-auth database-service auth-service security-service \
    api-gateway frontend direct-stream-service ebap-hls-adapter auth-e2e-edge; then
    pass "auth-e2e compose up (incl. stream services for Phase 3 ACCEPT)"
  else
    fail "auth-e2e compose up"
  fi

  if bash "$ROOT/scripts/auth-e2e-wait-healthy.sh"; then
    pass "auth-e2e-wait-healthy"
  else
    fail "auth-e2e-wait-healthy"
  fi

  if bash "$ROOT/scripts/auth-e2e-bootstrap.sh"; then
    pass "auth-e2e-bootstrap"
  else
    fail "auth-e2e-bootstrap"
  fi

  run_step "verify:stream-ticket (e2e mint)" bash "$ROOT/scripts/verify-stream-ticket.sh"
  run_step "verify:stream-ticket-accept (e2e consume)" bash "$ROOT/scripts/verify-stream-ticket-accept.sh"

  section "Layer B — e2e log leakage sample"
  e2e_logs="$(docker compose -f docker-compose.yml -f docker-compose.auth-e2e.yml logs api-gateway --tail=100 2>/dev/null | grep stream_ticket_mint || true)"
  if [[ -n "$e2e_logs" ]]; then
    if echo "$e2e_logs" | grep -qE '"ticket"|eyJ[A-Za-z0-9_-]{20,}'; then
      fail "e2e stream_ticket_mint may leak ticket — CRITICAL before Phase 3"
      echo "$e2e_logs" | head -5
    else
      pass "e2e stream_ticket_mint metadata only (sample)"
      echo "$e2e_logs" | head -3
    fi
  else
    echo "WARN  no stream_ticket_mint lines — mint may not have run OBSERVE or logs rotated"
  fi

  section "Layer B — mandatory restore prod"
  if bash "$ROOT/scripts/restore-prod-after-auth-e2e.sh"; then
    pass "restore-prod-after-auth-e2e.sh"
  else
    fail "restore-prod-after-auth-e2e.sh — prod may be in e2e state"
  fi
fi

if [[ "$RUN_BROWSER_DOD" == "1" ]]; then
  section "Layer C — SEC-013 browser DoD 8/8"
  if bash "$ROOT/scripts/run-auth-proof-token-browser-dod.sh"; then
    pass "browser DoD 8/8"
  else
    fail "browser DoD — see artifacts/auth-proof-token-dod"
  fi
  if [[ "$FULL_E2E" != "1" ]]; then
    section "Layer C — restore after browser DoD"
    bash "$ROOT/scripts/restore-prod-after-auth-e2e.sh" || fail "restore after browser DoD"
  fi
fi

section "Layer D — manual (not automated)"
cat <<'EOF'
| # | Check | Command / action |
|---|-------|------------------|
| 1 | Login + play track (HLS) | earflow.ru — 30s playback |
| 2 | Login + direct stream | seek works |
| 3 | Account → revoke others | 403 MFA_STEP_UP or success (not silent break) |
| 4 | DevTools profile hot GET | X-Auth-Proof-Access-Token present |
| 5 | POST stream-ticket on prod | 404 (curl api.earflow.ru) |

Optional capacity replay:
  bash scripts/run-auth-capacity.sh && bash scripts/verify-auth-capacity.sh
  bash scripts/restore-prod-after-auth-e2e.sh
EOF

section "Summary"
echo ""
if [[ "$failures" -eq 0 ]]; then
  echo "AUTH SECURITY REPLAY: PASS"
  echo "Phase 3 ACCEPT: close when FULL_E2E verify:stream-ticket-accept PASS + restore-prod + playback smoke"
  exit 0
fi

# Prod-only false fail: validate:ai on VPS slim checkout is not a security regression
if should_skip_validate_ai && [[ "$FULL_E2E" != "1" ]]; then
  echo "NOTE: If only validate:ai failed — prod security gates above may still be PASS."
  echo "      Re-run after git pull; validate:ai auto-skips on VPS without AGENTS.md."
fi

echo "AUTH SECURITY REPLAY: FAIL ($failures failure(s))"
echo "Fix failures before accepting Phase 3 or declaring auth green."
exit 1
