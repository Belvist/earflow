#!/bin/bash
# =============================================================================
# PostgreSQL Automated Backup Script
# Music Platform - Production Database Backup with Encryption
# =============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"; }
log_success() { echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"; }
log_error() { echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1" >&2; }

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${BACKUP_DIR:-${PROJECT_DIR}/backups/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
RETENTION_WEEKLY="${RETENTION_WEEKLY:-12}"
RETENTION_MONTHLY="${RETENTION_MONTHLY:-12}"

# Database configuration (from .env or environment)
if [[ -f "${PROJECT_DIR}/.env" ]]; then
    set -a
    source "${PROJECT_DIR}/.env"
    set +a
fi

DB_HOST="${POSTGRES_HOST:-${DB_HOST:-postgres}}"
DB_PORT="${POSTGRES_PORT:-${DB_PORT:-5432}}"
DB_NAME="${POSTGRES_DB:-${DB_NAME:-music_platform}}"
DB_USER="${POSTGRES_USER:-${DB_USER:-music_user}}"
DB_PASSWORD="${POSTGRES_PASSWORD:-${DB_PASSWORD:-}}"
CONTAINER_NAME="${POSTGRES_CONTAINER:-music-postgres}"

# Encryption settings
ENCRYPT_BACKUPS="${ENCRYPT_BACKUPS:-true}"
ENCRYPTION_KEY_FILE="${ENCRYPTION_KEY_FILE:-${PROJECT_DIR}/secrets/backup.key}"

# S3/MinIO settings for remote backup
REMOTE_BACKUP="${REMOTE_BACKUP:-false}"
S3_BUCKET="${BACKUP_S3_BUCKET:-}"
S3_ENDPOINT="${MINIO_ENDPOINT:-}"

# Notification settings
SLACK_WEBHOOK="${SLACK_WEBHOOK:-}"
EMAIL_NOTIFY="${EMAIL_NOTIFY:-}"

# Validate configuration
validate_config() {
    if [[ -z "$DB_PASSWORD" ]]; then
        log_error "POSTGRES_PASSWORD is not set"
        exit 1
    fi
    
    # Check if container is running
    if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        log_error "PostgreSQL container '${CONTAINER_NAME}' is not running"
        exit 1
    fi
}

# Setup directories
setup_directories() {
    mkdir -p "${BACKUP_DIR}/daily"
    mkdir -p "${BACKUP_DIR}/weekly"
    mkdir -p "${BACKUP_DIR}/monthly"
    mkdir -p "${PROJECT_DIR}/logs"
    
    chmod 700 "${BACKUP_DIR}"
}

# Generate encryption key if needed
setup_encryption() {
    if [[ "$ENCRYPT_BACKUPS" != "true" ]]; then
        return 0
    fi
    
    local key_dir=$(dirname "$ENCRYPTION_KEY_FILE")
    mkdir -p "$key_dir"
    chmod 700 "$key_dir"
    
    if [[ ! -f "$ENCRYPTION_KEY_FILE" ]]; then
        log_info "Generating new encryption key..."
        openssl rand -base64 32 > "$ENCRYPTION_KEY_FILE"
        chmod 600 "$ENCRYPTION_KEY_FILE"
        log_warn "IMPORTANT: Backup your encryption key: $ENCRYPTION_KEY_FILE"
        log_warn "Without this key, encrypted backups cannot be restored!"
    fi
}

# Create backup
create_backup() {
    local backup_type="$1"
    local timestamp=$(date '+%Y%m%d_%H%M%S')
    local backup_name="music_platform_${backup_type}_${timestamp}"
    local backup_file="${BACKUP_DIR}/${backup_type}/${backup_name}.sql"
    local compressed_file="${backup_file}.gz"
    local final_file="$compressed_file"
    
    log_info "Creating ${backup_type} backup: ${backup_name}"
    
    # Create database dump using docker exec
    PGPASSWORD="$DB_PASSWORD" docker exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
        pg_dump -h localhost -U "$DB_USER" -d "$DB_NAME" \
        --format=plain \
        --no-owner \
        --no-privileges \
        --clean \
        --if-exists \
        --verbose 2>/dev/null > "$backup_file"
    
    # Compress
    log_info "Compressing backup..."
    gzip -9 "$backup_file"
    
    # Encrypt if enabled
    if [[ "$ENCRYPT_BACKUPS" == "true" ]]; then
        log_info "Encrypting backup..."
        local encrypted_file="${compressed_file}.enc"
        openssl enc -aes-256-cbc -salt -pbkdf2 -iter 100000 \
            -in "$compressed_file" \
            -out "$encrypted_file" \
            -pass "file:${ENCRYPTION_KEY_FILE}"
        rm "$compressed_file"
        final_file="$encrypted_file"
    fi
    
    # Calculate checksum
    local checksum_file="${final_file}.sha256"
    sha256sum "$final_file" > "$checksum_file"
    
    # Get file size
    local file_size=$(du -h "$final_file" | cut -f1)
    
    log_success "Backup created: $(basename "$final_file") (${file_size})"
    
    # Upload to remote storage if enabled
    if [[ "$REMOTE_BACKUP" == "true" ]] && [[ -n "$S3_BUCKET" ]]; then
        upload_to_remote "$final_file" "$checksum_file" "$backup_type"
    fi
    
    echo "$final_file"
}

# Upload to S3/MinIO
upload_to_remote() {
    local backup_file="$1"
    local checksum_file="$2"
    local backup_type="$3"
    
    log_info "Uploading to remote storage..."
    
    local s3_path="s3://${S3_BUCKET}/postgres/${backup_type}/$(basename "$backup_file")"
    local s3_checksum_path="s3://${S3_BUCKET}/postgres/${backup_type}/$(basename "$checksum_file")"
    
    # Use mc (MinIO Client) if endpoint is specified, otherwise aws cli
    if [[ -n "$S3_ENDPOINT" ]]; then
        docker run --rm \
            -v "$(dirname "$backup_file"):/backup:ro" \
            --network music-platform_default \
            minio/mc:latest \
            cp "/backup/$(basename "$backup_file")" "minio/${S3_BUCKET}/postgres/${backup_type}/"
    else
        aws s3 cp "$backup_file" "$s3_path"
        aws s3 cp "$checksum_file" "$s3_checksum_path"
    fi
    
    log_success "Uploaded to remote storage"
}

# Cleanup old backups
cleanup_old_backups() {
    log_info "Cleaning up old backups..."
    
    # Daily backups - keep last N days
    find "${BACKUP_DIR}/daily" -type f -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true
    
    # Weekly backups - keep last N weeks
    find "${BACKUP_DIR}/weekly" -type f -mtime +$((RETENTION_WEEKLY * 7)) -delete 2>/dev/null || true
    
    # Monthly backups - keep last N months
    find "${BACKUP_DIR}/monthly" -type f -mtime +$((RETENTION_MONTHLY * 30)) -delete 2>/dev/null || true
    
    log_success "Cleanup completed"
}

# Restore from backup
restore_backup() {
    local backup_file="$1"
    
    if [[ ! -f "$backup_file" ]]; then
        log_error "Backup file not found: $backup_file"
        exit 1
    fi
    
    log_warn "This will overwrite the current database!"
    read -p "Are you sure? (yes/no): " confirm
    if [[ "$confirm" != "yes" ]]; then
        log_info "Restore cancelled"
        exit 0
    fi
    
    local temp_file=$(mktemp)
    
    # Decrypt if encrypted
    if [[ "$backup_file" == *.enc ]]; then
        log_info "Decrypting backup..."
        openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 \
            -in "$backup_file" \
            -out "${temp_file}.gz" \
            -pass "file:${ENCRYPTION_KEY_FILE}"
        backup_file="${temp_file}.gz"
    fi
    
    # Decompress
    log_info "Decompressing backup..."
    gunzip -c "$backup_file" > "${temp_file}.sql"
    
    # Restore
    log_info "Restoring database..."
    PGPASSWORD="$DB_PASSWORD" docker exec -i -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
        psql -h localhost -U "$DB_USER" -d "$DB_NAME" < "${temp_file}.sql"
    
    # Cleanup temp files
    rm -f "${temp_file}" "${temp_file}.gz" "${temp_file}.sql"
    
    log_success "Database restored successfully"
}

# List available backups
list_backups() {
    echo ""
    echo "=== Available Backups ==="
    echo ""
    
    for type in daily weekly monthly; do
        echo "--- ${type^} Backups ---"
        if ls "${BACKUP_DIR}/${type}"/*.enc 2>/dev/null | head -10; then
            :
        elif ls "${BACKUP_DIR}/${type}"/*.gz 2>/dev/null | head -10; then
            :
        else
            echo "  No backups found"
        fi
        echo ""
    done
}

# Verify backup integrity
verify_backup() {
    local backup_file="$1"
    local checksum_file="${backup_file}.sha256"
    
    if [[ ! -f "$checksum_file" ]]; then
        log_error "Checksum file not found: $checksum_file"
        exit 1
    fi
    
    log_info "Verifying backup integrity..."
    
    if sha256sum -c "$checksum_file" --status; then
        log_success "Backup integrity verified"
        return 0
    else
        log_error "Backup integrity check FAILED!"
        return 1
    fi
}

# Send notification
send_notification() {
    local status="$1"
    local message="$2"
    
    # Slack notification
    if [[ -n "$SLACK_WEBHOOK" ]]; then
        local color="good"
        [[ "$status" == "error" ]] && color="danger"
        
        curl -s -X POST "$SLACK_WEBHOOK" \
            -H 'Content-Type: application/json' \
            -d "{\"attachments\":[{\"color\":\"${color}\",\"title\":\"PostgreSQL Backup\",\"text\":\"${message}\"}]}" \
            >/dev/null 2>&1 || true
    fi
}

# Main execution
main() {
    local command="${1:-daily}"
    
    case "$command" in
        daily)
            validate_config
            setup_directories
            setup_encryption
            backup_file=$(create_backup "daily")
            cleanup_old_backups
            send_notification "success" "Daily backup completed: $(basename "$backup_file")"
            ;;
        weekly)
            validate_config
            setup_directories
            setup_encryption
            backup_file=$(create_backup "weekly")
            cleanup_old_backups
            send_notification "success" "Weekly backup completed: $(basename "$backup_file")"
            ;;
        monthly)
            validate_config
            setup_directories
            setup_encryption
            backup_file=$(create_backup "monthly")
            cleanup_old_backups
            send_notification "success" "Monthly backup completed: $(basename "$backup_file")"
            ;;
        restore)
            if [[ -z "${2:-}" ]]; then
                log_error "Usage: $0 restore <backup_file>"
                exit 1
            fi
            validate_config
            setup_encryption
            restore_backup "$2"
            ;;
        list)
            list_backups
            ;;
        verify)
            if [[ -z "${2:-}" ]]; then
                log_error "Usage: $0 verify <backup_file>"
                exit 1
            fi
            verify_backup "$2"
            ;;
        *)
            echo "PostgreSQL Backup Tool"
            echo ""
            echo "Usage: $0 <command> [args]"
            echo ""
            echo "Commands:"
            echo "  daily     - Create daily backup"
            echo "  weekly    - Create weekly backup"
            echo "  monthly   - Create monthly backup"
            echo "  restore   - Restore from backup file"
            echo "  list      - List available backups"
            echo "  verify    - Verify backup integrity"
            echo ""
            echo "Environment variables:"
            echo "  POSTGRES_PASSWORD   - Database password (required)"
            echo "  BACKUP_DIR          - Backup directory (default: ./backups/postgres)"
            echo "  RETENTION_DAYS      - Days to keep daily backups (default: 30)"
            echo "  ENCRYPT_BACKUPS     - Encrypt backups (default: true)"
            echo "  REMOTE_BACKUP       - Upload to S3/MinIO (default: false)"
            exit 1
            ;;
    esac
}

main "$@"
