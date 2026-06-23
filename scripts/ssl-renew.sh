#!/bin/bash
# SSL Certificate Auto-Renewal Script

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DOMAIN="${DOMAIN:-}"
USE_HOST_LETSENCRYPT="${USE_HOST_LETSENCRYPT:-}"

if [[ -z "$USE_HOST_LETSENCRYPT" ]]; then
    if [[ -w /etc/letsencrypt ]] && [[ -w /var/lib/letsencrypt ]] && [[ -w /var/log/letsencrypt ]]; then
        USE_HOST_LETSENCRYPT="true"
    else
        USE_HOST_LETSENCRYPT="false"
    fi
fi

if [[ "$USE_HOST_LETSENCRYPT" == "true" ]]; then
    CERTBOT_ETC_DIR="${CERTBOT_ETC_DIR:-/etc/letsencrypt}"
    CERTBOT_VAR_DIR="${CERTBOT_VAR_DIR:-/var/lib/letsencrypt}"
    CERTBOT_LOG_DIR="${CERTBOT_LOG_DIR:-/var/log/letsencrypt}"
    CERT_FILE="${CERTBOT_ETC_DIR}/live/${DOMAIN}/fullchain.pem"
else
    CERTBOT_ETC_DIR="${CERTBOT_ETC_DIR:-${PROJECT_DIR}/certbot/conf}"
    CERTBOT_VAR_DIR="${CERTBOT_VAR_DIR:-${PROJECT_DIR}/certbot/var}"
    CERTBOT_LOG_DIR="${CERTBOT_LOG_DIR:-${PROJECT_DIR}/certbot/logs}"
    CERT_FILE="${PROJECT_DIR}/nginx/ssl/fullchain.pem"
fi

# Check if renewal is needed (30 days before expiry)
if ! openssl x509 -checkend 2592000 -noout -in "${CERT_FILE}" 2>/dev/null; then
    echo "[$(date)] Certificate renewal needed"
    
    docker run --rm \
        -v "${CERTBOT_ETC_DIR}:/etc/letsencrypt" \
        -v "${CERTBOT_VAR_DIR}:/var/lib/letsencrypt" \
        -v "${CERTBOT_LOG_DIR}:/var/log/letsencrypt" \
        certbot/certbot renew --quiet
    
    if [[ "$USE_HOST_LETSENCRYPT" != "true" ]]; then
        cert_src="${CERTBOT_ETC_DIR}/live/${DOMAIN}"
        if [[ -d "$cert_src" ]]; then
            cp -L "${cert_src}/fullchain.pem" "${PROJECT_DIR}/nginx/ssl/fullchain.pem"
            cp -L "${cert_src}/privkey.pem" "${PROJECT_DIR}/nginx/ssl/privkey.pem"
            chmod 644 "${PROJECT_DIR}/nginx/ssl/fullchain.pem"
            chmod 600 "${PROJECT_DIR}/nginx/ssl/privkey.pem"
        fi
    fi
    
    # Reload nginx
    docker compose -f "${PROJECT_DIR}/docker-compose.yml" exec nginx nginx -s reload
    
    echo "[$(date)] Certificate renewed successfully"
else
    echo "[$(date)] Certificate is still valid"
fi
