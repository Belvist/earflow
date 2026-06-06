# Earflow Operations Runbook

Руководство по операциям и устранению неполадок для платформы Earflow.

## Critical Runtime Path

| Layer | Runtime dependency | Why critical | Repo source |
| --- | --- | --- | --- |
| Edge | `nginx` | Public HTTP/HTTPS entrypoint | `docker-compose.yml`, `nginx/conf.d/*.conf` |
| UI | `frontend` | Main web app served behind nginx | `docker-compose.yml`, `frontend/nginx.conf` |
| API | `api-gateway` | Public API routing, auth cookies, CSRF, rate limits | `docker-compose.yml`, `backend/go-api-gateway/gateway.yaml` |
| Auth | `auth-service` | Login, refresh, profile session validation | `docker-compose.yml` |
| Data API | `database-service` | Songs, users, catalog reads | `docker-compose.yml`, `backend/database-service` |
| DB | `postgres` | Source of truth for users, songs, playlists, subscriptions | `docker-compose.yml`, `backend/*.sql` |
| Session store | `redis-auth` | Browser session and auth refresh state | `docker-compose.yml` |
| Cache/RL | `redis` | Gateway rate limits, response cache, service caches | `docker-compose.yml` |
| Object storage | `minio` | Audio, covers, EBAP/HLS media artifacts | `docker-compose.yml` |
| Search | `search-service`, `meilisearch` | Search API and index backend | `docker-compose.yml` |
| Media | `direct-stream-service`, `ebap-hls-adapter` | Playback sessions and HLS/direct stream control | `docker-compose.yml` |

## Common Issues

### Nginx 502 Bad Gateway

**Symptoms:**
- Users see "502 Bad Gateway" errors
- API calls fail
- Frontend partially loads

**Causes:**
1. Backend service down (api-gateway, auth-service, etc.)
2. Nginx cannot connect to upstream
3. Upstream timeout

**Troubleshooting:**

```bash
# Check Nginx status
docker-compose ps nginx

# Check Nginx logs
docker-compose logs nginx

# Check upstream service status
docker-compose ps api-gateway
docker-compose ps auth-service
docker-compose ps database-service

# Check if upstream is reachable from nginx
docker-compose exec nginx nc -zv api-gateway 3000
```

**Resolution:**

1. If upstream service is down:
   ```bash
   docker-compose restart api-gateway  # or other affected service
   ```

2. If Nginx configuration issue:
   ```bash
   docker-compose exec nginx nginx -t
   docker-compose restart nginx
   ```

3. If upstream timeout:
   - Check service health endpoint
   - Check service logs for errors
   - Scale service if overloaded

---

### Nginx 504 Gateway Timeout

**Symptoms:**
- "504 Gateway Timeout" errors
- Slow API responses
- Long-running requests timeout

**Causes:**
1. Backend service slow response
2. Database query timeout
3. Large file upload/download

**Troubleshooting:**

```bash
# Check Nginx logs for timeout errors
docker-compose logs nginx | grep "timeout"

# Check backend service logs
docker-compose logs api-gateway
docker-compose logs database-service

# Check PostgreSQL slow queries
docker-compose exec postgres psql -U $DB_USER -d $DB_NAME -c "SELECT * FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;"
```

**Resolution:**

1. Increase Nginx timeout in `nginx/nginx.conf` (if appropriate):
   ```nginx
   proxy_read_timeout 60s;
   proxy_connect_timeout 30s;
   ```

2. Optimize slow database queries
3. Scale backend services
4. Add caching for slow endpoints

---

### API Gateway Down

**Symptoms:**
- All API calls fail
- 502/503 errors
- Auth cookies not working

**Causes:**
1. Service crash
2. Redis connection failure
3. Configuration error
4. Out of memory

**Troubleshooting:**

```bash
# Check gateway status
docker-compose ps api-gateway

# Check gateway logs
docker-compose logs api-gateway

# Check Redis connectivity
docker-compose exec api-gateway nc -zv redis 6379
docker-compose exec api-gateway nc -zv redis-auth 6379

# Check gateway health
curl http://localhost:3000/health
```

**Resolution:**

1. Restart gateway:
   ```bash
   docker-compose restart api-gateway
   ```

2. If Redis issue:
   ```bash
   docker-compose restart redis redis-auth
   ```

3. If OOM:
   - Check memory usage: `docker stats api-gateway`
   - Increase memory limit in docker-compose.yml
   - Scale gateway horizontally

---

### Auth Service Down

**Symptoms:**
- Login/registration fails
- Refresh token errors
- Profile access fails
- Users logged out

**Causes:**
1. Service crash
2. PostgreSQL connection failure
3. Redis connection failure

**Troubleshooting:**

```bash
# Check auth-service status
docker-compose ps auth-service

# Check auth-service logs
docker-compose logs auth-service

# Check PostgreSQL connectivity
docker-compose exec auth-service nc -zv postgres 5432

# Check Redis connectivity
docker-compose exec auth-service nc -zv redis-auth 6379

# Test auth endpoint
curl -X POST http://localhost:3001/api/auth/login -H "Content-Type: application/json" -d '{"email":"test@example.com","password":"test"}'
```

**Resolution:**

1. Restart auth-service:
   ```bash
   docker-compose restart auth-service
   ```

2. If PostgreSQL issue:
   ```bash
   docker-compose restart postgres
   ```

3. If Redis issue:
   ```bash
   docker-compose restart redis-auth
   ```

**Impact:**
- Users cannot login/register
- Existing sessions continue to work (until refresh)
- Artist Portal unavailable

---

### PostgreSQL Down

**Symptoms:**
- All database-dependent services fail
- 500 errors on data API
- Connection refused errors

**Causes:**
1. Database crash
2. Disk full
3. Out of memory
4. Corruption

**Troubleshooting:**

```bash
# Check PostgreSQL status
docker-compose ps postgres

# Check PostgreSQL logs
docker-compose logs postgres

# Check disk space
df -h

# Check memory usage
docker stats postgres

# Test connection
docker-compose exec postgres pg_isready
```

**Resolution:**

1. If disk full:
   ```bash
   # Clean up old data/logs
   # Increase disk size
   ```

2. If OOM:
   - Increase memory limit in docker-compose.yml
   - Check for memory leaks

3. If crash:
   ```bash
   docker-compose restart postgres
   ```

4. If corruption:
   - Restore from backup: `./scripts/drill-postgres-restore.sh`

**Impact:**
- **CRITICAL:** Complete platform outage
- No data access
- No auth
- No streaming

---

### Redis Down

**Symptoms:**
- Rate limiting not working
- Cache misses
- Session errors
- Slow API responses

**Causes:**
1. Redis crash
2. Out of memory
3. Configuration error

**Troubleshooting:**

```bash
# Check Redis status
docker-compose ps redis redis-auth

# Check Redis logs
docker-compose logs redis
docker-compose logs redis-auth

# Test connectivity
docker-compose exec redis redis-cli ping
docker-compose exec redis-auth redis-cli -a $REDIS_PASSWORD ping

# Check memory usage
docker stats redis redis-auth
```

**Resolution:**

1. Restart Redis:
   ```bash
   docker-compose restart redis redis-auth
   ```

2. If OOM:
   - Increase `maxmemory` in docker-compose.yml
   - Check for memory leaks

3. If configuration error:
   - Check `REDIS_PASSWORD` in .env
   - Check redis command in docker-compose.yml

**Impact:**
- **HIGH:** Rate limiting disabled (DoS risk)
- Cache disabled (slow responses)
- Session errors (users logged out if redis-auth down)

---

### MinIO Down

**Symptoms:**
- File upload fails
- Streaming fails
- Cover images not loading
- 500 errors on media endpoints

**Causes:**
1. MinIO crash
2. Disk full
3. Bucket access issues
4. Credential issues

**Troubleshooting:**

```bash
# Check MinIO status
docker-compose ps minio

# Check MinIO logs
docker-compose logs minio

# Check disk space
df -h

# Test MinIO health
curl http://localhost:9000/minio/health/live

# Check buckets via console
# Open http://localhost:9001 in browser
```

**Resolution:**

1. If disk full:
   - Clean up old/unused files
   - Increase disk size

2. If crash:
   ```bash
   docker-compose restart minio
   docker-compose restart minio-init  # reinitialize buckets if needed
   ```

3. If bucket access issue:
   - Check bucket permissions
   - Reinitialize buckets via minio-init

**Impact:**
- **CRITICAL:** No streaming, no uploads
- Cover images not loading
- Platform partially functional

---

### Upload Service Fails

**Symptoms:**
- File upload fails
- 500 errors on upload endpoints
- Artist Portal upload not working

**Causes:**
1. Service crash
2. MinIO connection failure
3. PostgreSQL connection failure
4. File validation error
5. Disk full (temporary storage)

**Troubleshooting:**

```bash
# Check upload-service status
docker-compose ps upload-service

# Check upload-service logs
docker-compose logs upload-service

# Check MinIO connectivity
docker-compose exec upload-service nc -zv minio 9000

# Check PostgreSQL connectivity
docker-compose exec upload-service nc -zv postgres 5432

# Check temp storage space
df -h
```

**Resolution:**

1. Restart upload-service:
   ```bash
   docker-compose restart upload-service
   ```

2. If MinIO issue:
   ```bash
   docker-compose restart minio
   ```

3. If temp storage full:
   - Clean up temp files
   - Increase temp storage size

**Impact:**
- **HIGH:** Artists cannot upload tracks
- Cover image upload fails
- Platform functional for existing content

---

### WebSocket Reconnect Loop

**Symptoms:**
- WebSocket connections constantly reconnecting
- Party Sync not working
- Device Sync not working
- High CPU usage

**Causes:**
1. WebSocket endpoint unreachable
2. Auth token invalid
3. Rate limiting
4. Network issues
5. Service crash

**Troubleshooting:**

```bash
# Check WebSocket services
docker-compose ps party-go
docker-compose ps device-sync-service

# Check WebSocket service logs
docker-compose logs party-go
docker-compose logs device-sync-service

# Check NATS status
docker-compose ps nats

# Test WebSocket endpoint
wscat -c wss://api.earflow.ru/api/party/ws
```

**Resolution:**

1. Restart WebSocket services:
   ```bash
   docker-compose restart party-go
   docker-compose restart device-sync-service
   ```

2. If NATS issue:
   ```bash
   docker-compose restart nats
   ```

3. If auth token issue:
   - Check JWT_SECRET
   - Check auth-service status

4. If rate limiting:
   - Check Redis rate limits
   - Adjust rate limit multipliers

**Impact:**
- **LOW-MEDIUM:** Party Sync and Device Sync not working
- Core playback functional

---

## Service Health Checks

### Quick Health Check

```bash
# Platform control script
./scripts/platform-control.sh health

# Manual check
docker-compose ps

# Check specific services
curl http://localhost:3000/health          # API Gateway
curl http://localhost:3001/health          # Auth Service
curl http://localhost:3002/health          # Upload Service
curl http://localhost:3003/health          # Database Service
curl http://localhost:3051/health          # Transcode Worker
```

### Runtime Verification

| Check | Command | Good result | Bad result means |
| --- | --- | --- | --- |
| public ports | `ss -lntp` | only `:80`, `:443` public | service exposed outside nginx |
| compose state | `docker compose ps` | critical services running | repo/runtime drift |
| gateway cache | `curl -sD - https://earflow.ru/api/artists/popular` | `X-Cache: HIT` on second request | Redis cache not active |

---

## Backup And Restore

### PostgreSQL Backup

```bash
# Daily backup
./scripts/backup-postgres.sh daily

# Verify backup
./scripts/backup-postgres.sh verify "$(find ./backups/postgres -type f -name '*.sql.gz*' | sort | tail -1)"

# Restore drill
./scripts/drill-postgres-restore.sh
```

### MinIO Backup

```bash
# Snapshot backup
./scripts/backup-minio.sh snapshot

# Verify backup
./scripts/backup-minio.sh verify "$(find ./backups/minio -type f -name '*.tar.gz' | sort | tail -1)"

# Restore drill
./scripts/drill-minio-restore.sh
```

---

## Secret Rotation

### Minimum Rotation Set

| Secret class | Consumers to restart |
| --- | --- |
| `JWT_SECRET` | `api-gateway`, `artist-api-gateway`, `auth-service`, `security-service` |
| `SESSION_ENCRYPTION_KEY` | `api-gateway`, `artist-api-gateway` |
| `REDIS_PASSWORD` | `redis`, `redis-auth`, all services using Redis |
| `MINIO_ROOT_PASSWORD` | `minio`, `minio-init`, upload/media workers |
| `MEDIA_URL_SECRET` | `upload-service`, direct-stream-service |
| `EBAP_HLS_COOKIE_SECRET` | `ebap-hls-adapter` |
| `DIRECT_STREAM_URLTOKEN_SECRET` | `direct-stream-service` |
| `SERVICE_KEY_*` | All relevant services |

### Rotation Steps

1. Update secret in `.env`
2. Restart affected services:
   ```bash
   docker-compose restart [service-name]
   ```
3. Verify functionality
4. Monitor for errors

---

## Scaling

### Stateless Services

```bash
# Scale API Gateway
docker-compose up -d --scale api-gateway=3

# Scale Direct Stream Service
docker-compose up -d --scale direct-stream-service=2

# Use scaling scripts
./scripts/scale-gateway.sh 3
./scripts/scale-stateless.sh 2
```

### Stateful Services

Stateful services (PostgreSQL, Redis, MinIO) require manual scaling via:
- PostgreSQL: Replication, read replicas
- Redis: Sentinel, cluster mode
- MinIO: Distributed mode

See [docs/scale-1m-engineering-plan.md](docs/scale-1m-engineering-plan.md) for details.

---

## Monitoring

### Logs

```bash
# All logs
docker-compose logs

# Specific service
docker-compose logs -f api-gateway

# Last 100 lines
docker-compose logs --tail=100 api-gateway
```

### Metrics

If monitoring stack is enabled:

```bash
docker-compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d
```

Access:
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3000 (default credentials)

### Alerts

Key metrics to alert on:

| Metric | Alert condition |
| --- | --- |
| Redis memory usage | > 80% for 10 minutes |
| Redis evicted keys (redis-auth) | > 0 |
| PostgreSQL connections | > 80% of max |
| PostgreSQL slow queries | p95 > 1s |
| API Gateway error rate | > 5% |
| Service crash | Container restart count > 3 in 5 minutes |

---

## Common Commands

### Platform Control

```bash
./scripts/platform-control.sh start      # Start platform
./scripts/platform-control.sh stop       # Stop platform
./scripts/platform-control.sh restart    # Restart platform
./scripts/platform-control.sh status     # Check status
./scripts/platform-control.sh health     # Health check
./scripts/platform-control.sh logs       # View logs
./scripts/platform-control.sh build      # Rebuild services
```

### Docker Compose

```bash
docker-compose up -d                    # Start all services
docker-compose down                      # Stop all services
docker-compose restart [service]         # Restart specific service
docker-compose ps                        # Check status
docker-compose logs -f [service]         # View logs
docker-compose exec [service] bash       # Execute command in container
```

---

## Emergency Procedures

### Complete Platform Outage

1. Check infrastructure (network, power, disk)
2. Check Docker daemon: `systemctl status docker`
3. Check all services: `docker-compose ps`
4. Restart critical services:
   ```bash
   docker-compose restart postgres redis redis-auth
   docker-compose restart nginx api-gateway auth-service
   ```
5. Monitor logs: `docker-compose logs -f`
6. If database corruption, restore from backup

### Security Incident

1. Isolate affected systems
2. Rotate all secrets (see Secret Rotation)
3. Review logs for suspicious activity
4. Notify security team
5. Document incident

### Data Loss

1. Stop all writes to affected systems
2. Assess extent of loss
3. Restore from most recent backup
4. Verify restore integrity
5. Replay any transactions since backup
6. Document root cause

---

## References

- [Architecture Map](docs/earflow-architecture-map.md) — Полная архитектура
- [Service Map](SERVICE_MAP.md) — Карта сервисов
- [Security Documentation](SECURITY.md) — Безопасность
- [Scale Plan](docs/scale-1m-engineering-plan.md) — План масштабирования
