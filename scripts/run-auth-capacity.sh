#!/usr/bin/env bash
# PEND-SEC-CAPACITY-001 — auth capacity report runner (staging/VPS only, NOT prod users).
#
# Usage:
#   bash scripts/run-auth-capacity.sh
#
# Fast re-run (stack already up):
#   CAPACITY_SKIP_STACK=1 bash scripts/run-auth-capacity.sh
#
# Artifacts: artifacts/auth-capacity/
# Report:     reports/auth-capacity-YYYYMMDD.md
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export CAPACITY_BASE_URL="${CAPACITY_BASE_URL:-http://127.0.0.1:18080}"
export CAPACITY_ORIGIN="${CAPACITY_ORIGIN:-$CAPACITY_BASE_URL}"
export CAPACITY_HOST_PORT="${CAPACITY_HOST_PORT:-18080}"
export CAPACITY_EMAIL="${CAPACITY_EMAIL:-${AUTH_E2E_EMAIL:-pop-e2e@earflow.test}}"
export CAPACITY_PASSWORD="${CAPACITY_PASSWORD:-${AUTH_E2E_PASSWORD:-PopE2eTest1}}"
export CAPACITY_SESSION_COUNT="${CAPACITY_SESSION_COUNT:-20}"
export CAPACITY_HOT_VUS="${CAPACITY_HOT_VUS:-50}"
export CAPACITY_HOT_RPS="${CAPACITY_HOT_RPS:-500}"
export CAPACITY_HOT_DURATION="${CAPACITY_HOT_DURATION:-60s}"
export CAPACITY_HOT_P95_MS="${CAPACITY_HOT_P95_MS:-50}"
export CAPACITY_HOT_ERROR_RATE="${CAPACITY_HOT_ERROR_RATE:-0.001}"
export CAPACITY_RATE_LIMIT_MULTIPLIER="${CAPACITY_RATE_LIMIT_MULTIPLIER:-50}"
export CAPACITY_LOAD_TEST_MODE="${CAPACITY_LOAD_TEST_MODE:-true}"
export CAPACITY_TOKEN_POOL_PORT="${CAPACITY_TOKEN_POOL_PORT:-19876}"
export CAPACITY_TOKEN_POOL_URL="http://127.0.0.1:${CAPACITY_TOKEN_POOL_PORT}"
export CAPACITY_ARTIFACT_DIR="$ROOT/artifacts/auth-capacity"
export CAPACITY_SESSIONS_FILE="$CAPACITY_ARTIFACT_DIR/sessions.json"
export CAPACITY_K6_SUMMARY="$CAPACITY_ARTIFACT_DIR/k6-hot-summary.json"
export CAPACITY_COLD_SUMMARY="$CAPACITY_ARTIFACT_DIR/cold-path-summary.json"
export CAPACITY_REVOKE_SUMMARY="$CAPACITY_ARTIFACT_DIR/revoke-latency-summary.json"
export AUTH_E2E_BASE_URL="$CAPACITY_BASE_URL"
export AUTH_E2E_ORIGIN="$CAPACITY_ORIGIN"
export AUTH_E2E_HOST_PORT="$CAPACITY_HOST_PORT"
export AUTH_E2E_EMAIL="$CAPACITY_EMAIL"
export AUTH_E2E_PASSWORD="$CAPACITY_PASSWORD"
export AUTH_E2E_ALLOWED_ORIGINS="${AUTH_E2E_ALLOWED_ORIGINS:-http://127.0.0.1:${CAPACITY_HOST_PORT},http://localhost:${CAPACITY_HOST_PORT},http://auth-e2e-edge:8080}"
export AUTH_E2E_COOKIE_DOMAIN="host"
export AUTH_E2E_COOKIE_SECURE="false"
export AUTH_E2E_COOKIE_SAMESITE="Lax"

# shellcheck source=scripts/auth-e2e-ensure-origins.sh
source "$ROOT/scripts/auth-e2e-ensure-origins.sh"
auth_e2e_ensure_docker_origin

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.auth-e2e.yml)
GATEWAY_REPLICAS="${CAPACITY_GATEWAY_REPLICAS:-1}"
ARTIFACT_DIR="$CAPACITY_ARTIFACT_DIR"
REPORT_DIR="$ROOT/reports"
REPORT_FILE="$REPORT_DIR/auth-capacity-$(date -u +%Y%m%d).md"
STATS_FILE="$ARTIFACT_DIR/docker-stats.txt"
GIT_SHA="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
TOKEN_POOL_PID=""
failures=0

mkdir -p "$ARTIFACT_DIR" "$REPORT_DIR"

capture_docker_stats() {
  local label="$1"
  if ! command -v docker >/dev/null 2>&1; then
    return 0
  fi
  {
    echo "=== docker stats ($label) $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
    docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}' \
      $(docker ps --format '{{.Names}}' | grep -E 'api-gateway|redis|postgres|security-service' || true) 2>/dev/null || true
    echo ""
  } >>"$STATS_FILE"
}

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }
abort() { echo "ABORT $*"; exit 1; }

cleanup() {
  if [[ -n "$TOKEN_POOL_PID" ]] && kill -0 "$TOKEN_POOL_PID" 2>/dev/null; then
    kill "$TOKEN_POOL_PID" 2>/dev/null || true
    wait "$TOKEN_POOL_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

require_node() {
  if ! command -v node >/dev/null 2>&1; then
    abort "node required (Node 18+)"
  fi
  local major
  major="$(node -p "process.versions.node.split('.')[0]")"
  if [[ "$major" -lt 18 ]]; then
    abort "Node >=18 required for Web Crypto (got $(node -v)); install Node 22 LTS"
  fi
  if [[ "$major" -lt 22 ]]; then
    echo "WARN: Node >=22 recommended (got $(node -v))" >&2
  fi
}

run_k6() {
  local script="$1"
  if command -v k6 >/dev/null 2>&1; then
    k6 run "$script"
    return
  fi
  if command -v docker >/dev/null 2>&1; then
    docker run --rm --network host \
      -v "$ROOT/scripts/auth-capacity:/scripts:ro" \
      -v "$ARTIFACT_DIR:/artifacts" \
      -e CAPACITY_BASE_URL -e CAPACITY_ORIGIN -e CAPACITY_TOKEN_POOL_URL \
      -e CAPACITY_HOT_VUS -e CAPACITY_HOT_RPS -e CAPACITY_HOT_DURATION \
      -e CAPACITY_HOT_P95_MS -e CAPACITY_HOT_ERROR_RATE -e CAPACITY_SESSION_COUNT \
      -e CAPACITY_K6_SUMMARY=/artifacts/k6-hot-summary.json \
      grafana/k6:0.54.0 run "/scripts/$(basename "$script")"
    return
  fi
  echo "FAIL: k6 or docker required for hot path load" >&2
  exit 1
}

if [[ "${CAPACITY_ALLOW_PROD:-0}" != "1" ]]; then
  case "$CAPACITY_BASE_URL" in
    *earflow.ru*) echo "REFUSE: set CAPACITY_BASE_URL to staging/127.0.0.1, not prod users domain" >&2; exit 1 ;;
  esac
fi

require_node

echo "=== PEND-SEC-CAPACITY-001 auth capacity runner ==="
echo "      git=${GIT_SHA}"
echo "      base=${CAPACITY_BASE_URL} sessions=${CAPACITY_SESSION_COUNT} hot_rps=${CAPACITY_HOT_RPS}"

echo "=== [0/9] Preflight ==="
if [[ "${CAPACITY_ALLOW_PROD:-0}" == "1" ]]; then
  echo "WARN  CAPACITY_ALLOW_PROD=1 — load against prod-like URL is explicit override"
else
  pass "CAPACITY_ALLOW_PROD not set"
fi
case "$CAPACITY_BASE_URL" in
  http://127.0.0.1:*|http://localhost:*) pass "staging URL ${CAPACITY_BASE_URL}" ;;
  *) fail "unexpected CAPACITY_BASE_URL=${CAPACITY_BASE_URL} (use auth-e2e 127.0.0.1)" ;;
esac
if [[ "$CAPACITY_EMAIL" == *"@earflow.test" || "$CAPACITY_EMAIL" == *"e2e"* ]]; then
  pass "isolated test account ${CAPACITY_EMAIL}"
else
  fail "CAPACITY_EMAIL should be isolated test account (got ${CAPACITY_EMAIL})"
fi
: >"$STATS_FILE"

echo "=== [1/9] Start auth-e2e stack (gateway replicas=${GATEWAY_REPLICAS}) ==="
if [[ "${CAPACITY_SKIP_STACK:-0}" == "1" ]]; then
  echo "      (skip full stack — CAPACITY_SKIP_STACK=1)"
  echo "      recreate api-gateway with CAPACITY_LOAD_TEST_MODE=${CAPACITY_LOAD_TEST_MODE} multiplier=${CAPACITY_RATE_LIMIT_MULTIPLIER}"
  "${COMPOSE[@]}" up -d --no-deps --force-recreate --scale "api-gateway=${GATEWAY_REPLICAS}" api-gateway
  echo "      restart auth-e2e-edge (refresh nginx → api-gateway upstream after recreate)"
  "${COMPOSE[@]}" up -d --no-deps --force-recreate auth-e2e-edge
else
  "${COMPOSE[@]}" up -d --scale "api-gateway=${GATEWAY_REPLICAS}" \
    postgres redis redis-auth database-service auth-service security-service \
    api-gateway frontend auth-e2e-edge
fi

echo "=== [1b/9] Wait auth-e2e ready + login probe ==="
bash "$ROOT/scripts/auth-e2e-wait-healthy.sh"
bash "$ROOT/scripts/auth-e2e-bootstrap.sh" || abort "auth-e2e bootstrap/login probe — check auth-service and gateway logs"

running_gateways="$("${COMPOSE[@]}" ps api-gateway 2>/dev/null | grep -cE 'Up|running' || true)"
if [[ "${CAPACITY_SKIP_STACK:-0}" != "1" ]]; then
  if [[ "$running_gateways" -ge "$GATEWAY_REPLICAS" ]]; then
    pass "api-gateway replicas running: ${running_gateways}"
  else
    fail "api-gateway replicas expected ${GATEWAY_REPLICAS}, got ${running_gateways}"
  fi
fi
capture_docker_stats "pre-load"

echo "=== [2/9] Infra verify (proof token enabled) ==="
bash "$ROOT/scripts/verify-auth-proof-token.sh" || abort "infra verify — fix auth-e2e stack before load test"

echo "=== [3/9] Revoke → 401 latency (isolated — before session pool) ==="
if node "$ROOT/scripts/auth-capacity/revoke-latency.mjs"; then
  pass "revoke latency ≤2s"
else
  fail "revoke latency"
fi

echo "=== [4/9] Bootstrap sessions ==="
node "$ROOT/scripts/auth-capacity/bootstrap-sessions.mjs" || abort "bootstrap sessions — check Node 18+, auth-e2e health, test account"
[[ -f "$CAPACITY_SESSIONS_FILE" ]] || abort "sessions file missing after bootstrap: $CAPACITY_SESSIONS_FILE"

echo "=== [5/9] Token pool sidecar ==="
node "$ROOT/scripts/auth-capacity/token-pool.mjs" &
TOKEN_POOL_PID=$!
for _ in $(seq 1 30); do
  if curl -sf "${CAPACITY_TOKEN_POOL_URL}/health" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$TOKEN_POOL_PID" 2>/dev/null; then
    abort "token pool exited before health check — see bootstrap / sessions.json"
  fi
  sleep 0.5
done
curl -sf "${CAPACITY_TOKEN_POOL_URL}/health" >/dev/null || abort "token pool health — sidecar not listening on ${CAPACITY_TOKEN_POOL_URL}"

echo "=== [6/9] Hot path k6 (GET /api/profile + proof token) ==="
if run_k6 "$ROOT/scripts/auth-capacity/hot-profile.k6.js"; then
  pass "hot path k6 finished"
else
  fail "hot path k6 thresholds or execution"
fi
capture_docker_stats "post-hot"

if [[ -n "$TOKEN_POOL_PID" ]] && kill -0 "$TOKEN_POOL_PID" 2>/dev/null; then
  echo "      stop token pool before cold path (avoid proof/token 429 contention)"
  kill "$TOKEN_POOL_PID" 2>/dev/null || true
  wait "$TOKEN_POOL_PID" 2>/dev/null || true
  TOKEN_POOL_PID=""
fi

echo "=== [7/9] Cold path (proof/token + refresh full ECDSA) ==="
if node "$ROOT/scripts/auth-capacity/cold-path-load.mjs"; then
  pass "cold path load"
else
  fail "cold path load"
fi
capture_docker_stats "post-all"

echo "=== [8/9] Cleanup test sessions ==="
if [[ "${CAPACITY_SKIP_CLEANUP:-0}" == "1" ]]; then
  echo "      (skip — CAPACITY_SKIP_CLEANUP=1)"
else
  node "$ROOT/scripts/auth-capacity/cleanup-sessions.mjs" || fail "cleanup sessions"
fi

echo "=== [9/9] Write report ==="
export CAPACITY_GIT_SHA="$GIT_SHA"
export CAPACITY_GATEWAY_REPLICAS="$GATEWAY_REPLICAS"
export CAPACITY_RUNNING_GATEWAYS="${running_gateways:-unknown}"
export CAPACITY_STATS_FILE="$STATS_FILE"
node - "$REPORT_FILE" <<'NODE'
const fs = require('fs');
const reportPath = process.argv[2];
const art = process.env.CAPACITY_ARTIFACT_DIR;
const read = (f) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
};
const hot = read(`${art}/k6-hot-summary.json`);
const cold = read(`${art}/cold-path-summary.json`);
const revoke = read(`${art}/revoke-latency-summary.json`);
const hotP50 = hot?.metrics?.hot_profile_latency?.values?.['p(50)'];
const hotP95 = hot?.metrics?.hot_profile_latency?.values?.['p(95)'];
const hotP99 = hot?.metrics?.hot_profile_latency?.values?.['p(99)'];
const hotErr = hot?.metrics?.hot_profile_errors?.values?.rate;
const hotRps = hot?.metrics?.http_reqs?.values?.rate;
const stats = (() => {
  try { return fs.readFileSync(process.env.CAPACITY_STATS_FILE, 'utf8'); } catch { return ''; }
})();
const lines = [];
lines.push('# Auth capacity report (PEND-SEC-CAPACITY-001)');
lines.push('');
lines.push(`Generated: ${new Date().toISOString()} UTC`);
lines.push('');
lines.push('> Scope: capacity validated on **current VPS/staging profile** — not a claim for millions-scale.');
lines.push('');
lines.push('## Environment');
lines.push('');
lines.push(`- Git SHA: \`${process.env.CAPACITY_GIT_SHA || 'unknown'}\``);
lines.push(`- Base URL: \`${process.env.CAPACITY_BASE_URL}\``);
lines.push(`- Test account: \`${process.env.CAPACITY_EMAIL}\``);
lines.push(`- Gateway replicas (target/running): ${process.env.CAPACITY_GATEWAY_REPLICAS || 1} / ${process.env.CAPACITY_RUNNING_GATEWAYS || 'n/a'}`);
lines.push(`- Sessions: ${process.env.CAPACITY_SESSION_COUNT}`);
lines.push(`- Hot target RPS: ${process.env.CAPACITY_HOT_RPS}`);
lines.push(`- Hot duration: ${process.env.CAPACITY_HOT_DURATION}`);
lines.push('');
lines.push('## Hot path — GET /api/profile + X-Auth-Proof-Access-Token');
lines.push('');
lines.push('| Metric | Value | Target |');
lines.push('|--------|-------|--------|');
lines.push(`| p50 latency | ${hotP50 != null ? hotP50.toFixed(2) + ' ms' : 'n/a'} | — |`);
lines.push(`| p95 latency | ${hotP95 != null ? hotP95.toFixed(2) + ' ms' : 'n/a'} | < ${process.env.CAPACITY_HOT_P95_MS} ms |`);
lines.push(`| p99 latency | ${hotP99 != null ? hotP99.toFixed(2) + ' ms' : 'n/a'} | — |`);
lines.push(`| error rate | ${hotErr != null ? (hotErr * 100).toFixed(3) + ' %' : 'n/a'} | < ${Number(process.env.CAPACITY_HOT_ERROR_RATE) * 100} % |`);
lines.push(`| http RPS | ${hotRps != null ? hotRps.toFixed(1) : 'n/a'} | ~${process.env.CAPACITY_HOT_RPS} |`);
lines.push('');
lines.push('Hot path note: proof token verify only — **no Redis nonce SETNX** on GET /api/profile.');
lines.push('');
lines.push('## Cold path — full ECDSA');
lines.push('');
if (cold?.results) {
  for (const r of cold.results) {
    lines.push(`### ${r.scenario}`);
    lines.push(`- total: ${r.total}, errors: ${(r.errorRate * 100).toFixed(2)}%`);
    lines.push(`- p50/p95/p99/max: ${r.p50.toFixed(1)} / ${r.p95.toFixed(1)} / ${r.p99.toFixed(1)} / ${r.max.toFixed(1)} ms`);
    lines.push(`- RPS: ${r.rps.toFixed(1)}, errors: ${(r.errorRate * 100).toFixed(2)}%`);
    const coldTarget = r.scenario === 'proof_token' ? 200 : 500;
    lines.push(`- target p95: < ${coldTarget} ms (review)`);
    lines.push('');
  }
} else {
  lines.push('_no data_');
  lines.push('');
}
lines.push('## Revoke → 401');
lines.push('');
if (revoke) {
  lines.push(`- first 401: ${revoke.first401Ms != null ? revoke.first401Ms.toFixed(0) + ' ms' : 'TIMEOUT'}`);
  lines.push(`- p50/p95/p99/max: ${revoke.p50Ms ?? 'n/a'} / ${revoke.p95Ms ?? 'n/a'} / ${revoke.p99Ms ?? 'n/a'} / ${revoke.maxMs ?? 'n/a'} ms`);
  lines.push(`- target p99: ≤ ${revoke.targetMs} ms`);
  lines.push(`- verdict: **${revoke.pass ? 'PASS' : 'FAIL'}**`);
} else {
  lines.push('_no data_');
}
lines.push('');
if (stats) {
  lines.push('## Docker stats (gateway / redis / postgres)');
  lines.push('');
  lines.push('```text');
  lines.push(stats.trimEnd());
  lines.push('```');
  lines.push('');
}
lines.push('## Pass criteria');
lines.push('');
lines.push('- Hot p95 < CAPACITY_HOT_P95_MS (default 50ms)');
lines.push('- Hot error rate < CAPACITY_HOT_ERROR_RATE (default 0.1%)');
lines.push('- Cold proof/token p95 < 200ms (manual review)');
lines.push('- Revoke → 401 ≤ 2000ms');
lines.push('');
const coldProof = cold?.results?.find((r) => r.scenario === 'proof_token');
const coldRefresh = cold?.results?.find((r) => r.scenario === 'refresh');
const hotPass = hotP95 != null && hotP95 < Number(process.env.CAPACITY_HOT_P95_MS)
  && hotErr != null && hotErr < Number(process.env.CAPACITY_HOT_ERROR_RATE);
const coldProofPass = !coldProof || coldProof.p95 < 200;
const revokePass = !!revoke?.pass;
const verdict = hotPass && coldProofPass && revokePass ? 'PASS' : 'FAIL';
lines.push(`## Overall verdict: **${verdict}**`);
lines.push('');
fs.writeFileSync(reportPath, lines.join('\n'));
console.log(`Report: ${reportPath}`);
NODE

if [[ "$failures" -gt 0 ]]; then
  echo ""
  echo "PEND-SEC-CAPACITY-001: FAIL ($failures checks)"
  exit 1
fi

echo ""
echo "PEND-SEC-CAPACITY-001: PASS"
echo "Report: $REPORT_FILE"
