---
name: earflow-ops
description: Operates Earflow infrastructure — Docker Compose, health checks, backups, scaling, SSL, monitoring alerts. Use when deploying, debugging containers, running platform-control scripts, backup/restore drills, or scale-gateway/scale-stateless.
---

# Earflow Operations

Reference: `reports/RUNBOOK.md`, `docs/operations-spof-runbook.md`, `docs/monitoring-telegram-alerts-runbook.md`

## Health & status

```bash
docker compose ps
docker compose logs -f <service>
./scripts/platform-control.sh health
```

## Start / rebuild

```bash
cp .env.example .env   # first time only
docker compose up -d
docker compose up -d --build <service>
```

## Backups

```bash
./scripts/backup-postgres.sh
./scripts/backup-minio.sh
./scripts/drill-postgres-restore.sh   # verify restore
./scripts/drill-minio-restore.sh
./scripts/drill-critical-backups.sh
```

## Scaling

```bash
./scripts/scale-gateway.sh
./scripts/scale-stateless.sh
node scripts/render-scalable-compose.js   # generate scaled compose
```

## SSL

```bash
./scripts/ssl-setup.sh
./scripts/ssl-renew.sh
```

## Monitoring

- Compose profile: `docker-compose.monitoring.yml`
- Telegram alerts: `scripts/telegram-ops-bot.js`, `docs/monitoring-telegram-alerts-runbook.md`

## Load / smoke tests

```bash
./scripts/party-smoke-load.sh
./scripts/device-sync-docker-gate.sh
```

## Incident basics

1. Identify layer: nginx → gateway → service → data (Postgres/Redis/MinIO)
2. Check `docker compose ps` and service logs
3. Redis auth down → auth/session failures (Critical)
4. Postgres down → full platform down (Critical)
5. MinIO down → streaming/upload broken (High)
6. Do not restart Postgres/MinIO in prod without backup confirmation

## Secrets setup

```bash
./scripts/setup-secrets.sh
openssl rand -hex 32   # manual secret generation
```

Never commit `.env` or production credentials.
