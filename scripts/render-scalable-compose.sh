#!/usr/bin/env sh
set -eu

OUT="${1:-docker-compose.scalable.generated.json}"
COMPOSE_FILES="${COMPOSE_FILES:-docker-compose.yml}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

set -- docker compose
old_ifs="$IFS"
IFS=':'
for compose_file in $COMPOSE_FILES; do
  [ -n "$compose_file" ] || continue
  set -- "$@" -f "$compose_file"
done
IFS="$old_ifs"

if command -v node >/dev/null 2>&1; then
  "$@" config --format json | node scripts/render-scalable-compose.js > "$OUT"
else
  "$@" config --format json | docker run --rm -i \
    -v "$ROOT_DIR/scripts:/scripts:ro" \
    node:22-alpine node /scripts/render-scalable-compose.js > "$OUT"
fi

docker compose -f "$OUT" config >/dev/null
printf '%s\n' "Generated $OUT from $COMPOSE_FILES"
