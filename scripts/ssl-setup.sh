#!/bin/bash
# =============================================================================
# SSL Certificate Setup with Let's Encrypt
# Music Platform - Production SSL Configuration
# =============================================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Configuration
DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
STAGING="${STAGING:-false}"
USE_HOST_LETSENCRYPT="${USE_HOST_LETSENCRYPT:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SSL_DIR="${PROJECT_DIR}/nginx/ssl"
COMPOSE_PROJECT_NAME_EFFECTIVE="${COMPOSE_PROJECT_NAME:-$(basename "$PROJECT_DIR")}"

if [[ -z "$USE_HOST_LETSENCRYPT" ]]; then
    if [[ -w /etc/letsencrypt ]] && [[ -w /var/lib/letsencrypt ]] && [[ -w /var/log/letsencrypt ]]; then
        USE_HOST_LETSENCRYPT="true"
    else
        USE_HOST_LETSENCRYPT="false"
    fi
fi

CERTBOT_ETC_DIR="${CERTBOT_ETC_DIR:-}"
CERTBOT_VAR_DIR="${CERTBOT_VAR_DIR:-}"
CERTBOT_LOG_DIR="${CERTBOT_LOG_DIR:-}"

if [[ "$USE_HOST_LETSENCRYPT" == "true" ]]; then
    CERTBOT_ETC_DIR="${CERTBOT_ETC_DIR:-/etc/letsencrypt}"
    CERTBOT_VAR_DIR="${CERTBOT_VAR_DIR:-/var/lib/letsencrypt}"
    CERTBOT_LOG_DIR="${CERTBOT_LOG_DIR:-/var/log/letsencrypt}"
else
    CERTBOT_ETC_DIR="${CERTBOT_ETC_DIR:-${PROJECT_DIR}/certbot/conf}"
    CERTBOT_VAR_DIR="${CERTBOT_VAR_DIR:-${PROJECT_DIR}/certbot/var}"
    CERTBOT_LOG_DIR="${CERTBOT_LOG_DIR:-${PROJECT_DIR}/certbot/logs}"
fi

# Validate inputs
validate_inputs() {
    if [[ -z "$DOMAIN" ]]; then
        log_error "DOMAIN environment variable is required"
        echo "Usage: DOMAIN=your-domain.com EMAIL=your@email.com ./ssl-setup.sh"
        exit 1
    fi
    
    if [[ -z "$EMAIL" ]]; then
        log_error "EMAIL environment variable is required"
        exit 1
    fi
    
    # Validate email format
    if ! [[ "$EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
        log_error "Invalid email format: $EMAIL"
        exit 1
    fi
    
    log_info "Domain: $DOMAIN"
    log_info "Email: $EMAIL"
    log_info "Staging: $STAGING"
}

# Create directories
setup_directories() {
    log_info "Setting up directories..."
    
    mkdir -p "$SSL_DIR"
    mkdir -p "$CERTBOT_ETC_DIR"
    mkdir -p "$CERTBOT_VAR_DIR"
    mkdir -p "$CERTBOT_LOG_DIR"
    
    chmod 700 "$SSL_DIR"
    
    log_success "Directories created"
}

# Generate DH parameters
generate_dhparam() {
    local dhparam_file="${SSL_DIR}/dhparam.pem"
    
    if [[ -f "$dhparam_file" ]]; then
        log_info "DH parameters already exist"
        return 0
    fi
    
    log_info "Generating DH parameters (this may take a few minutes)..."
    openssl dhparam -out "$dhparam_file" 2048
    chmod 600 "$dhparam_file"
    
    log_success "DH parameters generated"
}

# Generate self-signed certificate for initial setup
generate_self_signed() {
    local cert_file="${SSL_DIR}/fullchain.pem"
    local key_file="${SSL_DIR}/privkey.pem"
    
    if [[ -f "$cert_file" ]] && [[ -f "$key_file" ]]; then
        log_info "Certificates already exist, skipping self-signed generation"
        return 0
    fi
    
    log_info "Generating self-signed certificate for initial setup..."
    
    openssl req -x509 -nodes -newkey rsa:4096 \
        -keyout "$key_file" \
        -out "$cert_file" \
        -days 30 \
        -subj "/C=US/ST=State/L=City/O=Organization/CN=$DOMAIN" \
        2>/dev/null
    
    chmod 600 "$key_file"
    chmod 644 "$cert_file"
    
    log_success "Self-signed certificate generated"
}

# Request Let's Encrypt certificate
request_letsencrypt() {
    log_info "Requesting Let's Encrypt certificate..."
    
    local staging_arg=""
    if [[ "$STAGING" == "true" ]]; then
        staging_arg="--staging"
        log_warn "Using staging environment (certificates will not be trusted)"
    fi
    
    # Request certificate using webroot mode (no nginx downtime)
    docker run --rm \
        -v "${CERTBOT_ETC_DIR}:/etc/letsencrypt" \
        -v "${CERTBOT_VAR_DIR}:/var/lib/letsencrypt" \
        -v "${CERTBOT_LOG_DIR}:/var/log/letsencrypt" \
        -v "${COMPOSE_PROJECT_NAME_EFFECTIVE}_certbot-webroot:/var/www/certbot" \
        certbot/certbot certonly \
        --webroot \
        --webroot-path /var/www/certbot \
        --non-interactive \
        --agree-tos \
        --email "$EMAIL" \
        --domain "$DOMAIN" \
        --domain "www.$DOMAIN" \
        --domain "api.$DOMAIN" \
        --domain "auth.$DOMAIN" \
        $staging_arg \
        --force-renewal
    
    if [[ "$USE_HOST_LETSENCRYPT" == "true" ]]; then
        log_success "Let's Encrypt certificate installed in ${CERTBOT_ETC_DIR}/live/${DOMAIN}"
    else
        # Copy certificates to nginx ssl directory for local/dev setups
        local cert_src="${CERTBOT_ETC_DIR}/live/${DOMAIN}"
        if [[ -d "$cert_src" ]]; then
            cp -L "${cert_src}/fullchain.pem" "${SSL_DIR}/fullchain.pem"
            cp -L "${cert_src}/privkey.pem" "${SSL_DIR}/privkey.pem"
            chmod 644 "${SSL_DIR}/fullchain.pem"
            chmod 600 "${SSL_DIR}/privkey.pem"
            log_success "Let's Encrypt certificate installed"
        else
            log_error "Certificate directory not found: $cert_src"
            exit 1
        fi
    fi
    
    if docker compose -f "${PROJECT_DIR}/docker-compose.yml" ps nginx 1>/dev/null 2>/dev/null; then
        docker compose -f "${PROJECT_DIR}/docker-compose.yml" exec nginx nginx -s reload 2>/dev/null || true
    else
        docker compose -f "${PROJECT_DIR}/docker-compose.yml" start nginx 2>/dev/null || true
    fi
}

# Setup auto-renewal cron job
setup_auto_renewal() {
    log_info "Setting up auto-renewal..."
    
    local renewal_script="${SCRIPT_DIR}/ssl-renew.sh"
    
    cat > "$renewal_script" << 'RENEWAL_EOF'
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
RENEWAL_EOF
    
    chmod +x "$renewal_script"
    
    # Add cron job (requires sudo)
    local cron_entry="0 3 * * * ${renewal_script} >> ${PROJECT_DIR}/logs/ssl-renewal.log 2>&1"
    
    log_info "To enable auto-renewal, add this to your crontab (crontab -e):"
    echo ""
    echo "  $cron_entry"
    echo ""
    
    log_success "Auto-renewal script created: $renewal_script"
}

# Main execution
main() {
    log_info "=== SSL Certificate Setup ==="
    
    validate_inputs
    setup_directories
    generate_dhparam
    
    if [[ "${SELF_SIGNED:-false}" == "true" ]]; then
        generate_self_signed
        log_warn "Using self-signed certificate (for development only)"
    else
        generate_self_signed  # Initial placeholder
        log_info "Starting Let's Encrypt certificate request..."
        request_letsencrypt
        setup_auto_renewal
    fi
    
    log_success "=== SSL Setup Complete ==="
    log_info "Certificate location: ${SSL_DIR}"
    log_info "You can now start nginx with SSL enabled"
}

# Handle command line arguments
case "${1:-setup}" in
    setup)
        main
        ;;
    renew)
        request_letsencrypt
        ;;
    self-signed)
        SELF_SIGNED=true main
        ;;
    *)
        echo "Usage: $0 {setup|renew|self-signed}"
        echo ""
        echo "Environment variables:"
        echo "  DOMAIN    - Your domain name (required)"
        echo "  EMAIL     - Email for Let's Encrypt notifications (required)"
        echo "  STAGING   - Use Let's Encrypt staging (default: false)"
        exit 1
        ;;
esac
