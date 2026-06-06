#!/usr/bin/env bash
# Pull latest code from GitHub and redeploy auth/nginx/frontend stack on VPS.
#
# Prerequisites:
#   - /opt/music-platform is a git clone with origin → github.com/Belvist/earflow
#   - SSH deploy key in ~/.ssh/earflow_deploy (see header in docs below)
#   - .env and secrets/ exist locally (gitignored)
#
# Usage:
#   cd /opt/music-platform
#   bash scripts/vps-deploy-from-git.sh              # deploy origin/main
#   DEPLOY_REF=13c0208 bash scripts/vps-deploy-from-git.sh
#   SKIP_BUILD=1 bash scripts/vps-deploy-from-git.sh # pull only
#
# Cron (optional — only after prod auth green + you accept auto-redeploy risk):
#   */15 * * * * cd /opt/music-platform && GIT_SSH_COMMAND='ssh -i /root/.ssh/earflow_deploy -o IdentitiesOnly=yes' bash scripts/vps-deploy-from-git.sh >> /var/log/earflow-deploy.log 2>&1

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DEPLOY_REF="${DEPLOY_REF:-main}"
SKIP_BUILD="${SKIP_BUILD:-0}"
SERVICES="${DEPLOY_SERVICES:-frontend nginx api-gateway security-service}"

log() { echo "[$(date -Iseconds)] $*"; }

if [[ ! -d .git ]]; then
  echo "FAIL: $ROOT is not a git repository" >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "FAIL: missing .env — restore from backup before deploy" >&2
  exit 1
fi

log "fetch origin"
git fetch origin

BEFORE_SHA="$(git rev-parse HEAD 2>/dev/null || echo none)"

if [[ "$DEPLOY_REF" == "main" ]]; then
  git switch main 2>/dev/null || git checkout -B main origin/main
  git pull --ff-only origin main
else
  git checkout "$DEPLOY_REF"
fi

AFTER_SHA="$(git rev-parse HEAD)"
log "deploy SHA: $AFTER_SHA (was: $BEFORE_SHA)"

if [[ "$BEFORE_SHA" == "$AFTER_SHA" && "$SKIP_BUILD" != "1" ]]; then
  log "no new commits — rebuild skipped (set FORCE_BUILD=1 to override)"
  if [[ "${FORCE_BUILD:-0}" != "1" ]]; then
    exit 0
  fi
fi

if [[ "$SKIP_BUILD" == "1" ]]; then
  log "SKIP_BUILD=1 — pull only, containers unchanged"
  exit 0
fi

log "docker compose build: $SERVICES"
docker compose -f docker-compose.yml build --no-cache $SERVICES

log "docker compose up"
docker compose -f docker-compose.yml up -d --force-recreate $SERVICES

log "nginx -t"
docker compose -f docker-compose.yml run --rm --no-deps nginx nginx -t

MAIN_LISTENER="$(curl -sS --max-time 15 https://earflow.ru/ 2>/dev/null | grep -oE 'main\.[a-f0-9]+\.js' | head -1 || true)"
MAIN_AUTH="$(curl -sS --max-time 15 https://auth.earflow.ru/ 2>/dev/null | grep -oE 'main\.[a-f0-9]+\.js' | head -1 || true)"
log "bundle earflow.ru: ${MAIN_LISTENER:-unknown}"
log "bundle auth.earflow.ru: ${MAIN_AUTH:-unknown}"

log "done SHA=$AFTER_SHA"
