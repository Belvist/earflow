#!/bin/sh
set -eu

js_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

BOT_USERNAME="${EARFLOW_TELEGRAM_BOT_USERNAME:-}"
BOT_USERNAME_ESC="$(js_escape "$BOT_USERNAME")"

API_BASE_URL="${EARFLOW_API_BASE_URL:-}"
API_BASE_URL_ESC="$(js_escape "$API_BASE_URL")"

STREAMING_BASE_URL="${EARFLOW_STREAMING_BASE_URL:-}"
STREAMING_BASE_URL_ESC="$(js_escape "$STREAMING_BASE_URL")"

ENABLE_DIRECT_STREAM="${EARFLOW_ENABLE_DIRECT_STREAM:-${REACT_APP_ENABLE_DIRECT_STREAM:-}}"
ENABLE_DIRECT_STREAM_ESC="$(js_escape "$ENABLE_DIRECT_STREAM")"

cat > /tmp/runtime-config.js <<EOF
window.__EARFLOW_RUNTIME_CONFIG__ = Object.freeze({
  telegramBotUsername: "${BOT_USERNAME_ESC}",
  apiBaseUrl: "${API_BASE_URL_ESC}",
  streamingBaseUrl: "${STREAMING_BASE_URL_ESC}",
  enableDirectStream: "${ENABLE_DIRECT_STREAM_ESC}"
});
EOF
