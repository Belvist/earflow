---
title: Secure monitoring and Telegram alerts runbook
---

# Secure monitoring and Telegram alerts runbook

## Goal

Run Grafana, Prometheus, exporters and Telegram alerts without exposing the control plane to the public internet.

## Security model

- Keep monitoring ports bound to `127.0.0.1` by default.
- For phone access, bind `MONITORING_BIND_ADDRESS` only to the server Tailscale/WireGuard IP.
- Do not bind monitoring to `0.0.0.0` on a public server.
- Use a dedicated Telegram bot for alerts.
- Do not reuse user-facing app bot tokens for Alertmanager.
- Keep Prometheus, Alertmanager, exporters and Grafana behind VPN/private access.
- Use a Grafana viewer account on mobile and reserve admin access for maintenance.

## Required `.env` keys

```env
MONITORING_BIND_ADDRESS=127.0.0.1
GRAFANA_ADMIN_USER=earflow_admin
GRAFANA_ADMIN_PASSWORD=<strong-secret>
ALERTMANAGER_EXTERNAL_URL=http://127.0.0.1:9093
ALERTMANAGER_TELEGRAM_BOT_TOKEN=<dedicated-alert-bot-token>
ALERTMANAGER_TELEGRAM_CHAT_ID=<telegram-chat-id>
TELEGRAM_OPS_BOT_TOKEN=<ops-bot-token>
TELEGRAM_OPS_BOOTSTRAP_SECRET=<one-time-claim-secret>
TELEGRAM_OPS_ALLOWED_USER_IDS=
TELEGRAM_OPS_ALLOWED_CHAT_IDS=
TELEGRAM_OPS_ALLOW_GROUPS=false
TELEGRAM_OPS_ALLOW_MULTIPLE_CLAIMS=false
TELEGRAM_OPS_SEND_RESOLVED=true
TELEGRAM_OPS_DELETE_WEBHOOK=true
POSTGRES_EXPORTER_DATA_SOURCE_URI=
PGBOUNCER_EXPORTER_CONNECTION_STRING=
```

Set `POSTGRES_EXPORTER_DATA_SOURCE_URI` only if the default `postgres:5432/${DB_NAME}?sslmode=disable` is not valid for your runtime.

If PgBouncer metrics are enabled and `DB_PASSWORD` contains URL-reserved characters, set `PGBOUNCER_EXPORTER_CONNECTION_STRING` explicitly with a valid URL-encoded DSN.

## Telegram setup

1. Use `TELEGRAM_OPS_BOT_TOKEN` for the read-only ops bot.
2. Keep `TELEGRAM_OPS_BOOTSTRAP_SECRET` private.
3. Start the bot with the `telegram-ops` profile.
4. Send `/claim <TELEGRAM_OPS_BOOTSTRAP_SECRET>` to the bot in a private Telegram chat.
5. After claim, only the claimed Telegram user/chat can run analytics commands.
6. Keep the token private and rotate it if it was pasted into logs, chats or screenshots.

Send a one-off test message:

```bash
node scripts/send-telegram-alert-test.js
```

Read-only bot commands:

```text
/status
/alerts
/traffic
/db
/redis
/whoami
/help
```

## Local-only access

Start monitoring without Telegram alerts:

```bash
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d prometheus grafana loki tempo alloy cadvisor node-exporter blackbox-exporter postgres-exporter redis-exporter redis-auth-exporter
```

Open Grafana from the server or through an SSH tunnel:

```text
http://127.0.0.1:3300
```

## Phone access through Tailscale/WireGuard

Set the bind address to the server private VPN IP:

```env
MONITORING_BIND_ADDRESS=100.x.y.z
ALERTMANAGER_EXTERNAL_URL=http://100.x.y.z:9093
```

Then restart monitoring:

```bash
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d
```

Open from the phone while connected to VPN:

```text
http://100.x.y.z:3300
```

## Enable Telegram alerts

Recommended mode: start the read-only Telegram ops bot. It polls Prometheus alerts and sends firing/resolved notifications to the claimed owner.

```bash
docker compose --profile telegram-ops -f docker-compose.yml -f docker-compose.monitoring.yml up -d telegram-ops-bot
```

Optional mode: start Alertmanager with the alerts profile after `ALERTMANAGER_TELEGRAM_CHAT_ID` is configured.

```bash
docker compose --profile alerts -f docker-compose.yml -f docker-compose.monitoring.yml up -d alertmanager
```

Start the full monitoring stack with the ops bot:

```bash
docker compose --profile telegram-ops -f docker-compose.yml -f docker-compose.monitoring.yml up -d
```

With PgBouncer overlay, PgBouncer metrics and the ops bot:

```bash
docker compose --profile telegram-ops --profile pgbouncer-metrics -f docker-compose.yml -f docker-compose.pgbouncer.yml -f docker-compose.monitoring.yml up -d
```

## Check status

```bash
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml ps
```

```bash
docker compose --profile alerts -f docker-compose.yml -f docker-compose.monitoring.yml logs --tail=100 alertmanager
```

Prometheus targets:

```text
http://127.0.0.1:9090/targets
```

Alertmanager UI:

```text
http://127.0.0.1:9093
```

Grafana:

```text
http://127.0.0.1:3300
```

## Scrape target down triage

When Telegram reports `EarflowScrapeTargetDown`, first separate a real service outage from a monitoring wiring issue.

Check runtime state:

```bash
cd /opt/music-platform
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml ps \
  api-gateway transcode-worker party-state-service \
  cadvisor postgres-exporter redis-exporter redis-auth-exporter \
  prometheus blackbox-exporter
```

Check logs for the exact target:

```bash
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml logs --tail=120 api-gateway
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml logs --tail=120 transcode-worker
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml logs --tail=120 party-state-service
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml logs --tail=120 postgres-exporter redis-exporter redis-auth-exporter cadvisor
```

Check scrape endpoints from inside the Compose network:

```bash
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml exec -T prometheus wget -qO- http://api-gateway:3000/metrics | head
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml exec -T prometheus wget -qO- http://party-state-service:3130/metrics | head
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml exec -T prometheus wget -qO- http://transcode-worker:3098/metrics | head
```

Expected:

- `api-gateway:3000/metrics` returns Prometheus text without admin basic auth.
- `party-state-service:3130/metrics` returns `party_state_up 1`.
- `transcode-worker:3098/metrics` returns Prometheus text even when `/health` is temporarily not ready.

Bad result meanings:

- `401` from `api-gateway:3000/metrics`: gateway metrics are still protected from Prometheus.
- Connection refused / DNS failure: container is down, not on `music-network`, or Prometheus was started without the right Compose files.
- Exporters down: restart the monitoring overlay and inspect exporter logs; these are monitoring containers, not application traffic handlers.

## Transcode worker health triage

`transcode-worker` exposes both `/metrics` and `/health`. `/metrics` should stay scrapeable for diagnosis. `/health` returns `503` while the worker is not ready.

Check the health body:

```bash
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml exec -T transcode-worker \
  node -e "const p=process.env.HEALTH_PORT||'3098'; require('http').get('http://127.0.0.1:'+p+'/health', r => { let b=''; r.on('data', c => b+=c); r.on('end', () => { console.log(r.statusCode); console.log(b); }); }).on('error', e => { console.error(e.message); process.exit(1); })"
```

Check the required database column:

```bash
docker compose exec -T postgres sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
SELECT column_name
FROM information_schema.columns
WHERE table_name = '\''songs'\''
  AND column_name IN ('\''transcode_status'\'','\''transcode_error'\'','\''quality_variants'\'');
"'
```

Expected:

- `/health` returns `200` with `"ok":true`.
- The `songs` table contains `transcode_status`, `transcode_error`, and `quality_variants`.

Bad result meanings:

- `/health` is `503` with `"ready":false`: the worker process is alive, but startup readiness failed or shutdown is in progress.
- Missing columns: apply the DB migration/init script before starting `transcode-worker`.
- Container repeatedly restarts: inspect `transcode-worker` logs for DB, MinIO or filesystem errors.

## Reload monitoring config

After changing Prometheus rules or scrape config:

```bash
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml exec -T prometheus \
  wget -qO- --post-data='' http://localhost:9090/-/reload
```

If the reload command is unavailable, restart Prometheus:

```bash
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml restart prometheus
```

## Alert groups

The default rules cover:

- scrape targets down;
- HTTP health probes down;
- high host disk usage;
- high host memory usage;
- repeated container restarts;
- high API gateway 5xx ratio;
- high API gateway p95 latency;
- recommendation infinite feed traffic spikes;
- high Postgres connections;
- PgBouncer client waiting;
- Redis high memory usage;
- Redis evictions.

## First incident workflow

1. Read the Telegram alert.
2. Open Grafana over VPN.
3. Check the matching dashboard.
4. Check Prometheus targets if metrics are missing.
5. Check container logs only for the affected service.
6. Apply the matching runbook action.
7. Watch p95 latency, error rate, PgBouncer waiting clients and Postgres CPU for 10-30 minutes.

## What not to do

- Do not expose Grafana, Prometheus, Alertmanager or exporters publicly.
- Do not put Telegram tokens into dashboards or alert annotations.
- Do not paste `.env` secrets into chats or tickets.
- Do not increase DB connections blindly when PgBouncer or Postgres is under pressure.
- Do not use a user-facing production bot as the alert bot unless that risk is accepted.
