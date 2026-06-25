#!/usr/bin/env bash
# SEC-003 — fresh-login browser/prod matrix gate (prepared ≠ closed).
#
# Static checks: backend guard + web/iOS projection (no client-side auth truth).
# CLOSED only when reports/evidence/SEC003-fresh-login.json documents browser proof.
#
# Usage:
#   npm run verify:sec003-fresh-login
#
# After manual browser matrix on prod (MFA user, session <24h):
#   cp reports/evidence/SEC003-fresh-login.template.json reports/evidence/SEC003-fresh-login.json
#   # fill sha, timestamp, network trace fields → set "closed": true

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EVIDENCE="$ROOT/reports/evidence/SEC003-fresh-login.json"

failures=0
pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }
skip() { echo "SKIP  $*"; }
section() { echo ""; echo "=== $* ==="; }

section "SEC-003 — static contract (prepared)"

HELPERS="$ROOT/backend/security-service/internal/httpapi/helpers_sessions.go"
if [[ -f "$HELPERS" ]] && grep -q 'FRESH_LOGIN_REQUIRED' "$HELPERS"; then
  pass "security-service fresh-login guard (helpers_sessions.go)"
else
  fail "FRESH_LOGIN_REQUIRED missing in security-service (restore full checkout)"
fi

if [[ -f "$ROOT/backend/security-service/internal/httpapi/helpers_sessions_fresh_login_test.go" ]]; then
  if command -v go >/dev/null 2>&1 && [[ -d "$ROOT/backend/security-service" ]]; then
    if (cd "$ROOT/backend/security-service" && go test ./internal/httpapi/ -run FreshLogin -count=1 >/dev/null 2>&1); then
      pass "security-service fresh-login unit tests"
    else
      fail "security-service fresh-login unit tests"
    fi
  else
    skip "go or security-service missing — unit tests not run"
  fi
else
  fail "helpers_sessions_fresh_login_test.go missing"
fi

if grep -q "FRESH_LOGIN_REQUIRED" "$ROOT/frontend/src/auth/mfaStepUp.js" 2>/dev/null \
  && grep -q "MFA_STEP_UP_REQUIRED" "$ROOT/frontend/src/auth/mfaStepUp.js" 2>/dev/null; then
  pass "web mfaStepUp.js recognizes step-up codes"
else
  fail "web mfaStepUp.js missing FRESH_LOGIN_REQUIRED / MFA_STEP_UP_REQUIRED"
fi

if [[ -f "$ROOT/frontend/src/components/Settings/SecuritySettingsSection.js" ]] \
  && grep -q 'revokeOtherAuthSessions' "$ROOT/frontend/src/components/Settings/SecuritySettingsSection.js" 2>/dev/null; then
  pass "web SecuritySettingsSection revoke-others UI"
else
  fail "web SecuritySettingsSection revoke-others missing"
fi

IOS_AUTH="$ROOT/ios-app/Earflow/Core/Auth/AuthErrorCategory.swift"
if [[ -f "$IOS_AUTH" ]] \
  && grep -q 'freshLoginRequired = "FRESH_LOGIN_REQUIRED"' "$IOS_AUTH" \
  && grep -q 'mfaStepUpRequired = "MFA_STEP_UP_REQUIRED"' "$IOS_AUTH" \
  && grep -q 'isStepUpRequired' "$IOS_AUTH"; then
  pass "iOS BackendAuthCode step-up codes + isStepUpRequired"
else
  fail "iOS BackendAuthCode missing FRESH_LOGIN_REQUIRED / MFA_STEP_UP_REQUIRED"
fi

section "SEC-003 — browser/prod matrix (required to close)"

cat <<'EOF'
Manual matrix (MFA-enabled user, current session age <24h):

  1. Fresh login → Profile → Security → «Завершить другие сессии»
  2. Network: POST /api/auth/sessions/revoke-others → 403
     JSON code: FRESH_LOGIN_REQUIRED (or MFA_STEP_UP_REQUIRED if policy differs)
  3. Step-up modal → POST /api/auth/2fa/step-up → 200
  4. Retry revoke-others → 200
  5. GET /api/profile → 200 (no silent logout)

Record in reports/evidence/SEC003-fresh-login.json:
  closed: true, sha, host, steps[].statusCode, steps[].code
EOF

browser_closed=false
if [[ -f "$EVIDENCE" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    if python3 - <<'PY' "$EVIDENCE"
import json, sys
path = sys.argv[1]
with open(path) as f:
    d = json.load(f)
if not d.get("closed"):
    sys.exit(1)
steps = d.get("steps") or []
need = {"revoke_others_blocked", "step_up", "revoke_others_retry"}
got = {s.get("id") for s in steps if s.get("pass")}
if not need.issubset(got):
    sys.exit(2)
for s in steps:
    if s.get("id") == "revoke_others_blocked" and s.get("code") not in (
        "FRESH_LOGIN_REQUIRED", "MFA_STEP_UP_REQUIRED"
    ):
        sys.exit(3)
sys.exit(0)
PY
    then
      browser_closed=true
      pass "browser evidence file valid ($EVIDENCE)"
    else
      fail "evidence file present but incomplete — fill template and set closed:true"
    fi
  else
    skip "python3 missing — cannot validate $EVIDENCE"
  fi
else
  fail "no browser evidence ($EVIDENCE) — prepared only, not CLOSED"
fi

section "Summary"
if [[ "$failures" -eq 0 && "$browser_closed" == "true" ]]; then
  echo ""
  echo "SEC-003 fresh-login: CLOSED"
  exit 0
fi

echo ""
if [[ "$failures" -eq 0 ]]; then
  echo "SEC-003 fresh-login: PREPARED (static OK, browser matrix OPEN)"
else
  echo "SEC-003 fresh-login: FAIL ($failures static failure(s))"
fi
exit 1
