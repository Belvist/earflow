#!/usr/bin/env bash
# Register auth-e2e test user via real gateway login path (idempotent).
set -euo pipefail

BASE="${AUTH_E2E_BASE_URL:-http://127.0.0.1:18080}"
ORIGIN="${AUTH_E2E_ORIGIN:-$BASE}"
EMAIL="${AUTH_E2E_EMAIL:?AUTH_E2E_EMAIL required}"
PASSWORD="${AUTH_E2E_PASSWORD:?AUTH_E2E_PASSWORD required}"
USERNAME="${AUTH_E2E_USERNAME:-pope2e}"

payload=$(printf '{"email":"%s","password":"%s","username":"%s"}' "$EMAIL" "$PASSWORD" "$USERNAME")

echo "[auth-e2e-bootstrap] register $EMAIL (ignore if exists)"

reg_code=$(curl -sS -o /tmp/auth-e2e-register.json -w "%{http_code}" \
  -X POST "$BASE/api/auth/email/register" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d "$payload" || echo "000")

if [[ "$reg_code" == "200" || "$reg_code" == "201" ]]; then
  echo "[auth-e2e-bootstrap] registered"
elif [[ "$reg_code" == "409" || "$reg_code" == "400" ]]; then
  echo "[auth-e2e-bootstrap] register skipped (likely exists): HTTP $reg_code"
else
  echo "[auth-e2e-bootstrap] register HTTP $reg_code:" >&2
  cat /tmp/auth-e2e-register.json >&2 || true
  echo >&2
fi

login_wait="${AUTH_E2E_LOGIN_WAIT_SECONDS:-180}"
login_deadline=$((SECONDS + login_wait))
login_code="000"

while (( SECONDS < login_deadline )); do
  login_code=$(curl -sS -D /tmp/auth-e2e-login-headers.txt -o /tmp/auth-e2e-login.json -w "%{http_code}" \
    -X POST "$BASE/api/auth/email/login" \
    -H "Content-Type: application/json" \
    -H "Origin: $ORIGIN" \
    -c /tmp/auth-e2e-cookies.txt \
    -d "$(printf '{"email":"%s","password":"%s"}' "$EMAIL" "$PASSWORD")" || echo "000")

  if [[ "$login_code" == "200" ]]; then
    break
  fi

  case "$login_code" in
    502|503|504|000)
      echo "[auth-e2e-bootstrap] login probe HTTP $login_code — retry..." >&2
      sleep 3
      ;;
    *)
      echo "[auth-e2e-bootstrap] login probe FAILED HTTP $login_code" >&2
      cat /tmp/auth-e2e-login.json >&2 || true
      exit 1
      ;;
  esac
done

if [[ "$login_code" != "200" ]]; then
  echo "[auth-e2e-bootstrap] login probe TIMEOUT after ${login_wait}s (last HTTP $login_code)" >&2
  cat /tmp/auth-e2e-login.json >&2 || true
  exit 1
fi

if ! awk -F'\t' '$6=="mp_sid" { found=1 } END { exit found ? 0 : 1 }' /tmp/auth-e2e-cookies.txt 2>/dev/null; then
  echo "[auth-e2e-bootstrap] login probe: mp_sid missing in cookie jar" >&2
  echo "[auth-e2e-bootstrap] Set-Cookie headers:" >&2
  grep -i '^set-cookie:' /tmp/auth-e2e-login-headers.txt >&2 || echo "(none)" >&2
  echo "[auth-e2e-bootstrap] Fix: COOKIE_DOMAIN=host (empty + NODE_ENV=production => Domain=.earflow.ru)" >&2
  exit 1
fi

if awk -F'\t' '$6=="mp_sid" && toupper($4)=="TRUE" { exit 0 } END { exit 1 }' /tmp/auth-e2e-cookies.txt 2>/dev/null; then
  echo "[auth-e2e-bootstrap] mp_sid is Secure — set COOKIE_SECURE=false and recreate api-gateway." >&2
  exit 1
fi

if grep -i '^set-cookie:.*mp_sid=.*[Dd]omain=\.earflow' /tmp/auth-e2e-login-headers.txt >/dev/null 2>&1; then
  echo "[auth-e2e-bootstrap] mp_sid uses Domain=.earflow.ru — wrong for http://127.0.0.1 e2e." >&2
  exit 1
fi

echo "[auth-e2e-bootstrap] login probe OK (mp_sid host-compatible)"
