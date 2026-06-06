#!/bin/bash
# Isolated PostgreSQL restore drill. Restores a backup into a temporary
# pgvector container and validates that key product tables are readable.

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

BACKUP_DIR="${BACKUP_DIR:-${PROJECT_DIR}/backups/postgres}"
ENCRYPTION_KEY_FILE="${ENCRYPTION_KEY_FILE:-${PROJECT_DIR}/secrets/backup.key}"
DB_NAME="${POSTGRES_DB:-${DB_NAME:-music_platform}}"
DB_USER="${POSTGRES_USER:-${DB_USER:-music_user}}"
DB_PASSWORD="${POSTGRES_PASSWORD:-${DB_PASSWORD:-}}"
DRILL_IMAGE="${POSTGRES_DRILL_IMAGE:-pgvector/pgvector:pg15}"
DRILL_NAME="${POSTGRES_DRILL_NAME:-music-postgres-restore-drill-$(date '+%Y%m%d%H%M%S')}"
DRILL_VOLUME="${DRILL_NAME}-data"
KEEP_DRILL="${KEEP_RESTORE_DRILL:-false}"

latest_backup() {
    find "${BACKUP_DIR}" -type f \( -name '*.sql.gz' -o -name '*.sql.gz.enc' \) -printf '%T@ %p\n' 2>/dev/null \
        | sort -nr \
        | awk 'NR==1 {print substr($0, index($0,$2))}'
}

BACKUP_FILE="${1:-$(latest_backup)}"
[[ -n "${BACKUP_FILE}" ]] || fail "No backup file found under ${BACKUP_DIR}"
[[ -f "${BACKUP_FILE}" ]] || fail "Backup file not found: ${BACKUP_FILE}"
[[ -n "${DB_PASSWORD}" ]] || fail "DB_PASSWORD/POSTGRES_PASSWORD is not set"

TEMP_DIR="$(mktemp -d)"
SQL_FILE="${TEMP_DIR}/restore.sql"

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

log "Preparing SQL from $(basename "${BACKUP_FILE}")"
if [[ "${BACKUP_FILE}" == *.enc ]]; then
    [[ -f "${ENCRYPTION_KEY_FILE}" ]] || fail "Encryption key not found: ${ENCRYPTION_KEY_FILE}"
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 \
        -in "${BACKUP_FILE}" \
        -out "${TEMP_DIR}/restore.sql.gz" \
        -pass "file:${ENCRYPTION_KEY_FILE}"
    gunzip -c "${TEMP_DIR}/restore.sql.gz" > "${SQL_FILE}"
elif [[ "${BACKUP_FILE}" == *.gz ]]; then
    gunzip -c "${BACKUP_FILE}" > "${SQL_FILE}"
else
    cp "${BACKUP_FILE}" "${SQL_FILE}"
fi

log "Starting isolated PostgreSQL container ${DRILL_NAME}"
docker volume create "${DRILL_VOLUME}" >/dev/null
docker run -d --rm \
    --name "${DRILL_NAME}" \
    -e POSTGRES_DB="${DB_NAME}" \
    -e POSTGRES_USER="${DB_USER}" \
    -e POSTGRES_PASSWORD="${DB_PASSWORD}" \
    -v "${DRILL_VOLUME}:/var/lib/postgresql/data" \
    "${DRILL_IMAGE}" >/dev/null

for _ in $(seq 1 60); do
    if docker exec -e PGPASSWORD="${DB_PASSWORD}" "${DRILL_NAME}" \
        pg_isready -h localhost -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

docker exec -e PGPASSWORD="${DB_PASSWORD}" "${DRILL_NAME}" \
    pg_isready -h localhost -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1 \
    || fail "Drill PostgreSQL did not become ready"

log "Restoring backup into isolated PostgreSQL"
docker exec -i -e PGPASSWORD="${DB_PASSWORD}" "${DRILL_NAME}" \
    psql -h localhost -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1 < "${SQL_FILE}" >/dev/null

log "Validating restored schema and data"
docker exec -e PGPASSWORD="${DB_PASSWORD}" "${DRILL_NAME}" \
    psql -h localhost -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1 <<'SQL'
SELECT table_name
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('users', 'songs', 'playlists', 'subscription_plans', 'subscriptions')
 ORDER BY table_name;
DO $$
BEGIN
  IF to_regclass('public.songs') IS NULL THEN
    RAISE EXCEPTION 'missing songs table';
  END IF;
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'missing users table';
  END IF;
END $$;
SELECT 'songs' AS table_name, COUNT(*) AS rows FROM songs;
SELECT 'users' AS table_name, COUNT(*) AS rows FROM users;
SQL

log "PostgreSQL restore drill passed"
if [[ "${KEEP_DRILL}" == "true" ]]; then
    log "Keeping drill container ${DRILL_NAME} and volume ${DRILL_VOLUME}"
fi
