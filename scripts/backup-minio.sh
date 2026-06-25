#!/bin/bash
# =============================================================================
# MinIO Automated Backup Script
# Music Platform - Object Storage Backup with Incremental Sync
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
BACKUP_DIR="${BACKUP_DIR:-${PROJECT_DIR}/backups/minio}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

# Load environment
if [[ -f "${PROJECT_DIR}/.env" ]]; then
    set -a
    source "${PROJECT_DIR}/.env"
    set +a
fi

# MinIO configuration
MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://minio:9000}"
MINIO_ACCESS_KEY="${MINIO_ROOT_USER:-minioadmin}"
MINIO_SECRET_KEY="${MINIO_ROOT_PASSWORD:-}"
MINIO_CONTAINER="${MINIO_CONTAINER:-music-minio}"
MINIO_ALIAS="music-backup"

# Buckets to backup. Override with MINIO_BACKUP_BUCKETS="bucket-a,bucket-b".
BUCKETS_RAW="${MINIO_BACKUP_BUCKETS:-${MINIO_BUCKET_AUDIO:-music-audio},${MINIO_BUCKET_COVERS:-music-covers},${EBAP_MINIO_BUCKET:-ebap-cache},${EBAP_HLS_MINIO_BUCKET:-ebap-hls}}"
IFS=',' read -r -a BUCKETS <<< "$BUCKETS_RAW"

# Remote backup settings
REMOTE_BACKUP="${REMOTE_BACKUP:-false}"
REMOTE_S3_BUCKET="${REMOTE_S3_BUCKET:-}"
REMOTE_S3_REGION="${REMOTE_S3_REGION:-us-east-1}"

# Validate configuration
validate_config() {
    if [[ -z "$MINIO_SECRET_KEY" ]]; then
        log_error "MINIO_ROOT_PASSWORD is not set"
        exit 1
    fi
    
    # Check if MinIO container is running
    if ! docker ps --format '{{.Names}}' | grep -q "^${MINIO_CONTAINER}$"; then
        log_error "MinIO container '${MINIO_CONTAINER}' is not running"
        exit 1
    fi
}

# Setup directories
setup_directories() {
    mkdir -p "${BACKUP_DIR}/snapshots"
    mkdir -p "${BACKUP_DIR}/incremental"
    mkdir -p "${PROJECT_DIR}/logs"
    chmod 700 "${BACKUP_DIR}"
}

# Configure MinIO client
setup_mc() {
    log_info "Configuring MinIO client..."
    
    # Use docker to run mc commands
    docker run --rm \
        --network music-platform_default \
        -e MC_HOST_${MINIO_ALIAS}="${MINIO_ENDPOINT/http:\/\//http://${MINIO_ACCESS_KEY}:${MINIO_SECRET_KEY}@}" \
        minio/mc:latest \
        alias set "$MINIO_ALIAS" "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" \
        2>/dev/null || true
}

# Create snapshot backup (full copy)
create_snapshot() {
    local timestamp=$(date '+%Y%m%d_%H%M%S')
    local snapshot_dir="${BACKUP_DIR}/snapshots/${timestamp}"
    
    log_info "Creating snapshot backup: ${timestamp}"
    mkdir -p "$snapshot_dir"
    
    for bucket in "${BUCKETS[@]}"; do
        log_info "Backing up bucket: ${bucket}"
        local bucket_dir="${snapshot_dir}/${bucket}"
        mkdir -p "$bucket_dir"
        
        # Use mc mirror to copy all objects
        docker run --rm \
            --network music-platform_default \
            -v "${bucket_dir}:/backup" \
            minio/mc:latest \
            mirror --overwrite \
            "http://${MINIO_ACCESS_KEY}:${MINIO_SECRET_KEY}@minio:9000/${bucket}" \
            "/backup/" 2>&1 | while read -r line; do
                echo "  $line"
            done
        
        # Count files
        local file_count=$(find "$bucket_dir" -type f 2>/dev/null | wc -l)
        local total_size=$(du -sh "$bucket_dir" 2>/dev/null | cut -f1)
        log_success "Bucket ${bucket}: ${file_count} files, ${total_size}"
    done
    
    # Create manifest
    local manifest="${snapshot_dir}/manifest.json"
    cat > "$manifest" << EOF
{
    "timestamp": "${timestamp}",
    "type": "snapshot",
    "buckets": $(printf '%s\n' "${BUCKETS[@]}" | jq -R . | jq -s .),
    "created_at": "$(date -Iseconds)",
    "host": "$(hostname)"
}
EOF
    
    # Compress snapshot
    log_info "Compressing snapshot..."
    local archive="${BACKUP_DIR}/snapshots/minio_snapshot_${timestamp}.tar.gz"
    tar -czf "$archive" -C "${BACKUP_DIR}/snapshots" "${timestamp}"
    rm -rf "$snapshot_dir"
    
    # Calculate checksum
    sha256sum "$archive" > "${archive}.sha256"
    
    local archive_size=$(du -h "$archive" | cut -f1)
    log_success "Snapshot created: $(basename "$archive") (${archive_size})"
    
    echo "$archive"
}

# Create incremental backup (changes only)
create_incremental() {
    local timestamp=$(date '+%Y%m%d_%H%M%S')
    local incremental_dir="${BACKUP_DIR}/incremental/${timestamp}"
    local last_backup_marker="${BACKUP_DIR}/.last_incremental"
    
    log_info "Creating incremental backup: ${timestamp}"
    mkdir -p "$incremental_dir"
    
    # Get last backup time
    local newer_than=""
    if [[ -f "$last_backup_marker" ]]; then
        newer_than=$(cat "$last_backup_marker")
        log_info "Finding changes since: ${newer_than}"
    fi
    
    local total_files=0
    
    for bucket in "${BUCKETS[@]}"; do
        log_info "Scanning bucket: ${bucket}"
        local bucket_dir="${incremental_dir}/${bucket}"
        mkdir -p "$bucket_dir"
        
        # Use mc mirror with newer-than filter
        if [[ -n "$newer_than" ]]; then
            docker run --rm \
                --network music-platform_default \
                -v "${bucket_dir}:/backup" \
                minio/mc:latest \
                mirror --newer-than "${newer_than}" \
                "http://${MINIO_ACCESS_KEY}:${MINIO_SECRET_KEY}@minio:9000/${bucket}" \
                "/backup/" 2>&1 || true
        else
            docker run --rm \
                --network music-platform_default \
                -v "${bucket_dir}:/backup" \
                minio/mc:latest \
                mirror --overwrite \
                "http://${MINIO_ACCESS_KEY}:${MINIO_SECRET_KEY}@minio:9000/${bucket}" \
                "/backup/" 2>&1 || true
        fi
        
        local file_count=$(find "$bucket_dir" -type f 2>/dev/null | wc -l)
        total_files=$((total_files + file_count))
        log_info "Bucket ${bucket}: ${file_count} changed files"
    done
    
    if [[ $total_files -eq 0 ]]; then
        log_info "No changes detected, skipping archive creation"
        rm -rf "$incremental_dir"
        return 0
    fi
    
    # Create manifest
    local manifest="${incremental_dir}/manifest.json"
    cat > "$manifest" << EOF
{
    "timestamp": "${timestamp}",
    "type": "incremental",
    "since": "${newer_than:-initial}",
    "buckets": $(printf '%s\n' "${BUCKETS[@]}" | jq -R . | jq -s .),
    "file_count": ${total_files},
    "created_at": "$(date -Iseconds)"
}
EOF
    
    # Compress
    log_info "Compressing incremental backup..."
    local archive="${BACKUP_DIR}/incremental/minio_incremental_${timestamp}.tar.gz"
    tar -czf "$archive" -C "${BACKUP_DIR}/incremental" "${timestamp}"
    rm -rf "$incremental_dir"
    
    # Update last backup marker
    echo "$timestamp" > "$last_backup_marker"
    
    # Calculate checksum
    sha256sum "$archive" > "${archive}.sha256"
    
    local archive_size=$(du -h "$archive" | cut -f1)
    log_success "Incremental backup created: $(basename "$archive") (${archive_size})"
    
    echo "$archive"
}

# Sync to remote S3
sync_to_remote() {
    local backup_file="$1"
    
    if [[ "$REMOTE_BACKUP" != "true" ]] || [[ -z "$REMOTE_S3_BUCKET" ]]; then
        return 0
    fi
    
    log_info "Syncing to remote S3..."
    
    local s3_path="s3://${REMOTE_S3_BUCKET}/minio-backups/$(basename "$backup_file")"
    aws s3 cp "$backup_file" "$s3_path" --region "$REMOTE_S3_REGION"
    aws s3 cp "${backup_file}.sha256" "${s3_path}.sha256" --region "$REMOTE_S3_REGION"
    
    log_success "Synced to remote S3"
}

# Restore from backup
restore_backup() {
    local backup_file="$1"
    local target_bucket="${2:-}"
    
    if [[ ! -f "$backup_file" ]]; then
        log_error "Backup file not found: $backup_file"
        exit 1
    fi
    
    log_warn "This will restore objects to MinIO!"
    read -p "Are you sure? (yes/no): " confirm
    if [[ "$confirm" != "yes" ]]; then
        log_info "Restore cancelled"
        exit 0
    fi
    
    local temp_dir=$(mktemp -d)
    
    log_info "Extracting backup..."
    tar -xzf "$backup_file" -C "$temp_dir"
    
    # Find extracted directory
    local extracted_dir=$(find "$temp_dir" -mindepth 1 -maxdepth 1 -type d | head -1)
    
    for bucket_dir in "${extracted_dir}"/*/; do
        local bucket=$(basename "$bucket_dir")
        
        if [[ -n "$target_bucket" ]] && [[ "$bucket" != "$target_bucket" ]]; then
            continue
        fi
        
        log_info "Restoring bucket: ${bucket}"
        
        # Upload objects back to MinIO
        docker run --rm \
            --network music-platform_default \
            -v "${bucket_dir}:/restore:ro" \
            minio/mc:latest \
            mirror --overwrite \
            "/restore/" \
            "http://${MINIO_ACCESS_KEY}:${MINIO_SECRET_KEY}@minio:9000/${bucket}" 2>&1
        
        log_success "Bucket ${bucket} restored"
    done
    
    rm -rf "$temp_dir"
    log_success "Restore completed"
}

# Cleanup old backups
cleanup_old_backups() {
    log_info "Cleaning up old backups..."
    
    # Remove old snapshots
    find "${BACKUP_DIR}/snapshots" -name "*.tar.gz" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true
    find "${BACKUP_DIR}/snapshots" -name "*.sha256" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true
    
    # Remove old incrementals (keep more)
    find "${BACKUP_DIR}/incremental" -name "*.tar.gz" -mtime +$((RETENTION_DAYS * 2)) -delete 2>/dev/null || true
    find "${BACKUP_DIR}/incremental" -name "*.sha256" -mtime +$((RETENTION_DAYS * 2)) -delete 2>/dev/null || true
    
    log_success "Cleanup completed"
}

# List backups
list_backups() {
    echo ""
    echo "=== MinIO Backups ==="
    echo ""
    
    echo "--- Snapshots ---"
    ls -lh "${BACKUP_DIR}/snapshots/"*.tar.gz 2>/dev/null || echo "  No snapshots found"
    echo ""
    
    echo "--- Incremental ---"
    ls -lh "${BACKUP_DIR}/incremental/"*.tar.gz 2>/dev/null | tail -10 || echo "  No incremental backups found"
    echo ""
}

# Verify backup
verify_backup() {
    local backup_file="$1"
    local checksum_file="${backup_file}.sha256"
    
    if [[ ! -f "$checksum_file" ]]; then
        log_error "Checksum file not found"
        exit 1
    fi
    
    log_info "Verifying backup integrity..."
    
    if sha256sum -c "$checksum_file" --status; then
        log_success "Backup integrity verified"
        
        # Also verify tar archive
        if tar -tzf "$backup_file" > /dev/null 2>&1; then
            log_success "Archive structure verified"
            return 0
        else
            log_error "Archive structure verification FAILED"
            return 1
        fi
    else
        log_error "Checksum verification FAILED"
        return 1
    fi
}

# Get bucket statistics
get_stats() {
    log_info "MinIO Bucket Statistics"
    echo ""
    
    for bucket in "${BUCKETS[@]}"; do
        echo "=== Bucket: ${bucket} ==="
        docker run --rm \
            --network music-platform_default \
            minio/mc:latest \
            stat "http://${MINIO_ACCESS_KEY}:${MINIO_SECRET_KEY}@minio:9000/${bucket}" 2>/dev/null || echo "  Unable to get stats"
        echo ""
    done
}

# Main execution
main() {
    local command="${1:-snapshot}"
    
    case "$command" in
        snapshot)
            validate_config
            setup_directories
            backup_file=$(create_snapshot)
            sync_to_remote "$backup_file"
            cleanup_old_backups
            ;;
        incremental)
            validate_config
            setup_directories
            backup_file=$(create_incremental)
            [[ -n "$backup_file" ]] && sync_to_remote "$backup_file"
            cleanup_old_backups
            ;;
        restore)
            if [[ -z "${2:-}" ]]; then
                log_error "Usage: $0 restore <backup_file> [bucket]"
                exit 1
            fi
            validate_config
            restore_backup "$2" "${3:-}"
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
        stats)
            validate_config
            get_stats
            ;;
        *)
            echo "MinIO Backup Tool"
            echo ""
            echo "Usage: $0 <command> [args]"
            echo ""
            echo "Commands:"
            echo "  snapshot     - Create full snapshot backup"
            echo "  incremental  - Create incremental backup (changes only)"
            echo "  restore      - Restore from backup file"
            echo "  list         - List available backups"
            echo "  verify       - Verify backup integrity"
            echo "  stats        - Show bucket statistics"
            echo ""
            echo "Environment variables:"
            echo "  MINIO_ROOT_PASSWORD  - MinIO password (required)"
            echo "  BACKUP_DIR           - Backup directory"
            echo "  RETENTION_DAYS       - Days to keep backups (default: 30)"
            echo "  REMOTE_BACKUP        - Sync to remote S3 (default: false)"
            exit 1
            ;;
    esac
}

main "$@"
