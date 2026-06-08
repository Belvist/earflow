# Auth capacity report (PEND-SEC-CAPACITY-001)

Generated: 2026-06-08 UTC (VPS `ru-vmv2-mini`, git `250e256`)

> Scope: capacity validated on **current VPS/staging profile** — not a claim for millions-scale.

## Environment

- Git SHA: `250e2563e725c3873c791ab782a9e9191ef99a18`
- Base URL: `http://127.0.0.1:18080`
- Test account: `pop-e2e@earflow.test`
- Gateway replicas (target/running): 2 / 2
- Sessions: 20
- Hot target RPS: 500
- Hot duration: 60s

## Hot path — GET /api/profile + X-Auth-Proof-Access-Token

| Metric | Value | Target |
|--------|-------|--------|
| p95 latency | 6.18 ms | < 50 ms |
| error rate | 0.000 % | < 0.1 % |
| http RPS | 999.9 | ~500 |

Hot path note: proof token verify only — **no Redis nonce SETNX** on GET /api/profile.

## Cold path — full ECDSA

### proof_token
- total: 17048, errors: 0.00%
- p50/p95/p99/max: — / 40.8 / — / — ms
- RPS: 568.3
- target p95: < 200 ms (review)

### refresh
- total: 17782, errors: 0.00%
- p50/p95/p99/max: — / 34.3 / — / — ms
- RPS: 592.7
- target p95: < 500 ms (review)

## Revoke → 401

- first 401: 25 ms
- target p99: ≤ 2000 ms
- verdict: **PASS**

## Pass criteria

- Hot p95 < CAPACITY_HOT_P95_MS (default 50ms)
- Hot error rate < CAPACITY_HOT_ERROR_RATE (default 0.1%)
- Cold proof/token p95 < 200ms (manual review)
- Revoke → 401 ≤ 2000ms

## Overall verdict: **PASS**
