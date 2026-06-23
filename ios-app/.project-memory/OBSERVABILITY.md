# Observability — Earflow iOS

## Logs

| Component | Mechanism |
|-----------|-----------|
| App-wide | `EarflowLog` actor — ring buffer 400 entries |
| OS | `Logger(subsystem: "ru.earflow.listener")` |
| Gateway | `GatewayLogger` → `EarflowLog` category `gateway` |

### Format

```text
[ISO8601] [LEVEL] [category] message
```

### Sensitive data rules

`LogRedactor` masks: `mp_auth`, `mp_sid`, `mp_csrf`, proof tokens, bearer, tickets.

**Never log:** full cookies, proof strings, stream tickets, passwords.

### User-facing debug

`Settings → Журнал отладки` — refresh, export (share sheet), clear.

## Metrics (planned)

- Playback start latency, session failures
- Auth login success/failure counts
- Not wired to backend telemetry yet — `PEND-IOS-001`

## Tracing

No distributed tracing in v0.x. Correlation: future `X-Request-Id` if gateway exposes.

## Health

App has no server health endpoint. Dev checks:

```bash
npm run verify:ios-native
curl -sS https://api.earflow.ru/health  # platform health (ops)
```

## Alerts

N/A on client. User sees inline errors + debug log for support.
