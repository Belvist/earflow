#!/usr/bin/env bash
# SEC-005 prod overlay — docker-compose.override.yml symlink (accept | enforce).

sec005_prod_overlay_path() {
  local root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
  printf '%s/docker-compose.override.yml' "$root"
}

sec005_prod_overlay_target_file() {
  local mode="$1"
  case "$mode" in
    accept) printf '%s' "docker-compose.stream-prod-accept.yml" ;;
    enforce) printf '%s' "docker-compose.stream-prod-enforce.yml" ;;
    *)
      echo "unknown sec005 overlay mode: $mode" >&2
      return 1
      ;;
  esac
}

sec005_prod_overlay_enable() {
  local root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
  local mode="${2:-accept}"
  local link target_file target
  target_file="$(sec005_prod_overlay_target_file "$mode")" || return 1
  target="$root/$target_file"
  link="$(sec005_prod_overlay_path "$root")"
  if [[ ! -f "$target" ]]; then
    echo "FAIL: missing $target" >&2
    return 1
  fi
  ln -sf "$target_file" "$link"
  echo "[sec005-prod] enabled docker-compose.override.yml → ${target_file}"
}

sec005_prod_overlay_disable() {
  local root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
  local link
  link="$(sec005_prod_overlay_path "$root")"
  if [[ -L "$link" ]]; then
    rm -f "$link"
    echo "[sec005-prod] removed docker-compose.override.yml symlink"
  elif [[ -f "$link" ]]; then
    echo "WARN: $link exists and is not our symlink — not removed" >&2
    return 1
  fi
  return 0
}

sec005_prod_overlay_active_mode() {
  local root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
  local link target
  link="$(sec005_prod_overlay_path "$root")"
  if [[ ! -L "$link" ]]; then
    printf '%s' "none"
    return 0
  fi
  target="$(readlink "$link" 2>/dev/null || true)"
  case "$target" in
    *stream-prod-enforce.yml) printf '%s' "enforce" ;;
    *stream-prod-accept.yml) printf '%s' "accept" ;;
    *) printf '%s' "unknown" ;;
  esac
}

# Back-compat aliases (Phase 6 scripts)
sec005_phase6_overlay_enable() { sec005_prod_overlay_enable "$1" accept; }
sec005_phase6_overlay_disable() { sec005_prod_overlay_disable "$1"; }
sec005_phase6_overlay_active() {
  [[ "$(sec005_prod_overlay_active_mode "$1")" == "accept" ]]
}
