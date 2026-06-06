---
name: earflow-gateway-routing
description: Adds or modifies API routes in the Earflow Go gateway — gateway.yaml, upstreams, policies, CSRF, rate limits. Use when exposing a new backend service through api-gateway or artist-api-gateway, or changing /api/* routing.
---

# Earflow Gateway Routing

## Workflow

1. Read `reports/SERVICE_MAP.md` for service name and dependencies
2. Add upstream env/host in gateway config if new service
3. Add route to `gateway.yaml` (listeners) or `gateway.artist.yaml` (artists)
4. Add nginx location if public edge path needed (`nginx/`)
5. Run tests: `cd backend/go-api-gateway && go test ./...`
6. Verify CSRF + auth behavior for the policy class

## Route template

```yaml
- id: service_api
  match:
    type: prefix
    value: /api/my-service
  upstream: my_service
  policies:
    class: unsafe
    require_user: true
    rate_limit: default
    timeout: 30s
```

## Policy classes

| Class | Use |
|-------|-----|
| `public` | No auth (health, public catalog fragments) |
| `unsafe` | Auth + CSRF on mutating methods |
| `stream` | Playback; `rate_limit: stream` |

## Match types

- `exact` — single path
- `prefix` — subtree
- `regex` — advanced (escape carefully)

## Critical rules

- Do not allow client to set `X-User-Id`
- Artist portal write routes may require MFA step-up (upstream checks)
- Order matters: more specific routes before broad prefixes
- Mirror artist routes in `gateway.artist.yaml` only when needed for Artist Portal

## Reference

- Route table: `backend/go-api-gateway/gateway.yaml`
- Proxy: `internal/proxy/reverse_proxy.go`
- Auth: `internal/auth/session_manager.go`, `csrf.go`
