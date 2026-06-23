import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";

const apiLatency = new Trend("api_latency_ms", true);
const apiErrors = new Rate("api_errors");
const apiRateLimited = new Rate("api_rate_limited");
const apiServerErrors = new Rate("api_server_errors");
const apiStatus429 = new Counter("api_status_429");
const apiStatus5xx = new Counter("api_status_5xx");

const baseUrl = __ENV.BASE_URL || "https://earflow.ru";
const endpoint = __ENV.ENDPOINT || "/api/version";
const pauseSeconds = Number(__ENV.PAUSE_SECONDS || 1.5);
const avgRpsPerOnlineUser = Number(__ENV.AVG_RPS_PER_ONLINE_USER || 0.25);

const preAllocatedVUs = Number(__ENV.PRE_VUS || 100);
const maxVUs = Number(__ENV.MAX_VUS || 5000);
const warmupRps = Number(__ENV.WARMUP_RPS || 20);
const targetRps = Number(__ENV.TARGET_RPS || 250);
const holdMinutes = Number(__ENV.HOLD_MINUTES || 10);
const maxExpected429Rate = Number(__ENV.MAX_EXPECTED_429_RATE || 0.01);

export const options = {
  discardResponseBodies: true,
  scenarios: {
    online_probe: {
      executor: "ramping-arrival-rate",
      startRate: 1,
      timeUnit: "1s",
      preAllocatedVUs,
      maxVUs,
      stages: [
        { target: warmupRps, duration: "2m" },
        { target: targetRps, duration: "3m" },
        { target: targetRps, duration: `${holdMinutes}m` },
        { target: 0, duration: "1m" },
      ],
    },
  },
  thresholds: {
    http_req_failed: [`rate<${Math.max(maxExpected429Rate, 0.01)}`],
    http_req_duration: ["p(95)<800", "p(99)<1500"],
    checks: ["rate>0.99"],
    api_errors: ["rate<0.01"],
    api_rate_limited: [`rate<${maxExpected429Rate}`],
    api_server_errors: ["rate<0.001"],
  },
};

export default function () {
  const url = `${baseUrl}${endpoint}`;
  const res = http.get(url, {
    timeout: "10s",
    tags: { endpoint },
    headers: {
      Accept: "application/json,text/plain,*/*",
    },
  });

  const isRateLimited = res.status === 429;
  const isServerError = res.status >= 500;
  const ok = check(res, {
    "status is 2xx/3xx": (r) => r.status >= 200 && r.status < 400,
    "status is not 429": (r) => r.status !== 429,
    "status is not 5xx": (r) => r.status < 500,
  });

  apiErrors.add(!ok);
  apiRateLimited.add(isRateLimited);
  apiServerErrors.add(isServerError);
  if (isRateLimited) apiStatus429.add(1);
  if (isServerError) apiStatus5xx.add(1);
  apiLatency.add(res.timings.duration);
  sleep(pauseSeconds);
}

function safe(n) {
  return Number.isFinite(n) ? n : 0;
}

function round(n, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

export function handleSummary(data) {
  const durationSeconds = safe(data.state.testRunDurationMs) / 1000;
  const totalRequests = safe(data.metrics.http_reqs?.values?.count);
  const achievedRps = durationSeconds > 0 ? totalRequests / durationSeconds : 0;
  const p95 = safe(data.metrics.http_req_duration?.values?.["p(95)"]);
  const p99 = safe(data.metrics.http_req_duration?.values?.["p(99)"]);
  const errorRate = safe(data.metrics.http_req_failed?.values?.rate);
  const rateLimitedRate = safe(data.metrics.api_rate_limited?.values?.rate);
  const serverErrorRate = safe(data.metrics.api_server_errors?.values?.rate);
  const status429 = safe(data.metrics.api_status_429?.values?.count);
  const status5xx = safe(data.metrics.api_status_5xx?.values?.count);

  const onlineEstimate =
    avgRpsPerOnlineUser > 0 ? achievedRps / avgRpsPerOnlineUser : 0;

  const report = [
    "",
    "=== Online Capacity Estimate ===",
    `Base URL: ${baseUrl}`,
    `Endpoint: ${endpoint}`,
    `Total requests: ${Math.round(totalRequests)}`,
    `Achieved RPS: ${round(achievedRps, 2)}`,
    `p95 latency: ${round(p95, 2)} ms`,
    `p99 latency: ${round(p99, 2)} ms`,
    `HTTP error rate: ${round(errorRate * 100, 3)} %`,
    `429 rate-limit responses: ${Math.round(status429)} (${round(rateLimitedRate * 100, 3)} %)`,
    `5xx responses: ${Math.round(status5xx)} (${round(serverErrorRate * 100, 3)} %)`,
    `Model input: AVG_RPS_PER_ONLINE_USER=${avgRpsPerOnlineUser}`,
    `Estimated online users at this load: ${Math.round(onlineEstimate)}`,
    "",
    "Interpretation:",
    "- If 429 grows while p95 is stable and 5xx/timeouts are absent, the test hit rate limits, not raw server capacity.",
    "- If p95 grows sharply and/or errors increase at target RPS, this is near the limit.",
    "- Repeat with larger TARGET_RPS until thresholds break, then take previous stable step.",
    "",
  ].join("\n");

  return {
    stdout: report,
    "scripts/load/k6-last-summary.json": JSON.stringify(data, null, 2),
  };
}
