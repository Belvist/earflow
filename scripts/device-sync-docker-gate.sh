#!/usr/bin/env bash
set -euo pipefail

ACCOUNTS="${DEVICE_SYNC_TEST_ACCOUNTS:-10}"
DEVICES="${DEVICE_SYNC_TEST_DEVICES:-5}"
TRANSFERS="${DEVICE_SYNC_TEST_TRANSFERS:-10}"
CONCURRENCY="${DEVICE_SYNC_TEST_CONCURRENCY:-5}"
TIMEOUT="${DEVICE_SYNC_TEST_TIMEOUT:-2m}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --accounts|-accounts)
      ACCOUNTS="${2:?missing value for $1}"
      shift 2
      ;;
    --devices|-devices)
      DEVICES="${2:?missing value for $1}"
      shift 2
      ;;
    --transfers|-transfers)
      TRANSFERS="${2:?missing value for $1}"
      shift 2
      ;;
    --concurrency|-concurrency)
      CONCURRENCY="${2:?missing value for $1}"
      shift 2
      ;;
    --timeout|-timeout)
      TIMEOUT="${2:?missing value for $1}"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export DEVICE_SYNC_ENABLED="${DEVICE_SYNC_ENABLED:-true}"
export DEVICE_SYNC_TEST_ACCOUNTS="$ACCOUNTS"
export DEVICE_SYNC_TEST_DEVICES="$DEVICES"
export DEVICE_SYNC_TEST_TRANSFERS="$TRANSFERS"
export DEVICE_SYNC_TEST_CONCURRENCY="$CONCURRENCY"
export DEVICE_SYNC_TEST_TIMEOUT="$TIMEOUT"

docker compose up -d --build redis auth-service device-sync-service
docker compose --profile device-sync-test run --rm device-sync-stress
