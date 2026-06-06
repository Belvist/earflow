# Earflow Security Documentation

Документация по безопасности платформы Earflow. Подробный аудит безопасности см. в [reports/comprehensive-security-plan.md](reports/comprehensive-security-plan.md).

## Обзор безопасности

Earflow демонстрирует **уровень безопасности выше среднего** для микросервисного проекта. Реализована защита в глубину на нескольких уровнях:
- WAF-подобная фильтрация в Nginx
- Go API-шлюз с CSRF/управлением сессиями
- Параметризованные SQL-запросы повсюду
- Защита загрузки файлов
- TLS 1.2+ с HSTS preload

**Сводка находок (из comprehensive-security-plan.md):**

| Критичность | Количество | Статус |
|-------------|-----------|--------|
| CRITICAL | 2 | ✅ Исправлено |
| HIGH | 8 | 5 исправлено, 3 открыто |
| MEDIUM | 14 | 8 исправлено, 6 открыто |
| LOW | 10 | 6 исправлено, 4 открыто |
| INFORMATIONAL | 8 | Н/Д |

## Authentication & Authorization

### JWT Tokens

**JWT Secret:** `JWT_SECRET` — секрет для подписи JWT токенов

**JWT Issuer/Audience:**
- `JWT_ISSUER=earflow-auth`
- `JWT_AUDIENCE=earflow-api`

**Token Types:**
- Access token: 15 минут TTL (`ACCESS_JWT_EXPIRES_IN`)
- Refresh token: 365 дней TTL (`REFRESH_JWT_EXPIRES_IN`)

**Service JWT:**
- Service-to-service authentication via `SERVICE_JWT_PRIVATE_KEY_B64` / `SERVICE_JWT_PUBLIC_KEY_B64`
- Issuer: `SERVICE_JWT_ISSUER=database-service`
- Audience: `SERVICE_JWT_AUDIENCE=database-service`, `SERVICE_JWT_AUDIENCE_UPLOAD=upload-service`

### Service Keys

Service keys используются для service-to-service authentication:

- `SERVICE_KEY_API_GATEWAY`
- `SERVICE_KEY_ARTIST_API_GATEWAY`
- `SERVICE_KEY_AUTH_SERVICE`
- `SERVICE_KEY_UPLOAD_SERVICE`
- `SERVICE_KEY_TRACK_PROCESSOR`
- `SERVICE_KEY_AUDIO_FEATURES_WORKER`
- `SERVICE_KEY_EBAP_HLS_ADAPTER`

**Валидация:** Gateway проверяет `X-Service-Token` header против `ALLOWED_SERVICES`.

### Password Hashing

**Алгоритм:** PBKDF2-SHA512

**Параметры:**
- Итерации: 600 000 (`SECURITY_PBKDF_ITERATIONS`)
- Legacy итерации: 100 000 (`SECURITY_PBKDF_ITERATIONS_LEGACY`)
- Длина ключа: 64 байта (`SECURITY_PBKDF_KEY_LENGTH`)

**Миграция:** Устаревшие хеши перехешируются при входе.

### MFA (Multi-Factor Authentication)

**MFA Step-Up:**
- TTL: 300 секунд (`SECURITY_STEP_UP_TTL_SECONDS`)
- Требуется для write operations в Artist Portal
- Хранится в Redis (auth)

**Recovery Codes:**
- Генерируются при включении MFA
- Хранятся в PostgreSQL (encrypted)

## Cookies

### Cookie Names

**Main platform:**
- `mp_auth` — JWT access token
- `mp_sid` — session ID (encrypted)
- `mp_csrf` — CSRF token (HMAC-bound to session)

**Artist Portal:**
- `mp_auth_artists` — JWT access token
- `mp_sid_artists` — session ID (encrypted)
- `mp_csrf_artists` — CSRF token

**Streaming:**
- `mp_stream` — stream cookie token (signed)

### Cookie Settings

**Domain:** `COOKIE_DOMAIN=.earflow.ru`

**SameSite:** `COOKIE_SAMESITE=none` (для cross-origin между поддоменами)

**Secure:** `COOKIE_SECURE=true` (только HTTPS)

**Session TTL:** 31536000 секунд (1 год) (`SESSION_TTL_SECONDS`)

### Session Encryption

**Key:** `SESSION_ENCRYPTION_KEY` — AES-256-GCM ключ для шифрования сессий в Redis

**Status:** Требуется развёртывание (H-2 в security plan)

## CSRF Protection

### Double-Submit Cookie Pattern

**Implementation:**
- CSRF cookie (`mp_csrf` / `mp_csrf_artists`)
- CSRF header (`X-CSRF-Token`)
- HMAC binding to session ID

**Middleware:**
- `backend/go-api-gateway/internal/auth/csrf.go` — Go gateway
- `backend/artist-portal-service/middleware/csrfProtection.js` — Artist Portal
- `backend/upload-service/middleware/csrfProtection.js` — Upload service

**Origin/Referer Validation:**
- Проверяется против `ALLOWED_ORIGINS`

**Bypass Conditions:**
- Safe methods (GET, HEAD, OPTIONS)
- Bearer-only API clients

**Trust Classes (gateway.yaml):**
- `unsafe` — CSRF enforced
- `stream` — CSRF not enforced (streaming endpoints)
- `static` — CSRF not enforced (static assets)

# Security Report

> **Roadmap (финальная цель):** [`docs/SECURITY_ROADMAP.md`](../docs/SECURITY_ROADMAP.md) — приоритеты после PoP MVP.  
> **Pending:** `PEND-SEC-001` … `PEND-SEC-010` в [`docs/PENDING.md`](../docs/PENDING.md).

## Device-bound session proof (PoP) — INV-SEC-010

**Goal:** Stolen `mp_sid` + `mp_csrf` pasted into another browser is **not** enough for authenticated API.

**Model:** `mp_sid` + **ECDSA P-256 proof** (`X-Auth-Device-Id`, `X-Auth-Device-Proof`, `X-Auth-Device-Proof-Ts`, `X-Auth-Device-Proof-Nonce`) + Redis session.

**Register (bridge after login):** `POST /api/auth/device/register` — requires valid sid cookie, CSRF, Origin; returns `sidHash`; **Save** auth-device (multi-device, не evict siblings на sid).

**Proof allowlist (no PoP):** `/api/auth/email/login`, `/api/auth/email/register`, `/api/auth/telegram/login`, `GET /api/auth/csrf`, `POST /api/auth/device/register`, `/api/public-config`, health/metrics.

**Errors:** `DEVICE_PROOF_REQUIRED`, `DEVICE_PROOF_INVALID`, `DEVICE_PROOF_EXPIRED`, `DEVICE_PROOF_REPLAY` (403), `DEVICE_REVOKED`.

**Unified revoke:** `RevokeSessionFull` clears `mp:sess:*`, `auth:sid:*`, `auth:refresh:*`, meta, step-up, grace, auth-device bindings.

**WebSocket:** `/ws/*` skips cookie session auth when PoP enforced; use short-lived ticket from proof-protected POST (e.g. `/api/devices/ws-ticket`).

**Stream:** POST stream session endpoints must send PoP headers (same as other authenticated API).

**Local/test only:** `ALLOW_COOKIE_AUTH_WITHOUT_PROOF=1` (gateway), `REACT_APP_ALLOW_COOKIE_AUTH_WITHOUT_PROOF=1` (frontend). **Ignored in production.**

## CORS

### Allowed Origins

**Environment:** `ALLOWED_ORIGINS`

**Default:**
- `https://earflow.ru`
- `https://auth.earflow.ru`
- `https://api.earflow.ru`
- `https://artists.earflow.ru`

### CORS Headers

**Nginx:** Добавляет `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`

**Backend:** Проверяет `Origin` header в CSRF middleware

## Rate Limiting

### Gateway Rate Limits

**Classes (gateway.yaml):**
- `stream` — streaming endpoints
- `cover` — cover images
- `default` — general API

**Redis:** Хранит rate limit counters

### Service-Level Rate Limits

**Upload Service:** `UPLOAD_RATE_LIMIT_MULTIPLIER`

**Database Service:** `DATABASE_SERVICE_RATE_LIMIT_MULTIPLIER`

**Load Test Mode:** `LOAD_TEST_MODE=true`, `LOAD_TEST_RATE_LIMIT_MULTIPLIER`

## Upload Protection

### File Validation

**Allowed Types:**
- Audio: MP3, WAV, FLAC, OGG, M4A
- Images: JPEG, PNG, WEBP

**Validation:**
- MIME type check
- Magic bytes verification
- File size limits

### Storage Security

**MinIO Buckets:**
- `audio` — private (только через signed URLs)
- `covers` — public (read-only)
- `ebap-cache` — private
- `ebap-hls` — private

### Media URL Signing

**Secret:** `MEDIA_URL_SECRET`

**TTL:** 3600 секунд (`MEDIA_URL_TTL_SECONDS`)

**Implementation:** Presigned S3 URLs с HMAC signature

## WebSocket Security

### Party Sync WebSocket

**Authentication:** JWT verification required (C-1 исправлено)

**Header Trust:** NO header trust — JWT verified on connection

### Device Sync WebSocket

**Authentication:** JWT verification

**Rate Limiting:** Per-device rate limits

## Streaming Security

### Direct Stream Service

**URL Tokens:**
- Secret: `DIRECT_STREAM_URLTOKEN_SECRET`
- Secrets for rotation: `DIRECT_STREAM_URLTOKEN_SECRETS`
- TTL: 900 секунд

**Cookie Tokens:**
- Name: `mp_stream`
- Secret: `SYSTEM_ROOT_SECRET` derived
- TTL: 1800 секунд

**Access Control:**
- `mapSongAccess()` — проверка прав доступа к треку
- User ID verification via `X-User-Id` header (set by gateway)

### EBAP HLS Adapter (iOS)

**Track Key Encryption:**
- Master secret: `EBAP_TRACK_KEY_MASTER_SECRET`
- Secrets for rotation: `EBAP_TRACK_KEY_MASTER_SECRETS`
- Derivation: HKDF-SHA256 per track

**Cookie Tokens:**
- Secret: `EBAP_HLS_COOKIE_SECRET`
- Secrets for rotation: `EBAP_HLS_COOKIE_SECRETS`
- TTL: 900 секунд

**URL Tokens:**
- Secret: `EBAP_HLS_URLTOKEN_SECRET`
- Secrets for rotation: `EBAP_HLS_URLTOKEN_SECRETS`
- TTL: 120 секунд

**Signed URLs:**
- `EBAP_HLS_SIGNED_URLS` — включить signed URLs
- `EBAP_HLS_SIGNED_URLS_ASSET_TOKEN_ONLY`
- `EBAP_HLS_SIGNED_URLS_PLAYLIST_TOKEN_ONLY`
- `EBAP_HLS_SIGNED_URLS_PLAYLIST_REQUIRE_COOKIE`

### Range Requests

**Policy:** RFC-compliant Range semantics (no server-side clamping)

## Infrastructure Security

### PostgreSQL

**Access:** Internal Docker network only (не экспонирован наружу)

**Authentication:**
- User: `DB_USER`
- Password: `DB_PASSWORD`

**Security:**
- pgvector extension installed
- Parameterized queries everywhere
- No SQL injection vulnerabilities

**Role Separation:** TODO (M-10) — единый суперпользователь для всех сервисов

### Redis

**Access:** Internal Docker network only

**Authentication:**
- Password: `REDIS_PASSWORD`

**Security:**
- Redis (main): `maxmemory=256mb`, `allkeys-lru` eviction
- Redis (auth): `maxmemory=512mb`, `noeviction` (сессии не удаляются)

**TLS:** TODO (H-2) — нет TLS между сервисами

### MinIO

**Access:**
- S3 API: localhost:9000 (только localhost)
- Console: localhost:9001 (только localhost)

**Authentication:**
- Root user: `MINIO_ROOT_USER`
- Root password: `MINIO_ROOT_PASSWORD`

**Bucket Permissions:**
- `audio`: private (none)
- `covers`: public download
- `ebap-cache`: private (none)
- `ebap-hls`: private (none)

**Security:**
- Pinned image: `minio/minio:RELEASE.2025-01-20T14-49-07Z`

### Meilisearch

**Access:** Internal Docker network only

**Authentication:**
- Master key: `MEILI_MASTER_KEY` (minimum 16 chars)

### NATS JetStream

**Access:** Internal Docker network only

**Authentication:** TODO — нет аутентификации

## Security Headers

### Nginx Headers

**CSP (Content-Security-Policy):**
- `default-src 'self'`
- `script-src 'self' 'unsafe-inline' 'unsafe-eval'`
- `style-src 'self' 'unsafe-inline'`
- `img-src 'self' data: https:`
- `connect-src 'self' wss: https:`
- `media-src 'self' blob: https:`
- `font-src 'self' data:`
- `object-src 'none'`
- `frame-src 'none'`

**Other Headers:**
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `Referrer-Policy: strict-origin-when-cross-origin`

### Gateway Headers

**Header Stripping:**
- `X-User-Id` — удалён из входящих запросов
- `X-User-Name` — удалён
- `X-User-Role` — удалён
- `X-Service-Token` — удалён
- `X-Earflow-Upload-Context` — удалён

**Header Injection:**
- `X-User-Id` — установлен из session token
- `Authorization: Bearer <token>` — установлен из session

## Public vs Private Endpoints

### Public Endpoints (No Auth Required)

**Frontend:**
- `GET /` — main app
- `GET /auth` — login page

**API:**
- `POST /api/auth/register` — регистрация
- `POST /api/auth/login` — вход
- `GET /api/songs/cover` — обложки (static)
- `GET /covers/*` — обложки (static)

### Authenticated Endpoints (User Auth Required)

**Gateway `require_user: true`:**
- `/api/stream/v2/*` — streaming
- `/api/ebap-hls/*` — HLS
- `/api/songs/*` — песни
- `/api/artists/*` — артисты
- `/api/playlists/*` — плейлисты
- `/api/recommendations/*` — рекомендации
- `/api/search/*` — поиск (authed limit higher)
- `/api/artist-portal/*` — Artist Portal

### Service Endpoints (Service Token Required)

**Gateway `strip_auth: true` + service token:**
- Internal service-to-service communication

### Admin/Internal Endpoints

**Not exposed via Gateway:**
- Service health endpoints (internal network only)
- Admin tools (via SSH tunnel)

## Encryption

### Data at Rest

**PostgreSQL:** TODO — прозрачное шифрование БД

**MinIO:** TODO — шифрование объектов

**Redis:** TODO — шифрование сессий (H-2)

### Data in Transit

**TLS:**
- Nginx: TLS 1.2+ с HSTS preload
- Internal: TODO — нет TLS между сервисами (H-2)

### Application-Level Encryption

**Session Encryption:**
- Algorithm: AES-256-GCM
- Key: `SESSION_ENCRYPTION_KEY`
- Status: Требуется развёртывание

**User Data Encryption:**
- Algorithm: AES-256-GCM
- Key: `ENCRYPTION_KEY`
- Used for: User metadata, recovery codes

## Secret Management

### Environment Variables

**Required Secrets (minimum 32 chars):**
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- `SESSION_ENCRYPTION_KEY`
- `SYSTEM_ROOT_SECRET`
- `MEDIA_URL_SECRET`
- `REDIS_PASSWORD`
- `DB_PASSWORD`
- `MINIO_ROOT_PASSWORD`
- `MEILI_MASTER_KEY` (minimum 16 chars)
- `EBAP_HLS_COOKIE_SECRET`
- `DIRECT_STREAM_URLTOKEN_SECRET`
- All `SERVICE_KEY_*` values

### Secret Rotation

**Recommendation:**
- Rotate all secrets after any exposure
- Rotate JWT secrets periodically (quarterly)
- Rotate service keys after personnel changes
- Rotate Redis/MinIO/DB passwords after breaches

### Secret Storage

**Development:** `.env` file (не коммитить в git)

**Production:** Use secret manager (Kubernetes Secrets, AWS Secrets Manager, HashiCorp Vault)

**Template:** `.env.example` (без реальных секретов)

## Known Security Issues

### High Priority (Open)

**H-2: JWT Refresh token stored in Redis without encryption**
- **Impact:** Session hijacking if Redis compromised
- **Fix:** Deploy `SESSION_ENCRYPTION_KEY`

**H-4: Cookie flags inconsistent between services**
- **Impact:** Potential CSRF bypass
- **Fix:** Standardize cookie flags

**H-6: Nginx master process runs as root inside container**
- **Impact:** Privilege escalation if container escape
- **Fix:** Use non-root user

### Medium Priority (Open)

**M-10: No database role separation**
- **Impact:** Single compromised service can access all data
- **Fix:** Create separate roles per service

**M-14: Flat Docker network without segmentation**
- **Impact:** Lateral movement between services
- **Fix:** Network segmentation

## Security Checklist

### Pre-Deployment

- [ ] All secrets rotated from defaults
- [ ] `SESSION_ENCRYPTION_KEY` deployed
- [ ] TLS certificates valid
- [ ] CSP headers tested
- [ ] Rate limits configured
- [ ] File upload validation tested
- [ ] CSRF protection tested
- [ ] MFA step-up enabled for production

### Post-Deployment

- [ ] Security headers verified (securityheaders.com)
- [ ] TLS configuration verified (SSL Labs)
- [ ] Dependency scan completed
- [ ] Penetration testing completed
- [ ] Monitoring for security events enabled
- [ ] Incident response plan tested

### Ongoing

- [ ] Regular secret rotation
- [ ] Regular dependency updates
- [ ] Security log monitoring
- [ ] Periodic security audits
- [ ] Incident response drills

## Incident Response

### Security Incident Types

- **Data breach:** Unauthorized access to user data
- **Service compromise:** Malicious code execution
- **DDoS attack:** Denial of service
- **Account takeover:** Unauthorized user access

### Response Steps

1. **Contain:** Isolate affected systems
2. **Investigate:** Determine scope and impact
3. **Communicate:** Notify stakeholders
4. **Remediate:** Patch vulnerabilities
5. **Recover:** Restore from backups
6. **Review:** Post-incident analysis

### Contacts

- Security team: [security@earflow.ru]
- Incident response: [incident@earflow.ru]

## References

- [Comprehensive Security Plan](reports/comprehensive-security-plan.md) — Полный аудит безопасности
- [OWASP Top 10](https://owasp.org/www-project-top-ten/) — OWASP security risks
- [CWE/SANS Top 25](https://cwe.mitre.org/top25/) — Common weaknesses
