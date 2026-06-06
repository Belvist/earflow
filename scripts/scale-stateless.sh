#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
GENERATED="${GENERATED_COMPOSE:-docker-compose.scalable.generated.json}"

if [ "$#" -eq 0 ]; then
  cat <<'USAGE'
Usage:
  ./scripts/scale-stateless.sh service=count [service=count ...]

Examples:
  ./scripts/scale-stateless.sh api-gateway=4 frontend=2
  ./scripts/scale-stateless.sh api-gateway=6 auth-service=3 database-service=3

Notes:
  This script generates docker-compose.scalable.generated.json from the current
  compose config and removes fixed container_name from scalable stateless services.
  Set COMPOSE_FILES=docker-compose.yml:docker-compose.pgbouncer.yml to enable
  the optional PgBouncer layer before scaling app services.
USAGE
  exit 1
fi

case " $* " in
  *"postgres="*|*"redis="*|*"redis-auth="*|*"minio="*|*"meilisearch="*|*"nats="*|*"nginx="*|*"pgbouncer="*|*"certbot="*|*"nginx-cert-reloader="*|*"minio-init="*|*"portainer="*|*"pgadmin="*|*"track-processor="*|*"audio-features-worker="*|*"reco-offline-worker="*|*"reco-feedback-loadgen="*|*"integration-tests="*|*"upload-service-tests="*)
    echo "Refusing to scale stateful/edge services with this script." >&2
    exit 1
    ;;
esac

cd "$ROOT_DIR"
./scripts/render-scalable-compose.sh "$GENERATED"

SCALE_ARGS=""
for pair in "$@"; do
  service="${pair%%=*}"
  count="${pair#*=}"
  if [ "$service" = "$count" ] || [ -z "$service" ] || [ -z "$count" ]; then
    echo "Invalid scale argument: $pair. Expected service=count." >&2
    exit 1
  fi
  case "$count" in
    *[!0-9]*|'')
      echo "Invalid replica count in: $pair" >&2
      exit 1
      ;;
  esac
  if [ "$count" -lt 1 ]; then
    echo "Replica count must be >= 1 in: $pair" >&2
    exit 1
  fi
  SCALE_ARGS="$SCALE_ARGS --scale $service=$count"
done

# shellcheck disable=SC2086
docker compose -f "$GENERATED" up -d $SCALE_ARGS

if docker ps --filter "name=music-nginx-lb" --format '{{.Names}}' | grep -q '^music-nginx-lb$'; then
  docker exec music-nginx-lb nginx -s reload >/dev/null 2>&1 || true
fi

docker compose -f "$GENERATED" ps
