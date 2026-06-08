/**
 * PEND-SEC-CAPACITY-001 — k6 hot path: GET /api/profile with proof access token.
 *
 * Requires token-pool sidecar: node scripts/auth-capacity/token-pool.mjs
 *
 * Env:
 *   CAPACITY_BASE_URL       default http://127.0.0.1:18080
 *   CAPACITY_TOKEN_POOL_URL default http://127.0.0.1:19876
 *   CAPACITY_HOT_VUS        default 50
 *   CAPACITY_HOT_DURATION   default 60s
 *   CAPACITY_HOT_RPS        default 500 (constant-arrival-rate)
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const baseUrl = __ENV.CAPACITY_BASE_URL || 'http://127.0.0.1:18080';
const poolUrl = __ENV.CAPACITY_TOKEN_POOL_URL || 'http://127.0.0.1:19876';
const vus = Number(__ENV.CAPACITY_HOT_VUS || 50);
const duration = __ENV.CAPACITY_HOT_DURATION || '60s';
const targetRps = Number(__ENV.CAPACITY_HOT_RPS || 500);

const hotLatency = new Trend('hot_profile_latency', true);
const hotErrors = new Rate('hot_profile_errors');
const hot401 = new Counter('hot_profile_401');
const hot403 = new Counter('hot_profile_403');
const hot429 = new Counter('hot_profile_429');
const hot5xx = new Counter('hot_profile_5xx');

export const options = {
  scenarios: {
    hot_profile: {
      executor: 'constant-arrival-rate',
      rate: targetRps,
      timeUnit: '1s',
      duration,
      preAllocatedVUs: vus,
      maxVUs: Math.max(vus * 2, 100),
    },
  },
  thresholds: {
    hot_profile_latency: [`p(95)<${__ENV.CAPACITY_HOT_P95_MS || 50}`],
    hot_profile_errors: [`rate<${__ENV.CAPACITY_HOT_ERROR_RATE || 0.001}`],
    http_req_failed: [`rate<${__ENV.CAPACITY_HOT_ERROR_RATE || 0.001}`],
  },
};

function sessionIndex() {
  return (__VU - 1) % Math.max(1, Number(__ENV.CAPACITY_SESSION_COUNT || 20));
}

export default function hotProfile() {
  const poolResp = http.get(`${poolUrl}/session/${sessionIndex()}`, { tags: { name: 'token_pool' } });
  if (poolResp.status !== 200) {
    hotErrors.add(1);
    sleep(0.05);
    return;
  }
  let creds;
  try {
    creds = JSON.parse(poolResp.body);
  } catch {
    hotErrors.add(1);
    return;
  }

  const res = http.get(`${baseUrl}/api/profile`, {
    headers: {
      Accept: 'application/json',
      Origin: __ENV.CAPACITY_ORIGIN || baseUrl,
      Cookie: creds.cookieHeader,
      'X-Auth-Device-Id': creds.authDeviceId,
      'X-Auth-Proof-Access-Token': creds.proofToken,
    },
    tags: { name: 'hot_profile' },
  });

  hotLatency.add(res.timings.duration);
  const ok = check(res, { 'profile 200': (r) => r.status === 200 });
  if (!ok) {
    hotErrors.add(1);
    if (res.status === 401) hot401.add(1);
    if (res.status === 403) hot403.add(1);
    if (res.status === 429) hot429.add(1);
    if (res.status >= 500) hot5xx.add(1);
  } else {
    hotErrors.add(0);
  }
}

export function handleSummary(data) {
  const out = __ENV.CAPACITY_K6_SUMMARY || 'artifacts/auth-capacity/k6-hot-summary.json';
  return {
    [out]: JSON.stringify(data, null, 2),
    stdout: textSummary(data),
  };
}

function textSummary(data) {
  const m = data.metrics || {};
  const p95 = m.hot_profile_latency?.values?.['p(95)'];
  const err = m.hot_profile_errors?.values?.rate;
  const rps = m.http_reqs?.values?.rate;
  const n401 = m.hot_profile_401?.values?.count;
  const n429 = m.hot_profile_429?.values?.count;
  return [
    '=== hot profile k6 summary ===',
    `p95 latency: ${p95 != null ? p95.toFixed(2) : 'n/a'} ms`,
    `error rate: ${err != null ? (err * 100).toFixed(3) : 'n/a'} %`,
    `http RPS: ${rps != null ? rps.toFixed(1) : 'n/a'}`,
    `401 count: ${n401 != null ? n401 : 'n/a'}`,
    `429 count: ${n429 != null ? n429 : 'n/a'}`,
    '',
  ].join('\n');
}
