#!/usr/bin/env bash
# PEND-AUTH-IOS-002 — stable auth error `code` through auth-service → gateway → iOS.
#
# Usage:
#   npm run verify:auth-error-codes
#
# Requires full backend/go-api-gateway checkout (go.mod + internal/config + cmd/).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATEWAY_DIR="$ROOT/backend/go-api-gateway"
AUTH_SERVICE_DIR="$ROOT/backend/auth-service"

failures=0
pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }
skip() { echo "SKIP  $*"; }
section() { echo ""; echo "=== $* ==="; }

section "PEND-AUTH-IOS-002 — auth error code contract"

section "auth-service (Node)"
if [[ -f "$AUTH_SERVICE_DIR/lib/authErrorCodes.test.js" ]]; then
  if (cd "$AUTH_SERVICE_DIR" && node --test lib/authErrorCodes.test.js); then
    pass "auth-service authErrorCodes.test.js"
  else
    fail "auth-service authErrorCodes.test.js"
  fi
else
  fail "auth-service tests missing ($AUTH_SERVICE_DIR/lib/authErrorCodes.test.js)"
fi

section "go-api-gateway (Go module)"
if ! command -v go >/dev/null 2>&1; then
  skip "go not installed — gateway unit tests"
elif [[ ! -f "$GATEWAY_DIR/go.mod" ]]; then
  fail "go.mod missing at $GATEWAY_DIR — restore full go-api-gateway checkout (not a test failure; module root absent)"
  echo "       Expected module root: backend/go-api-gateway (docker-compose build context)"
  echo "       After restore: cd backend/go-api-gateway && go test ./internal/auth -v"
elif [[ ! -f "$GATEWAY_DIR/internal/auth/auth_exchange_errors_test.go" ]]; then
  fail "gateway contract tests missing ($GATEWAY_DIR/internal/auth/auth_exchange_errors_test.go)"
else
  echo "Go module root: $GATEWAY_DIR"
  echo "Command: cd backend/go-api-gateway && go test ./internal/auth -run 'TestCopyUpstreamError|TestHandleEmail' -count=1 -v"
  if (cd "$GATEWAY_DIR" && go test ./internal/auth -run 'TestCopyUpstreamError|TestHandleEmail' -count=1 -v); then
    pass "gateway auth exchange error contract tests"
  else
    fail "gateway auth exchange error contract tests"
  fi
fi

section "Step-up codes (security-service → gateway JSON → clients)"
REQUIRED_STEP_UP_CODES=(FRESH_LOGIN_REQUIRED MFA_STEP_UP_REQUIRED)
for code in "${REQUIRED_STEP_UP_CODES[@]}"; do
  if grep -q "$code" "$ROOT/frontend/src/auth/mfaStepUp.js" 2>/dev/null; then
    pass "web mfaStepUp.js — $code"
  else
    fail "web mfaStepUp.js missing $code"
  fi
  ios_file="$ROOT/ios-app/Earflow/Core/Auth/AuthErrorCategory.swift"
  if [[ -f "$ios_file" ]] && grep -q "\"$code\"" "$ios_file"; then
    pass "iOS BackendAuthCode — $code"
  else
    fail "iOS BackendAuthCode missing $code"
  fi
done
helpers="$ROOT/backend/security-service/internal/httpapi/helpers_sessions.go"
if [[ -f "$helpers" ]] && grep -q 'FRESH_LOGIN_REQUIRED' "$helpers"; then
  pass "security-service emits FRESH_LOGIN_REQUIRED"
else
  fail "security-service helpers_sessions.go missing FRESH_LOGIN_REQUIRED (full checkout required)"
fi

section "iOS projection (Simulator)"
if [[ -f "$ROOT/scripts/verify-ios-native.sh" ]]; then
  if bash "$ROOT/scripts/verify-ios-native.sh" 2>&1 | tail -5 | grep -q 'PASS: ios-native'; then
    pass "ios-native verify (includes AuthErrorClassifierTests)"
  else
    fail "ios-native verify — run: npm run verify:ios-native"
  fi
else
  skip "verify-ios-native.sh missing"
fi

echo ""
if [[ "$failures" -gt 0 ]]; then
  echo "FAIL: verify-auth-error-codes ($failures failure(s))"
  exit 1
fi
echo "PASS: verify-auth-error-codes"
exit 0
