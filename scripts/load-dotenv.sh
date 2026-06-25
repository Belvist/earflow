#!/usr/bin/env bash
# BOM-safe .env loader for bash rollout scripts (no eval, no source of whole file).
# Usage: source scripts/load-dotenv.sh && load_dotenv "/path/to/.env"
load_dotenv() {
  local file="${1:-.env}"
  if [[ ! -f "$file" ]]; then
    echo "load_dotenv: missing $file" >&2
    return 1
  fi
  local line key val
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    key="${line%%=*}"
    val="${line#*=}"
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    # Strip UTF-8 BOM if present on first key
    key="${key//$'\ufeff'/}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    export "${key}=${val}"
  done < <(sed '1s/^\xEF\xBB\xBF//' "$file")
}
