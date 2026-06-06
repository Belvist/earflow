#!/usr/bin/env sh
set -eu

: "${DB_NAME:?DB_NAME is required}"
: "${DB_USER:?DB_USER is required}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"

POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
PGBOUNCER_PORT="${PGBOUNCER_PORT:-6432}"
PGBOUNCER_POOL_MODE="${PGBOUNCER_POOL_MODE:-transaction}"
PGBOUNCER_MAX_CLIENT_CONN="${PGBOUNCER_MAX_CLIENT_CONN:-1000}"
PGBOUNCER_DEFAULT_POOL_SIZE="${PGBOUNCER_DEFAULT_POOL_SIZE:-50}"
PGBOUNCER_MIN_POOL_SIZE="${PGBOUNCER_MIN_POOL_SIZE:-5}"
PGBOUNCER_RESERVE_POOL_SIZE="${PGBOUNCER_RESERVE_POOL_SIZE:-20}"
PGBOUNCER_RESERVE_POOL_TIMEOUT="${PGBOUNCER_RESERVE_POOL_TIMEOUT:-5}"
PGBOUNCER_SERVER_IDLE_TIMEOUT="${PGBOUNCER_SERVER_IDLE_TIMEOUT:-60}"
PGBOUNCER_SERVER_LIFETIME="${PGBOUNCER_SERVER_LIFETIME:-3600}"
PGBOUNCER_QUERY_TIMEOUT="${PGBOUNCER_QUERY_TIMEOUT:-0}"
PGBOUNCER_CLIENT_IDLE_TIMEOUT="${PGBOUNCER_CLIENT_IDLE_TIMEOUT:-0}"

mkdir -p /etc/pgbouncer /var/lib/pgbouncer /var/run/pgbouncer

cat > /etc/pgbouncer/pgbouncer.ini <<EOF
[databases]
${DB_NAME} = host=${POSTGRES_HOST} port=${POSTGRES_PORT} dbname=${DB_NAME}

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = ${PGBOUNCER_PORT}
unix_socket_dir = /var/run/pgbouncer
pidfile = /var/run/pgbouncer/pgbouncer.pid
auth_type = plain
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = ${PGBOUNCER_POOL_MODE}
max_client_conn = ${PGBOUNCER_MAX_CLIENT_CONN}
default_pool_size = ${PGBOUNCER_DEFAULT_POOL_SIZE}
min_pool_size = ${PGBOUNCER_MIN_POOL_SIZE}
reserve_pool_size = ${PGBOUNCER_RESERVE_POOL_SIZE}
reserve_pool_timeout = ${PGBOUNCER_RESERVE_POOL_TIMEOUT}
server_idle_timeout = ${PGBOUNCER_SERVER_IDLE_TIMEOUT}
server_lifetime = ${PGBOUNCER_SERVER_LIFETIME}
query_timeout = ${PGBOUNCER_QUERY_TIMEOUT}
client_idle_timeout = ${PGBOUNCER_CLIENT_IDLE_TIMEOUT}
server_reset_query = DISCARD ALL
ignore_startup_parameters = extra_float_digits, options
admin_users = ${DB_USER}
stats_users = ${DB_USER}
EOF

printf '"%s" "%s"\n' "$DB_USER" "$DB_PASSWORD" > /etc/pgbouncer/userlist.txt
chmod 600 /etc/pgbouncer/userlist.txt

exec "$@"
