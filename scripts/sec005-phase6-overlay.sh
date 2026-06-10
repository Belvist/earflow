#!/usr/bin/env bash
# Enable/disable auto-merge of SEC-005 Phase 6 overlay via docker-compose.override.yml symlink.
#
# Docker Compose always merges docker-compose.override.yml — survives plain `docker compose up`.

sec005_phase6_overlay_path() {
  local root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
  printf '%s/docker-compose.override.yml' "$root"
}

sec005_phase6_overlay_enable() {
  local root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
  local link target
  link="$(sec005_phase6_overlay_path "$root")"
  target="$root/docker-compose.stream-prod-accept.yml"
  if [[ ! -f "$target" ]]; then
    echo "FAIL: missing $target" >&2
    return 1
  fi
  ln -sf "docker-compose.stream-prod-accept.yml" "$link"
  echo "[sec005-phase6] enabled docker-compose.override.yml → stream-prod-accept"
}

sec005_phase6_overlay_disable() {
  local root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
  local link
  link="$(sec005_phase6_overlay_path "$root")"
  if [[ -L "$link" ]]; then
    rm -f "$link"
    echo "[sec005-phase6] removed docker-compose.override.yml symlink"
  elif [[ -f "$link" ]]; then
    echo "WARN: $link exists and is not our symlink — not removed" >&2
    return 1
  fi
  return 0
}

sec005_phase6_overlay_active() {
  local root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
  local link
  link="$(sec005_phase6_overlay_path "$root")"
  [[ -L "$link" ]] && [[ "$(readlink "$link")" == *stream-prod-accept.yml ]]
}
