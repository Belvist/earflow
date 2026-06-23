#!/usr/bin/env bash
# PEND-SEC-CAPACITY-001 — verify capacity artifacts exist (post-run gate).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ART="$ROOT/artifacts/auth-capacity"
failures=0

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }

echo "=== PEND-SEC-CAPACITY-001 verify ==="

for f in sessions.json k6-hot-summary.json cold-path-summary.json revoke-latency-summary.json; do
  if [[ -f "$ART/$f" ]]; then
    pass "$f present"
  else
    fail "$f missing (run scripts/run-auth-capacity.sh)"
  fi
done

if [[ -f "$ART/revoke-latency-summary.json" ]]; then
  if node -e "
    const j=require('$ART/revoke-latency-summary.json');
    process.exit(j.pass?0:1);
  "; then
    pass "revoke latency ≤2s"
  else
    fail "revoke latency >2s or timeout"
  fi
fi

report="$(ls -1 "$ROOT/reports"/auth-capacity-*.md 2>/dev/null | tail -1 || true)"
if [[ -n "$report" ]]; then
  pass "report $(basename "$report")"
else
  fail "reports/auth-capacity-*.md missing"
fi

if [[ "$failures" -eq 0 ]]; then
  echo ""
  echo "PEND-SEC-CAPACITY-001 verify: PASS"
  exit 0
fi
echo ""
echo "PEND-SEC-CAPACITY-001 verify: FAIL ($failures)"
exit 1
