#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_URL="${PARTY_STATE_URL:-http://localhost:3130}"
WS_URL="${PARTY_WS_URL:-ws://localhost:3131/ws/v2}"
ROOMS="${PARTY_TEST_ROOMS:-2}"
GUESTS="${PARTY_TEST_GUESTS:-4}"
UPDATES="${PARTY_TEST_UPDATES:-8}"
CONCURRENCY="${PARTY_TEST_CONCURRENCY:-2}"
TIMEOUT="${PARTY_TEST_TIMEOUT:-90s}"
STEP_TIMEOUT="${PARTY_TEST_STEP_TIMEOUT:-6s}"
THINK="${PARTY_TEST_THINK:-80ms}"
VERBOSE="${PARTY_TEST_VERBOSE:-false}"
MODE="${PARTY_TEST_MODE:-auto}"

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

http_ok() {
  local url="$1"
  if has_cmd curl; then
    curl -fsS --max-time 2 "$url" >/dev/null 2>&1
    return $?
  fi
  if has_cmd wget; then
    wget -qO- --timeout=2 "$url" >/dev/null 2>&1
    return $?
  fi
  return 1
}

compose_network() {
  local cid network
  cid="$(cd "$ROOT" && docker compose ps -q party-state-service 2>/dev/null | head -n 1 || true)"
  if [[ -z "$cid" ]]; then
    return 1
  fi
  network="$(docker inspect "$cid" --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' 2>/dev/null | head -n 1 || true)"
  if [[ -z "$network" ]]; then
    return 1
  fi
  printf '%s\n' "$network"
}

run_direct() {
  cd "$ROOT/backend/party-go"
  go run ./cmd/party-smoke-load \
    -state-url "$STATE_URL" \
    -ws-url "$WS_URL" \
    -rooms "$ROOMS" \
    -guests "$GUESTS" \
    -updates "$UPDATES" \
    -concurrency "$CONCURRENCY" \
    -timeout "$TIMEOUT" \
    -step-timeout "$STEP_TIMEOUT" \
    -think "$THINK" \
    $(if [[ "$VERBOSE" == "1" || "$VERBOSE" == "true" ]]; then printf -- "-v"; fi)
}

run_docker_network() {
  local network
  if ! has_cmd docker; then
    echo "Docker is required for PARTY_TEST_MODE=docker" >&2
    exit 2
  fi
  network="$(compose_network)" || {
    echo "Cannot find compose network from party-state-service." >&2
    echo "Start services first: docker compose up -d party-state-service party-gateway-service" >&2
    exit 2
  }

  docker run --rm \
    --network "$network" \
    -v "$ROOT/backend/party-go:/work" \
    -w /work \
    -e PARTY_TEST_ROOMS="$ROOMS" \
    -e PARTY_TEST_GUESTS="$GUESTS" \
    -e PARTY_TEST_UPDATES="$UPDATES" \
    -e PARTY_TEST_CONCURRENCY="$CONCURRENCY" \
    -e PARTY_TEST_TIMEOUT="$TIMEOUT" \
    -e PARTY_TEST_STEP_TIMEOUT="$STEP_TIMEOUT" \
    -e PARTY_TEST_THINK="$THINK" \
    -e PARTY_TEST_VERBOSE="$VERBOSE" \
    golang:1.22-alpine \
    sh -lc 'go run ./cmd/party-smoke-load \
      -state-url http://party-state-service:3130 \
      -ws-url ws://party-gateway-service:3131/ws/v2 \
      -rooms "$PARTY_TEST_ROOMS" \
      -guests "$PARTY_TEST_GUESTS" \
      -updates "$PARTY_TEST_UPDATES" \
      -concurrency "$PARTY_TEST_CONCURRENCY" \
      -timeout "$PARTY_TEST_TIMEOUT" \
      -step-timeout "$PARTY_TEST_STEP_TIMEOUT" \
      -think "$PARTY_TEST_THINK" \
      $(if [ "$PARTY_TEST_VERBOSE" = "1" ] || [ "$PARTY_TEST_VERBOSE" = "true" ]; then printf -- "-v"; fi)'
}

case "$MODE" in
  direct)
    run_direct
    ;;
  docker)
    run_docker_network
    ;;
  auto)
    if http_ok "$STATE_URL/health"; then
      run_direct
    else
      echo "party-state is not reachable at $STATE_URL/health; running smoke test inside compose network." >&2
      run_docker_network
    fi
    ;;
  *)
    echo "Unknown PARTY_TEST_MODE=$MODE. Use auto, direct, or docker." >&2
    exit 2
    ;;
esac
