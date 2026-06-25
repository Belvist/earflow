#!/usr/bin/env bash
# Align remote `frontend` branch to `main` after merge (same tree, one prod SHA).
# Usage: bash scripts/sync-git-branches.sh
# If trees differ: set FORCE_SYNC=1 to push anyway (review diff first).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

git fetch origin

MAIN_SHA="$(git rev-parse origin/main)"
FRONT_SHA="$(git rev-parse origin/frontend)"

echo "origin/main:     $MAIN_SHA"
echo "origin/frontend: $FRONT_SHA"

if git diff --quiet origin/main origin/frontend; then
  echo "Trees identical — syncing refs."
else
  echo "WARNING: origin/main and origin/frontend differ:"
  git diff --stat origin/main origin/frontend
  if [[ "${FORCE_SYNC:-}" != "1" ]]; then
    echo "Merge or reconcile first, or rerun with FORCE_SYNC=1"
    exit 1
  fi
fi

git push origin "main:frontend"
git fetch origin

echo "Synced. origin/frontend = $(git rev-parse origin/frontend)"
