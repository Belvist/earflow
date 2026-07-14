#!/usr/bin/env bash
# Read one env var from a compose service (handles scaled replicas).
#
# Usage:
#   compose_read_service_env api-gateway STREAM_TICKET_ENABLED docker compose -f ...
# Prints value to stdout; exit 0 on success, 1 if no containers, 2 if replica mismatch.

compose_read_service_env() {
  local service="$1"
  local varname="$2"
  shift 2
  local compose=("$@")
  local ids id val first="" count=0

  ids="$("${compose[@]}" ps -q "$service" 2>/dev/null || true)"
  if [[ -z "$ids" ]]; then
    return 1
  fi

  while read -r id; do
    [[ -z "$id" ]] && continue
    val="$(docker exec "$id" printenv "$varname" 2>/dev/null | tr -d '\r' || true)"
    count=$((count + 1))
    if [[ "$count" -eq 1 ]]; then
      first="$val"
    elif [[ "$val" != "$first" ]]; then
      printf 'MISMATCH:%s' "$val"
      return 2
    fi
  done <<< "$ids"

  printf '%s' "$first"
  return 0
}
