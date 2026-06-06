#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
GENERATED="${GENERATED_COMPOSE:-docker-compose.scalable.generated.json}"
LOCAL_EDGE_URL="${LOCAL_EDGE_URL:-http://127.0.0.1:8085}"

status() {
  cd "$ROOT_DIR"
  if [ -f "$GENERATED" ]; then
    docker compose -f "$GENERATED" ps api-gateway nginx
  else
    docker compose ps api-gateway nginx
  fi

  printf '\nHealth via nginx: %s/health\n' "$LOCAL_EDGE_URL"
  curl -fsS "$LOCAL_EDGE_URL/health" || true
  printf '\nVersion via nginx: %s/api/version\n' "$LOCAL_EDGE_URL"
  curl -fsS "$LOCAL_EDGE_URL/api/version" || true
  printf '\n'
}

logs() {
  cd "$ROOT_DIR"
  docker ps \
    --filter "label=com.docker.compose.service=api-gateway" \
    --format '{{.Names}}' \
    | while IFS= read -r name; do
        [ -n "$name" ] || continue
        printf '\n=== %s ===\n' "$name"
        docker logs "$name" --tail 40 2>&1 || true
      done

  printf '\n=== nginx ===\n'
  docker logs music-nginx-lb --tail 40 2>&1 || true
}

scale() {
  count="$1"
  case "$count" in
    *[!0-9]*|'')
      echo "Replica count must be a positive integer." >&2
      exit 1
      ;;
  esac
  if [ "$count" -lt 1 ]; then
    echo "Replica count must be >= 1." >&2
    exit 1
  fi

  cd "$ROOT_DIR"
  ./scripts/scale-stateless.sh "api-gateway=$count"
}

case "${1:-status}" in
  status)
    status
    ;;
  logs)
    logs
    ;;
  help|--help|-h)
    cat <<'USAGE'
Usage:
  ./scripts/scale-gateway.sh status
  ./scripts/scale-gateway.sh logs
  ./scripts/scale-gateway.sh 4

The scale command delegates to scripts/scale-stateless.sh and uses the generated
scalable compose file. Gateway health is checked through nginx, not localhost:3000.
USAGE
    ;;
  *)
    scale "$1"
    ;;
esac
