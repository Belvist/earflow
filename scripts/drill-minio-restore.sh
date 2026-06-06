#!/bin/bash
# Isolated MinIO restore drill. Restores a MinIO backup archive into a temporary
# MinIO container and verifies that bucket contents are readable.

set -euo pipefail

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
fail() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [[ -f "${PROJECT_DIR}/.env" ]]; then
    set -a
    source "${PROJECT_DIR}/.env"
    set +a
fi

BACKUP_DIR="${BACKUP_DIR:-${PROJECT_DIR}/backups/minio}"
MINIO_ROOT_USER="${MINIO_ROOT_USER:-minioadmin}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-}"
DRILL_NAME="${MINIO_DRILL_NAME:-music-minio-restore-drill-$(date '+%Y%m%d%H%M%S')}"
DRILL_IMAGE="${MINIO_DRILL_IMAGE:-minio/minio:RELEASE.2025-01-20T14-49-07Z}"
MC_IMAGE="${MINIO_MC_IMAGE:-minio/mc:RELEASE.2025-01-17T23-25-50Z}"
DRILL_VOLUME="${DRILL_NAME}-data"
KEEP_DRILL="${KEEP_RESTORE_DRILL:-false}"

latest_backup() {
    find "${BACKUP_DIR}" -type f -name '*.tar.gz' -printf '%T@ %p\n' 2>/dev/null \
        | sort -nr \
        | awk 'NR==1 {print substr($0, index($0,$2))}'
}

BACKUP_FILE="${1:-$(latest_backup)}"
[[ -n "${BACKUP_FILE}" ]] || fail "No MinIO backup archive found under ${BACKUP_DIR}"
[[ -f "${BACKUP_FILE}" ]] || fail "Backup file not found: ${BACKUP_FILE}"
[[ -n "${MINIO_ROOT_PASSWORD}" ]] || fail "MINIO_ROOT_PASSWORD is not set"

TEMP_DIR="$(mktemp -d)"
RESTORE_DIR="${TEMP_DIR}/restore"

cleanup() {
    rm -rf "${TEMP_DIR}" || true
    if [[ "${KEEP_DRILL}" != "true" ]]; then
        docker rm -f "${DRILL_NAME}" >/dev/null 2>&1 || true
        docker volume rm "${DRILL_VOLUME}" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT

if [[ -f "${BACKUP_FILE}.sha256" ]]; then
    log "Verifying checksum"
    (cd "$(dirname "${BACKUP_FILE}")" && sha256sum -c "$(basename "${BACKUP_FILE}.sha256")" --status) \
        || fail "Checksum verification failed"
fi

log "Validating archive structure"
tar -tzf "${BACKUP_FILE}" >/dev/null || fail "Backup archive is not readable"
mkdir -p "${RESTORE_DIR}"
tar -xzf "${BACKUP_FILE}" -C "${RESTORE_DIR}"

EXTRACTED_DIR="$(find "${RESTORE_DIR}" -mindepth 1 -maxdepth 1 -type d | head -1)"
[[ -n "${EXTRACTED_DIR}" ]] || fail "Archive does not contain a restore directory"

log "Starting isolated MinIO container ${DRILL_NAME}"
docker volume create "${DRILL_VOLUME}" >/dev/null
docker run -d --rm \
    --name "${DRILL_NAME}" \
    -e MINIO_ROOT_USER="${MINIO_ROOT_USER}" \
    -e MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD}" \
    -v "${DRILL_VOLUME}:/data" \
    "${DRILL_IMAGE}" server /data --address ":9000" >/dev/null

for _ in $(seq 1 60); do
    if docker run --rm --network "container:${DRILL_NAME}" "${MC_IMAGE}" \
        alias set drill http://127.0.0.1:9000 "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}" >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

docker run --rm --network "container:${DRILL_NAME}" "${MC_IMAGE}" \
    alias set drill http://127.0.0.1:9000 "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}" >/dev/null 2>&1 \
    || fail "Drill MinIO did not become ready"

RESTORED_BUCKETS=0
RESTORED_FILES=0

for bucket_dir in "${EXTRACTED_DIR}"/*; do
    [[ -d "${bucket_dir}" ]] || continue
    bucket="$(basename "${bucket_dir}")"
    files="$(find "${bucket_dir}" -type f | wc -l | tr -d ' ')"

    log "Restoring bucket ${bucket} (${files} files)"
    docker run --rm \
        --network "container:${DRILL_NAME}" \
        -v "${bucket_dir}:/restore:ro" \
        --entrypoint /bin/sh \
        "${MC_IMAGE}" -c \
        "mc alias set drill http://127.0.0.1:9000 '${MINIO_ROOT_USER}' '${MINIO_ROOT_PASSWORD}' >/dev/null && mc mb --ignore-existing drill/'${bucket}' >/dev/null && mc mirror --overwrite /restore drill/'${bucket}' >/dev/null"

    docker run --rm --network "container:${DRILL_NAME}" --entrypoint /bin/sh "${MC_IMAGE}" -c \
        "mc alias set drill http://127.0.0.1:9000 '${MINIO_ROOT_USER}' '${MINIO_ROOT_PASSWORD}' >/dev/null && mc ls --recursive drill/'${bucket}' >/dev/null" \
        || fail "Restored bucket is not readable: ${bucket}"

    RESTORED_BUCKETS=$((RESTORED_BUCKETS + 1))
    RESTORED_FILES=$((RESTORED_FILES + files))
done

[[ "${RESTORED_BUCKETS}" -gt 0 ]] || fail "No bucket directories were restored"

log "MinIO restore drill passed: ${RESTORED_BUCKETS} buckets, ${RESTORED_FILES} files"
if [[ "${KEEP_DRILL}" == "true" ]]; then
    log "Keeping drill container ${DRILL_NAME} and volume ${DRILL_VOLUME}"
fi
