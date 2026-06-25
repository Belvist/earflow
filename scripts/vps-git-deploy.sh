#!/usr/bin/env bash
# Deploy Earflow on VPS from git (run on server as root or deploy user).
#
# Prerequisites:
#   - /opt/music-platform is a git clone with SSH remote (deploy key)
#   - .env and secrets/ exist locally (never in git)
#
# Usage:
#   cd /opt/music-platform
#   bash scripts/vps-git-deploy.sh              # deploy origin/main
#   bash scripts/vps-git-deploy.sh --sha abc123 # deploy exact commit
#   bash scripts/vps-git-deploy.sh --pull-only  # git only, no docker
#
# Optional cron (every 15 min — only if you accept auto-deploy risk):
#   */15 * * * * cd /opt/music-platform && bash scripts/vps-git-deploy.sh >> /var/log/earflow-deploy.log 2>&1

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BRANCH="${EARFLOW_DEPLOY_BRANCH:-main}"
PULL_ONLY=0
PIN_SHA=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pull-only) PULL_ONLY=1; shift ;;
    --sha) PIN_SHA="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-main}"; shift 2 ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ ! -d .git ]]; then
  echo "FAIL: $ROOT is not a git repository" >&2
  exit 1
fi

ENV_BACKUP=""
SECRETS_BACKUP=""
if [[ -f .env ]]; then
  ENV_BACKUP="$(mktemp)"
  cp .env "$ENV_BACKUP"
fi
if [[ -d secrets ]]; then
  SECRETS_BACKUP="$(mktemp -d)"
  cp -a secrets/. "$SECRETS_BACKUP/"
fi

echo "==> git fetch origin"
git fetch origin

if [[ -n "$PIN_SHA" ]]; then
  echo "==> checkout pinned SHA: $PIN_SHA"
  git checkout -f "$PIN_SHA"
else
  echo "==> checkout origin/$BRANCH"
  git checkout -f "$BRANCH"
  git reset --hard "origin/$BRANCH"
fi

if [[ -n "$ENV_BACKUP" && -f "$ENV_BACKUP" ]]; then
  cp "$ENV_BACKUP" .env
  rm -f "$ENV_BACKUP"
fi
if [[ -n "$SECRETS_BACKUP" && -d "$SECRETS_BACKUP" ]]; then
  mkdir -p secrets
  cp -a "$SECRETS_BACKUP/." secrets/
  rm -rf "$SECRETS_BACKUP"
fi

echo "==> deployed commit: $(git rev-parse HEAD) ($(git log -1 --oneline))"

if [[ "$PULL_ONLY" -eq 1 ]]; then
  echo "==> --pull-only: skipping docker rebuild"
  exit 0
fi

echo "==> docker compose build (frontend nginx api-gateway security-service)"
docker compose -f docker-compose.yml build frontend nginx api-gateway security-service

echo "==> docker compose up"
docker compose -f docker-compose.yml up -d --force-recreate frontend nginx api-gateway security-service

echo "==> nginx -t"
docker compose -f docker-compose.yml run --rm --no-deps nginx nginx -t

echo "==> bundle hashes"
curl -sS https://earflow.ru/ | grep -oE 'main\.[a-f0-9]+\.js' | head -1 || true
curl -sS https://auth.earflow.ru/ | grep -oE 'main\.[a-f0-9]+\.js' | head -1 || true

echo "==> done"
