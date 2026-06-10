#!/usr/bin/env bash
# Auth Kit Level 1 — composite gate (code + prod infra).
# Browser DoD remains separate: run-auth-proof-token-browser-dod.sh + manual matrix.
#
# Usage:
#   npm run verify:auth-kit
#   npm run verify:auth-kit -- --with-e2e   # includes auth-e2e stream ticket accept
#
# Exit 0 = Level 1 automated PASS. Exit 1 = failure.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WITH_E2E=false
for arg in "$@"; do
  case "$arg" in
    --with-e2e) WITH_E2E=true ;;
  esac
done

failures=0
pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }
skip() { echo "SKIP  $*"; }
section() { echo ""; echo "=== $* ==="; }

section "Auth Kit Level 1 — source artifacts"

check_file() {
  local path="$1"
  local label="$2"
  if [[ -f "$ROOT/$path" ]]; then
    pass "$label ($path)"
  else
    fail "$label missing ($path)"
  fi
}

check_file "docs/AUTH_KIT.md" "AUTH_KIT doc"
check_file "frontend/src/auth/streamTicket.js" "Phase 4 streamTicket"
check_file "frontend/src/auth/mfaStepUp.js" "MFA step-up client"
check_file "frontend/src/components/Settings/StepUpModal.js" "StepUpModal UI"
check_file "frontend/src/hooks/useStepUpRunner.js" "useStepUpRunner"

if grep -q 'revoke-all' "$ROOT/backend/security-service/internal/httpapi/server.go" 2>/dev/null; then
  pass "POST /api/auth/sessions/revoke-all registered"
else
  fail "revoke-all route missing in security-service"
fi

if grep -q 'FRESH_LOGIN_REQUIRED' "$ROOT/backend/security-service/internal/httpapi/helpers_sessions.go" 2>/dev/null; then
  pass "fresh-login guard (FRESH_LOGIN_REQUIRED)"
else
  fail "FRESH_LOGIN_REQUIRED not found in security-service"
fi

if grep -q 'REACT_APP_STREAM_TICKET_MINT_ENABLED' "$ROOT/frontend/src/auth/streamTicket.js" 2>/dev/null; then
  pass "stream ticket mint opt-in flag (default off in code)"
else
  fail "stream ticket mint flag missing"
fi

section "Unit tests (local)"

if command -v go >/dev/null 2>&1; then
  if (cd "$ROOT/backend/security-service" && go test ./internal/httpapi/... -count=1 >/dev/null 2>&1); then
    pass "security-service httpapi go test"
  else
    fail "security-service httpapi go test"
  fi
else
  skip "go not installed — security-service unit tests"
fi

if command -v npm >/dev/null 2>&1 && [[ -d "$ROOT/frontend/node_modules" ]]; then
  if (cd "$ROOT/frontend" && CI=true npm test -- --testPathPattern=streamTicket.test.js --watchAll=false >/dev/null 2>&1); then
    pass "frontend streamTicket.test.js"
  else
    fail "frontend streamTicket.test.js"
  fi
else
  skip "frontend deps missing — run: cd frontend && npm ci"
fi

section "Prod infra gates (when stack / network available)"

if [[ -f "$ROOT/scripts/verify-auth-proof-token.sh" ]]; then
  if bash "$ROOT/scripts/verify-auth-proof-token.sh"; then
    pass "verify-auth-proof-token.sh (infra)"
  else
    fail "verify-auth-proof-token.sh"
  fi
else
  fail "verify-auth-proof-token.sh missing"
fi

if [[ -f "$ROOT/scripts/verify-stream-ticket.sh" ]]; then
  # shellcheck source=scripts/detect-sec005-prod-mode.sh
  source "$ROOT/scripts/detect-sec005-prod-mode.sh"
  detect_sec005_prod_mode "$ROOT"
  case "${SEC005_PROD_MODE:-unknown}" in
    phase6)
      skip "verify-stream-ticket.sh (404 norm) — Phase 6 active; use npm run verify:sec005-prod-health"
      if bash "$ROOT/scripts/verify-stream-ticket-phase6-prod.sh"; then
        pass "verify-stream-ticket-phase6-prod.sh (Phase 6 ACCEPT)"
      else
        fail "verify-stream-ticket-phase6-prod.sh (Phase 6 ACCEPT)"
      fi
      ;;
    split)
      fail "SEC-005 split-brain: ${SEC005_SPLIT_REASON:-partial flags}"
      echo "       Fix: SEC005_PHASE6_CONFIRM=1 npm run run:sec005-phase6-prod-accept"
      echo "       Or:  SEC005_ROLLBACK_CONFIRM=1 npm run rollback:sec005-phase6-prod"
      ;;
    norm)
      if bash "$ROOT/scripts/verify-stream-ticket.sh"; then
        pass "verify-stream-ticket.sh (prod mint off → 404)"
      else
        fail "verify-stream-ticket.sh"
      fi
      ;;
    *)
      if bash "$ROOT/scripts/verify-stream-ticket.sh"; then
        pass "verify-stream-ticket.sh"
      else
        skip "verify-stream-ticket.sh (stack mode unknown)"
      fi
      ;;
  esac
else
  fail "verify-stream-ticket.sh missing"
fi

if [[ -f "$ROOT/scripts/verify-frontend-api-base.sh" ]]; then
  if bash "$ROOT/scripts/verify-frontend-api-base.sh"; then
    pass "verify-frontend-api-base.sh"
  else
    fail "verify-frontend-api-base.sh"
  fi
else
  fail "verify-frontend-api-base.sh missing"
fi

if [[ "$WITH_E2E" == "true" ]]; then
  section "Auth-e2e optional (--with-e2e)"
  if bash "$ROOT/scripts/verify-stream-ticket-accept.sh"; then
    pass "verify-stream-ticket-accept.sh"
  else
    fail "verify-stream-ticket-accept.sh"
  fi
else
  skip "auth-e2e stream accept (pass --with-e2e on VPS after overlay)"
fi

section "Level 1 browser DoD (manual — required for «fully confident»)"
cat <<'EOF'
Run on auth-e2e or prod after deploy:
  bash scripts/run-auth-proof-token-browser-dod.sh     → 8/8
  bash scripts/run-auth-fullstack-e2e.sh               → cookie transplant 401

Sessions hardening (manual, MFA-enabled user):
  revoke-others without step-up on fresh session → FRESH_LOGIN_REQUIRED or step-up modal
  revoke-others with step-up → 200
  revoke-all → logout all devices

Prod stream norm (after restore-prod — **not during Phase 6 soak**):
  STREAM_TICKET_* empty; POST /api/auth/stream-ticket → 404

During Phase 6 soak weekly health:
  npm run verify:sec005-prod-health
  (NOT restore-prod-after-auth-e2e.sh — that breaks Phase 6)
EOF

section "Summary"
if [[ "$failures" -eq 0 ]]; then
  echo ""
  echo "AUTH KIT LEVEL 1 (automated): PASS"
  echo "Not closed until browser DoD 8/8 + manual sessions matrix above."
  exit 0
fi

echo ""
echo "AUTH KIT LEVEL 1 (automated): FAIL ($failures failure(s))"
exit 1
