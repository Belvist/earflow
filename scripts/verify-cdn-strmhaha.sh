#!/usr/bin/env bash
# Verify strmhaha HLS CDN cache path: health, signed cache route, playlist no-store.
# Default: strmhaha direct (no CDN). When Timeweb CDN is on, set:
#   STRMHAHA_ORIGIN=https://origin.strmhaha.earflow.ru  (A → VPS, CDN pull)
#   STRMHAHA_PUBLIC=https://strmhaha.earflow.ru         (CNAME → CDN)
set -euo pipefail

ORIGIN="${STRMHAHA_ORIGIN:-https://strmhaha.earflow.ru}"
PUBLIC="${STRMHAHA_PUBLIC:-https://strmhaha.earflow.ru}"

echo "== origin health (${ORIGIN}) =="
curl -fsS -o /dev/null -w "origin nginx-health: %{http_code}\n" "${ORIGIN}/nginx-health"

echo "== public health (${PUBLIC}) =="
curl -fsS -o /dev/null -w "public nginx-health: %{http_code}\n" "${PUBLIC}/nginx-health" || \
  echo "WARN: public health failed (CDN/DNS not wired yet?)"

echo "== cache path rejects unsigned request =="
status="$(curl -s -o /dev/null -w "%{http_code}" "${PUBLIC}/audio/v3/cache/1/testhash1/aac_128/seg_00001.m4s" || true)"
if [[ "${status}" == "403" || "${status}" == "404" ]]; then
  echo "unsigned cache URL blocked: ${status} (ok)"
else
  echo "FAIL: expected 403/404 for unsigned cache URL, got ${status}"
  exit 1
fi

echo "== playlists remain no-store (requires auth) =="
headers="$(curl -sI "${PUBLIC}/audio/v3/tracks/1/master.m3u8" || true)"
if echo "${headers}" | grep -qi 'cache-control:.*no-store'; then
  echo "playlist no-store header present (ok)"
else
  echo "WARN: playlist did not return Cache-Control no-store (may be 401/404 without session)"
fi

echo "PASS: strmhaha cache route OK. Play a track; segment URLs should use /audio/v3/cache/ with exp&sig."
