#!/usr/bin/env bash
set -euo pipefail

# P0 recovery drill wrapper.
# Creates fresh PostgreSQL and MinIO backups, verifies them, then restores them
# into isolated temporary containers. This script must not restore into prod.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

RUN_POSTGRES="${RUN_POSTGRES:-true}"
RUN_MINIO="${RUN_MINIO:-true}"

log() {
    echo "[critical-backup-drill] $*"
}

fail() {
    echo "[critical-backup-drill] ERROR: $*" >&2
    exit 1
}

latest_file() {
    local dir="$1"
    local pattern="$2"
    find "${dir}" -type f -name "${pattern}" ! -name '*.sha256' 2>/dev/null | sort | tail -1
}

run_postgres_drill() {
    log "Creating PostgreSQL daily backup"
    "${PROJECT_DIR}/scripts/backup-postgres.sh" daily

    local latest
    latest="$(latest_file "${PROJECT_DIR}/backups/postgres" '*.sql.gz*')"
    [[ -n "${latest}" ]] || fail "PostgreSQL backup was not created"

    log "Verifying PostgreSQL backup: ${latest}"
    "${PROJECT_DIR}/scripts/backup-postgres.sh" verify "${latest}"

    log "Restoring PostgreSQL backup into isolated drill container"
    "${PROJECT_DIR}/scripts/drill-postgres-restore.sh" "${latest}"
}

run_minio_drill() {
    log "Creating MinIO snapshot backup"
    "${PROJECT_DIR}/scripts/backup-minio.sh" snapshot

    local latest
    latest="$(latest_file "${PROJECT_DIR}/backups/minio" '*.tar.gz')"
    [[ -n "${latest}" ]] || fail "MinIO backup was not created"

    log "Verifying MinIO backup: ${latest}"
    "${PROJECT_DIR}/scripts/backup-minio.sh" verify "${latest}"

    log "Restoring MinIO backup into isolated drill container"
    "${PROJECT_DIR}/scripts/drill-minio-restore.sh" "${latest}"
}

cd "${PROJECT_DIR}"

if [[ "${RUN_POSTGRES}" == "true" ]]; then
    run_postgres_drill
else
    log "Skipping PostgreSQL drill because RUN_POSTGRES=${RUN_POSTGRES}"
fi

if [[ "${RUN_MINIO}" == "true" ]]; then
    run_minio_drill
else
    log "Skipping MinIO drill because RUN_MINIO=${RUN_MINIO}"
fi

log "P0 backup/restore drill passed"
