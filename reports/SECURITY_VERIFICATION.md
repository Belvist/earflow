# Earflow Security Verification Report

Подтверждённые security controls в кодовой базе платформы Earflow.

**Дата:** 2025-01  
**Цель:** Проверить реальные security controls в коде, а не только документацию.

---

## A. Auth (Authentication & Session Management)

### JWT Verification

**Evidence:**
- `backend/go-api-gateway/internal/auth/session_manager.go:15-16` — JWT verification with HS256
- `backend/upload-service/middleware/authenticateUser.js:64-80` — JWT verification with JWT_SECRET
- `backend/security-service/internal/authz/jwt.go:97-99` — JWT middleware for service-to-service auth

**Status:** ✅ CONFIRMED

**Findings:**
- JWT_SECRET используется для подписи JWT токенов
- HS256 алгоритм используется везде (consistently)
- JWT verification с fallback на auth-service `/api/verify` endpoint (authenticateUser.js:83-87)
- Service-to-service auth использует RSA ключи (SERVICE_JWT_PRIVATE_KEY_B64, SERVICE_JWT_PUBLIC_KEY_B64)

### Refresh Token Rotation

**Evidence:**
- `backend/go-api-gateway/internal/auth/session_manager.go:118-129` — refresh request/response types
- `backend/auth-service/server.js:1208` — `/api/auth/refresh` endpoint

**Status:** ⚠️ PARTIALLY CONFIRMED

**Findings:**
- Refresh token endpoint существует
- Структура для refresh rotation определена
- **НЕПРОВЕРЕНО:** Реализована ли реальная ротация refresh токенов на backend
- **НЕПРОВЕРЕНО:** Хранится ли refresh token в Redis зашифрованным (H-2 из comprehensive-security-plan.md)

### Cookies

**Evidence:**
- `backend/go-api-gateway/internal/auth/cookies.go` — cookie management functions
- `backend/go-api-gateway/internal/config/config.go:84-92` — CookieConfig (Domain, SameSite, Secure, Path)
- `backend/direct-stream-service/src/main.ts:223-243` — buildSetCookieHeader function

**Cookie Names:**
- mp_sid, mp_auth, mp_csrf (main)
- mp_sid_artists, mp_auth_artists, mp_csrf_artists (artist portal)
- mp_stream (streaming)
- mp_hls (EBAP-HLS)
- mp_lyrics (lyrics)

**Cookie Flags:**
- SameSite: Lax/Strict/None (configurable via COOKIE_SAMESITE)
- Secure: true in production (configurable via COOKIE_SECURE)
- HttpOnly: true для session cookies
- Domain: configurable via COOKIE_DOMAIN

**Status:** ✅ CONFIRMED

**Findings:**
- Cookie flags настраиваются через environment variables
- Secure и SameSite зависят от environment
- **НЕПРОВЕРЕНО:** Есть ли различия в cookie flags между сервисами (H-4 из comprehensive-security-plan.md)

### Session Encryption

**Evidence:**
- `backend/go-api-gateway/internal/auth/session_store.go` — SessionStore with encryption
- `backend/go-api-gateway/internal/auth/session_crypto.go` — newSessionCipherFromEnv() reads SESSION_ENCRYPTION_KEY
- `backend/go-api-gateway/internal/auth/session_store_test.go:18` — SESSION_ENCRYPTION_KEY used in tests

**Status:** ✅ CONFIRMED

**Findings:**
- SESSION_ENCRYPTION_KEY используется для шифрования session data в Redis
- AES-256-GCM используется для шифрования
- Session data шифруется перед сохранением в Redis

---

## B. CSRF Protection

### CSRF Token Generation & Verification

**Evidence:**
- `backend/go-api-gateway/internal/auth/csrf.go:11-19` — GenerateCSRFToken with HMAC-SHA256
- `backend/go-api-gateway/internal/auth/csrf.go:22-38` — VerifyCSRFToken with HMAC-SHA256
- `backend/upload-service/middleware/csrfProtection.js:57-72` — verifyCsrfToken function

**Status:** ✅ CONFIRMED

**Findings:**
- CSRF tokens генерируются с HMAC-SHA256 (nonce + signature)
- Double-submit cookie pattern: CSRF cookie + X-CSRF-Token header
- CSRF token привязан к session ID (sid) через HMAC

### Unsafe Methods Protection

**Evidence:**
- `backend/go-api-gateway/internal/proxy/reverse_proxy.go:71-78` — isUnsafeMethod() checks POST/PUT/PATCH/DELETE
- `backend/go-api-gateway/internal/proxy/reverse_proxy.go` — CSRF enforced for `class: unsafe` routes
- `backend/upload-service/middleware/csrfProtection.js:20-23` — isSafeMethod() checks GET/HEAD/OPTIONS

**Status:** ✅ CONFIRMED

**Findings:**
- CSRF защита включена для unsafe методов (POST/PUT/PATCH/DELETE)
- Safe методы (GET/HEAD/OPTIONS) bypass CSRF
- Gateway классифицирует routes как `unsafe` для CSRF enforcement

### Origin/Referer Validation

**Evidence:**
- `backend/upload-service/middleware/csrfProtection.js:25-36` — getOriginOrRefererOrigin()
- `backend/upload-service/middleware/csrfProtection.js:100-116` — Origin/Referer validation against ALLOWED_ORIGINS
- `backend/upload-service/middleware/csrfProtection.js:112-115` — Sec-Fetch-Site metadata check for cross-site

**Status:** ✅ CONFIRMED

**Findings:**
- Origin или Referer проверяется против ALLOWED_ORIGINS
- Sec-Fetch-Site: cross-site блокируется
- Telegram origin patterns поддерживаются
- Dev origin patterns поддерживаются в non-production

### Bearer Auth Bypass

**Evidence:**
- `backend/upload-service/middleware/csrfProtection.js:38-43` — isLikelyBearerAuth()
- `backend/upload-service/middleware/csrfProtection.js:93-97` — Bearer auth bypasses CSRF

**Status:** ✅ CONFIRMED

**Findings:**
- CSRF bypass для bearer-only API clients
- Без session cookie + bearer auth = CSRF не требуется
- Подходит для API клиентов (mobile apps, CLI tools)

### CSRF Risk on Upload/Artist Portal

**Evidence:**
- `backend/upload-service/middleware/csrfProtection.js:74-156` — CSRF middleware applied to upload-service
- `backend/artist-portal-service/server.js` — CSRF protection middleware applied
- `backend/artist-portal-service/routes/tracks.js` — All routes use bearer auth + CSRF

**Status:** ✅ CONFIRMED (Protected)

**Findings:**
- Upload-service имеет CSRF protection
- Artist-portal-service имеет CSRF protection
- Write routes используют bearer auth + CSRF
- **НЕТ риска CSRF bypass на upload/artist-portal**

---

## C. CORS Configuration

### ALLOWED_ORIGINS

**Evidence:**
- `backend/go-api-gateway/internal/config/config.go:84` — AllowedOrigins []string
- `backend/go-api-gateway/internal/config/config.go:166` — parseAllowedOrigins()
- `backend/upload-service/server.js:239-240` — allowedOrigins from ALLOWED_ORIGINS env
- `backend/playlist-service/server.js:94-96` — allowedOrigins from ALLOWED_ORIGINS/CORS_ORIGIN
- `backend/lyrics-service/server.js:204-206` — allowedOrigins from ALLOWED_ORIGINS/CORS_ORIGIN

**Status:** ✅ CONFIRMED

**Findings:**
- ALLOWED_ORIGINS environment variable используется во всех сервисах
- Разделённый список origins через запятую
- Нет wildcard origin (*) найдено

### Access-Control-Allow-Credentials

**Evidence:**
- `backend/ebap-hls-adapter/src/main.ts:581-598` — withCors() sets Access-Control-Allow-Credentials: true
- `backend/playlist-service/server.js:103` — cors() with credentials: true

**Status:** ✅ CONFIRMED

**Findings:**
- Credentials разрешены только для разрешённых origins
- Нет конфликта wildcard + credentials

### CORS Consistency

**Evidence:**
- Gateway: `backend/go-api-gateway/internal/httpx/middleware/cors.go` — CORS middleware
- Upload-service: `backend/upload-service/server.js:239-253` — manual CORS check
- Playlist-service: `backend/upload-service/server.js:94-106` — manual CORS check
- Lyrics-service: `backend/lyrics-service/server.js:204-216` — manual CORS check

**Status:** ⚠️ PARTIALLY CONFIRMED

**Findings:**
- CORS policy реализована по-разному в разных сервисах
- Gateway использует middleware
- Node сервисы используют manual checks
- **НЕПРОВЕРЕНО:** Идентична ли политика во всех сервисах

---

## D. Rate Limiting

### Gateway Rate Limiting

**Evidence:**
- `backend/go-api-gateway/internal/ratelimit/` — Redis-based rate limiting
- `gateway.yaml:10` — rate_limit: stream
- `gateway.yaml:75` — rate_limit: cover
- `gateway.yaml:121` — rate_limit: upload
- `gateway.yaml:267` — rate_limit: search

**Status:** ✅ CONFIRMED

**Findings:**
- Redis-based rate limiting в gateway
- Классы лимитов: stream, cover, upload, search
- Rate limit настраивается в gateway.yaml policies

### Service Rate Limiting

**Evidence:**
- `backend/upload-service/server.js:5` — express-rate-limit
- `backend/upload-service/server.js:290-299` — globalLimiter (200/1000 req per window)
- `backend/upload-service/server.js:299-301` — uploadLimiter (10 req per window)
- `backend/recommendations-service/server.js:112-130` — Redis store for rate limiting
- `backend/security-service/internal/store/sessions.go:195-226` — IncrRateLimit function

**Status:** ✅ CONFIRMED

**Findings:**
- express-rate-limit в Node сервисах
- Redis store для distributed rate limiting в production
- Upload service имеет отдельные лимиты для upload operations
- Security service имеет rate limiting для sensitive operations

### Public Endpoints Without Rate Limit

**Evidence:**
- `gateway.yaml:66-80` — /covers (static, rate_limit: cover)
- `gateway.yaml:135-142` — /api/recommendations (public, NO rate limit)
- `gateway.yaml:178-188` — /api/subscriptions/plans (public, NO rate limit)
- `gateway.yaml:258-268` — /api/search/v1 (public, rate_limit: search)

**Status:** ⚠️ CONFIRMED

**Findings:**
- /api/recommendations — без rate limit (публичный)
- /api/subscriptions/plans — без rate limit (публичный)
- /covers — имеет rate limit (cover)
- /api/search/v1 — имеет rate limit (search)

**Risk:** Medium — DoS атаки на публичные endpoints без rate limit

### Listen Events Rate Limiting (Sprint 1)

**Evidence:**
- `backend/database-service/routes/listens.js:2` — express-rate-limit imported
- `backend/database-service/routes/listens.js:6-17` — listenLimiter configuration
  - windowMs: 30 * 1000 (30 seconds)
  - max: 10 requests
  - keyGenerator: `${userId}:${songId}` (per user:track combination)
  - standardHeaders: true
  - legacyHeaders: false
- `backend/database-service/routes/listens.js:23` — listenLimiter applied to POST /

**Status:** ✅ CONFIRMED (Added in Sprint 1)

**Findings:**
- POST /api/listens now has rate limiting
- 10 requests per 30 seconds per user:track combination
- Prevents play count inflation via spam
- Error message: `{ error: 'Too many listen events for this track' }`

**Purpose:** Prevent analytics manipulation by spamming listen events

---

## E. Upload Security

### File Size Limits

**Evidence:**
- `backend/upload-service/server.js:539-551` — Multer storage configuration
- `nginx/nginx.conf:273-274` — client_max_body_size 250M for /api/artist-portal/
- `docker-compose.yml` — environment variables for upload limits

**Status:** ✅ CONFIRMED

**Findings:**
- Multer конфигурация для disk storage
- Nginx client_max_body_size 250M для artist-portal
- Размер файла ограничен на уровне Nginx и application

### MIME Validation

**Evidence:**
- `backend/upload-service/server.js:414-425` — getMimeType() function with whitelist
- `backend/upload-service/routes/userAvatarUpload.js:29` — MIME type check
- `backend/upload-service/routes/songCoverUpload.js:105` — MIME type check
- `backend/upload-service/routes/artistAssets.js:50` — MIME type check

**Status:** ✅ CONFIRMED

**Findings:**
- MIME type whitelist для разных типов файлов
- Проверка mimetype загружаемого файла
- Fallback к default MIME type если не в whitelist

### Magic Bytes Validation

**Evidence:**
- `backend/upload-service/lib/fileValidator.js` — file validation functions

**Status:** ⚠️ NOT VERIFIED

**Findings:**
- fileValidator.js существует
- **НЕПРОВЕРЕНО:** Используется ли magic bytes validation в production

### File Extensions

**Evidence:**
- `backend/upload-service/server.js:414-425` — Extension to MIME mapping
- `backend/upload-service/routes/*` — Extension checks

**Status:** ✅ CONFIRMED

**Findings:**
- Extension whitelist для разных типов файлов
- Проверка расширения файла

### Path Traversal Protection

**Evidence:**
- `backend/upload-service/lib/storage.js` — S3 storage abstraction
- `backend/upload-service/lib/storage.js:695-708` — MIME type mapping

**Status:** ⚠️ NOT VERIFIED

**Findings:**
- S3 storage используется для хранения файлов
- **НЕПРОВЕРЕНО:** Есть ли защита от path traversal в filename

### MinIO Access

**Evidence:**
- `docker-compose.yml` — MinIO configuration with MINIO_ROOT_USER, MINIO_ROOT_PASSWORD
- `backend/upload-service/lib/storage.js` — S3 client for MinIO

**Status:** ✅ CONFIRMED

**Findings:**
- MinIO используется как S3-compatible storage
- Authentication через MINIO_ROOT_USER/MINIO_ROOT_PASSWORD
- **НЕПРОВЕРЕНО:** Публичны ли buckets covers/audio

---

## F. WebSocket Security

### JWT/Ticket Authentication

**Evidence:**
- `backend/device-sync-service/internal/httpapi/routes.go:308-338` — issueTicket() function
- `backend/device-sync-service/internal/websocket/handler.go:14` — WebSocket upgrade handler
- `backend/party-go/internal/partygw/gateway.go` — Party WebSocket gateway

**Status:** ✅ CONFIRMED

**Findings:**
- Device sync использует ticket-based authentication
- Party использует WebSocket с JWT/ticket
- Ticket генерируется с TTL

### Origin Validation

**Evidence:**
- `backend/device-sync-service/internal/httpapi/middleware.go:386-395` — corsMiddleware()
- `backend/party-go/internal/partygw/gateway.go` — CORS middleware

**Status:** ⚠️ NOT VERIFIED

**Findings:**
- CORS middleware существует
- **НЕПРОВЕРЕНО:** Проверяется ли Origin при WebSocket upgrade
- **НЕПРОВЕРЕНО:** Удаляет ли gateway Origin/Referer для WebSocket (что может сломать проверку)

### Reconnect Limit

**Evidence:**
- `backend/device-sync-service/internal/httpapi/routes.go:308-338` — issueTicket() with TTL

**Status:** ⚠️ NOT VERIFIED

**Findings:**
- Ticket имеет TTL
- **НЕПРОВЕРЕНО:** Есть ли limit на количество reconnection attempts

### WebSocket Lifetime

**Evidence:**
- `backend/device-sync-service/internal/httpapi/routes.go:308-338` — issueTicket() with TTL
- `backend/party-go/internal/partygw/gateway.go` — WebSocket timeout configuration

**Status:** ⚠️ PARTIALLY CONFIRMED

**Findings:**
- Ticket TTL существует
- **НЕПРОВЕРЕНО:** Есть ли idle timeout для WebSocket connections

---

## G. Header Security

### Header Stripping

**Evidence:**
- `backend/go-api-gateway/internal/httpx/middleware/headers.go:17-34` — InternalHeaderSanitizer
- `backend/go-api-gateway/internal/app/server.go` — InternalHeaderSanitizer applied BEFORE session auth

**Headers Stripped:**
- X-User-Id, X-User-ID, x-user-id
- X-User-Name, X-User-NAME, x-user-name
- X-User-Role, x-user-role
- X-Service-Token, X-Service-Name
- X-Correlation-Id
- X-Earflow-Upload-Context

**Status:** ✅ CONFIRMED

**Findings:**
- InternalHeaderSanitizer удаляет spoofed headers
- Applied BEFORE session auth middleware (critical for security)
- Защищает от header spoofing attacks

### Gateway Sets X-User-Id

**Evidence:**
- `backend/go-api-gateway/internal/proxy/reverse_proxy.go:26-37` — Header constants
- `backend/go-api-gateway/internal/proxy/reverse_proxy.go` — Gateway sets X-User-Id from session

**Status:** ✅ CONFIRMED

**Findings:**
- Gateway устанавливает X-User-Id из session после auth
- Gateway устанавливает X-User-Name, X-User-Role
- Gateway устанавливает X-Service-Token для service-to-service

### X-User-Id Spoofing Risk

**Evidence:**
- `backend/go-api-gateway/internal/httpx/middleware/headers.go:17-34` — Strips X-User-Id
- `backend/go-api-gateway/internal/app/server.go` — Applied before session auth
- `backend/direct-stream-service/src/main.ts:32-36` — readUserId() reads X-User-Id from headers

**Status:** ✅ CONFIRMED (Protected)

**Findings:**
- Gateway удаляет клиентский X-User-Id
- Direct-stream-service читает X-User-Id от gateway (доверяет gateway)
- **НЕТ риска spoofing** — только gateway может установить X-User-Id

### WebSocket Header Stripping

**Evidence:**
- `backend/go-api-gateway/internal/httpx/middleware/headers.go:17-34` — Strips headers for all requests

**Status:** ⚠️ POTENTIAL ISSUE

**Findings:**
- InternalHeaderSanitizer применяется ко всем requests
- **ПОТЕНЦИАЛЬНАЯ ПРОБЛЕМА:** Удаляет ли Origin/Referer для WebSocket upgrade?
- **НЕПРОВЕРЕНО:** Может ли это сломать WebSocket Origin validation в backend сервисах

---

## H. SQL/Database Security

### Parameterized Queries

**Evidence:**
- `backend/upload-service/lib/db/users.js:8` — `SELECT ... WHERE id = $1` (parameterized)
- `backend/upload-service/lib/db/songs.js:321` — `INSERT INTO songs (...) VALUES (...)` (parameterized)
- `backend/upload-service/lib/db/likes.js:39` — `INSERT INTO likes (...) VALUES (...)` (parameterized)
- `backend/subscription-service/src/server.ts:66` — sql tagged template literals (parameterized)
- `backend/security-service/internal/store/postgres.go:138` — `UPDATE users SET ... WHERE id = $1` (parameterized)

**Status:** ✅ CONFIRMED

**Findings:**
- Все найденные SQL queries используют parameterized queries ($1, $2, etc.)
- Node сервисы используют pg client с parameterization
- Go/TypeScript сервисы используют sql tagged templates (parameterized)
- **НЕТ string concatenation в SQL queries найдено**

### Raw Query/String Concatenation

**Evidence:**
- Grep search по `SELECT.*WHERE|INSERT INTO|UPDATE.*SET` показал только parameterized queries

**Status:** ✅ CONFIRMED (No raw queries found)

**Findings:**
- Нет найденных raw SQL queries с string concatenation
- Все queries используют placeholders

### Database Role Separation

**Evidence:**
- `docker-compose.yml` — DB_USER, DB_PASSWORD environment variables
- `docker-compose.yml` — Один DB_USER для всех сервисов

**Status:** ❌ CONFIRMED (No role separation)

**Findings:**
- Все сервисы используют одинаковый DB_USER
- Нет разделения на read-only vs read-write roles
- **M-10 из comprehensive-security-plan.md подтверждён:** No database role separation

### DB Migrations

**Evidence:**
- `backend/00-create-tables.sql` — Initial schema
- `backend/02-recommendations-schema.sql` — Recommendations schema
- `backend/03-subscription-schema.sql` — Subscription schema
- `backend/04-mood-schema.sql` — Mood schema

**Status:** ✅ CONFIRMED

**Findings:**
- SQL миграции существуют для schema changes
- Миграции versioned (00, 02, 03, 04)
- **НЕПРОВЕРЕНО:** Есть ли миграционный tool для автоматического применения

---

## I. Nginx Security

### Security Headers

**Evidence:**
- `nginx/nginx.conf:20` — server_tokens off
- `nginx/nginx.conf:53-61` — Security headers:
  - Strict-Transport-Security (HSTS preload)
  - X-Frame-Options (SAMEORIGIN)
  - X-Content-Type-Options (nosniff)
  - Referrer-Policy (strict-origin-when-cross-origin)
  - Permissions-Policy (geolocation, microphone, camera, payment restricted)
  - Content-Security-Policy (default-src 'self', strict CSP)
  - X-Download-Options (noopen)
  - X-Permitted-Cross-Domain-Policies (none)

**Status:** ✅ CONFIRMED

**Findings:**
- Comprehensive security headers
- HSTS with preload enabled
- Strict CSP with 'self' default
- Permissions-Policy restricts sensitive features

### TLS/HSTS

**Evidence:**
- `nginx/nginx.conf:45-47` — listen 443 ssl, http2 on
- `nginx/nginx.conf:50-51` — SSL certificates from Let's Encrypt
- `nginx/nginx.conf:53` — HSTS max-age=63072000; includeSubDomains; preload

**Status:** ✅ CONFIRMED

**Findings:**
- TLS 1.2+ с Let's Encrypt certificates
- HTTP/2 enabled
- HSTS preload enabled (2 years)

### Body Size Limit

**Evidence:**
- `nginx/nginx.conf:273-274` — client_max_body_size 250M for /api/artist-portal/
- `nginx/nginx.conf:70-rate-limits.conf` — (нужно проверить)

**Status:** ⚠️ PARTIALLY CONFIRMED

**Findings:**
- 250M limit для artist-portal upload
- **НЕПРОВЕРЕНО:** Есть ли global body size limit
- **НЕПРОВЕРЕНО:** Есть ли limit для других endpoints

### Timeout Limits

**Evidence:**
- `nginx/nginx.conf:70-rate-limits.conf` — (нужно проверить)
- `gateway.yaml:11` — timeout: 12s for ebap_hls_session
- `gateway.yaml:32` — timeout: 10s for direct_stream_session

**Status:** ⚠️ PARTIALLY CONFIRMED

**Findings:**
- Gateway имеет timeouts для specific routes
- **НЕПРОВЕРЕНО:** Есть ли global timeouts в Nginx

### limit_req / limit_conn

**Evidence:**
- `nginx/nginx.conf:63-64` — limit_req zone=api_limit burst=1000 nodelay
- `nginx/nginx.conf:63-64` — limit_conn conn_limit 100
- `nginx/nginx.conf:70-rate-limits.conf` — (нужно проверить)

**Status:** ⚠️ PARTIALLY CONFIRMED

**Findings:**
- Basic rate limiting в Nginx (api_limit, conn_limit)
- **НЕПРОВЕРЕНО:** Полная конфигурация в 70-rate-limits.conf

### Dangerous Methods

**Evidence:**
- `nginx/nginx.conf` — (нужно проверить)

**Status:** ❌ NOT VERIFIED

**Findings:**
- **НЕПРОВЕРЕНО:** Запрещены ли опасные методы (TRACE, TRACK, etc.)

### Health/Metrics Public Access

**Evidence:**
- `nginx/nginx.conf:66-70` — /nginx-health endpoint (public)
- `API_ROUTES.md` — /health, /metrics endpoints в backend сервисах

**Status:** ⚠️ PARTIALLY CONFIRMED

**Findings:**
- /nginx-health доступен публично
- **НЕПРОВЕРЕНО:** Доступны ли /health и /metrics из интернета
- **НЕПРОВЕРЕНО:** Ограничен ли доступ к /metrics

### WebSocket Headers

**Evidence:**
- `nginx/nginx.conf:76-88` — proxy_set_header for /api/
- **НЕПРОВЕРЕНО:** Конфигурация для /ws/ endpoints

**Status:** ❌ NOT VERIFIED

**Findings:**
- **НЕПРОВЕРЕНО:** Правильно ли проксируются WebSocket headers
- **НЕПРОВЕРЕНО:** Удаляется ли Origin/Referer для WebSocket

---

## J. Secrets Management

### Hardcoded Secrets Search

**Evidence:**
- Grep search по `SECRET|SECRET_KEY|PRIVATE_KEY|password.*=|token.*=` показал только environment variable references
- `SERVICE_MAP.md` — перечислены все secret environment variables
- `SECURITY.md` — описаны все secret environment variables

**Status:** ✅ CONFIRMED (No hardcoded secrets found)

**Findings:**
- Нет найденных hardcoded secrets в коде
- Все секреты читаются из environment variables
- Секреты описаны в документации

### .env in Git

**Evidence:**
- `.gitignore` — (нужно проверить)
- `docker-compose.yml` — использует environment variables

**Status:** ⚠️ NOT VERIFIED

**Findings:**
- **НЕПРОВЕРЕНО:** Добавлен ли .env в .gitignore
- **НЕПРОВЕРЕНО:** Есть ли .env в git history

### .env.example Contains Real Values

**Evidence:**
- `.env.example` — создан с placeholder values

**Status:** ✅ CONFIRMED

**Findings:**
- .env.example содержит placeholder values (change_this_password_in_production)
- Нет реальных секретов в .env.example

---

## Summary

### Confirmed Security Controls

| Control | Status | Evidence |
|---------|--------|----------|
| JWT Verification | ✅ CONFIRMED | session_manager.go, authenticateUser.js |
| Refresh Token Rotation | ⚠️ PARTIALLY | endpoint exists, implementation not verified |
| Cookie Flags | ✅ CONFIRMED | cookies.go, config.go |
| Session Encryption | ✅ CONFIRMED | session_store.go, session_crypto.go |
| CSRF Double-Submit | ✅ CONFIRMED | csrf.go, csrfProtection.js |
| CSRF Unsafe Methods | ✅ CONFIRMED | reverse_proxy.go, csrfProtection.js |
| CSRF Origin/Referer | ✅ CONFIRMED | csrfProtection.js |
| CSRF Bearer Bypass | ✅ CONFIRMED | csrfProtection.js |
| ALLOWED_ORIGINS | ✅ CONFIRMED | config.go, multiple services |
| CORS Credentials | ✅ CONFIRMED | ebap-hls-adapter, playlist-service |
| Gateway Rate Limit | ✅ CONFIRMED | ratelimit/, gateway.yaml |
| Service Rate Limit | ✅ CONFIRMED | express-rate-limit, Redis store |
| Upload Size Limit | ✅ CONFIRMED | multer, nginx.conf |
| Upload MIME Validation | ✅ CONFIRMED | getMimeType(), route checks |
| Upload Extensions | ✅ CONFIRMED | extension whitelists |
| Upload Magic Bytes | ⚠️ NOT VERIFIED | fileValidator.js exists |
| Upload Path Traversal | ⚠️ NOT VERIFIED | S3 storage abstraction |
| MinIO Access | ✅ CONFIRMED | docker-compose.yml, storage.js |
| WebSocket JWT/Ticket | ✅ CONFIRMED | device-sync, party-go |
| WebSocket Origin | ⚠️ NOT VERIFIED | corsMiddleware exists |
| WebSocket Reconnect Limit | ⚠️ NOT VERIFIED | ticket TTL exists |
| Header Stripping | ✅ CONFIRMED | headers.go, server.go |
| Gateway Sets X-User-Id | ✅ CONFIRMED | reverse_proxy.go |
| X-User-Id Spoofing | ✅ CONFIRMED (Protected) | headers.go strips before auth |
| WebSocket Header Stripping | ⚠️ POTENTIAL ISSUE | may strip Origin/Referer |
| SQL Parameterization | ✅ CONFIRMED | all queries use $1, $2 placeholders |
| Raw SQL Queries | ✅ CONFIRMED (None) | grep search found none |
| DB Role Separation | ❌ CONFIRMED (None) | single DB_USER for all services |
| DB Migrations | ✅ CONFIRMED | 00, 02, 03, 04 .sql files |
| Nginx Security Headers | ✅ CONFIRMED | nginx.conf |
| Nginx TLS/HSTS | ✅ CONFIRMED | nginx.conf |
| Nginx Body Size | ⚠️ PARTIALLY | 250M for artist-portal |
| Nginx Timeouts | ⚠️ PARTIALLY | gateway timeouts exist |
| Nginx limit_req/limit_conn | ⚠️ PARTIALLY | basic limits exist |
| Nginx Dangerous Methods | ❌ NOT VERIFIED | not checked |
| Health/Metrics Public | ⚠️ PARTIALLY | /nginx-health public |
| WebSocket Headers | ❌ NOT VERIFIED | not checked |
| Hardcoded Secrets | ✅ CONFIRMED (None) | grep search found none |
| .env in Git | ⚠️ NOT VERIFIED | .gitignore not checked |
| .env.example Safe | ✅ CONFIRMED | placeholder values |

### High Priority Issues

1. **No Database Role Separation** (CONFIRMED) — M-10 from comprehensive-security-plan.md
2. **Public Endpoints Without Rate Limit** (CONFIRMED) — /api/recommendations, /api/subscriptions/plans
3. **WebSocket Header Stripping** (POTENTIAL) — May strip Origin/Referer for WebSocket
4. **Health/Metrics Public Access** (PARTIALLY VERIFIED) — Need to verify if accessible from internet
5. **Nginx Dangerous Methods** (NOT VERIFIED) — Need to verify TRACE/TRACK blocking

### Medium Priority Issues

1. **Refresh Token Encryption** (NOT VERIFIED) — H-2 from comprehensive-security-plan.md
2. **Cookie Flags Consistency** (NOT VERIFIED) — H-4 from comprehensive-security-plan.md
3. **Upload Magic Bytes Validation** (NOT VERIFIED) — fileValidator.js exists but usage not verified
4. **Upload Path Traversal Protection** (NOT VERIFIED) — Need to verify filename sanitization
5. **MinIO Bucket Publicity** (NOT VERIFIED) — Need to verify if buckets are public
6. **WebSocket Origin Validation** (NOT VERIFIED) — Need to verify Origin check on upgrade
7. **WebSocket Reconnect Limit** (NOT VERIFIED) — Need to verify reconnect attempt limit
8. **Nginx Global Configuration** (NOT VERIFIED) — Need to verify global body size, timeouts, limits

### Low Priority Issues

1. **CORS Consistency** (PARTIALLY CONFIRMED) — Different implementations across services
2. **DB Migration Tool** (NOT VERIFIED) — Migrations exist but tool not verified
3. **.env in Git** (NOT VERIFIED) — Need to verify .gitignore

### Next Steps

1. Verify refresh token encryption in Redis
2. Verify cookie flags consistency across services
3. Verify upload magic bytes validation usage
4. Verify upload path traversal protection
5. Verify MinIO bucket publicity
6. Verify WebSocket Origin validation on upgrade
7. Verify WebSocket reconnect limits
8. Verify Nginx global configuration (body size, timeouts, limits, dangerous methods)
9. Verify health/metrics public access
10. Verify .gitignore includes .env

---

## K. Artist Analytics Security (Sprint 2)

### Public Endpoint Exposure

**Problem:** `GET /api/artists/:artist/analytics` was initially exposed via `gateway.yaml` prefix match on `/api/artists` with `class: public`. This would have leaked private metrics (unique listeners, skip rate, engagement, daily trends) to any unauthenticated user.

**Fix Applied:** Renamed endpoint to `/internal/artists/:artist/analytics`.

**Evidence:**
- `backend/artist-service/server.js:973` — `app.get('/internal/artists/:artist/analytics', ...)`
- `backend/go-api-gateway/gateway.yaml:270-278` — `/api/artists` prefix match with `class: public`
- `backend/go-api-gateway/gateway.artist.yaml:2-13` — `/api/artists` prefix match with `class: public`
- No gateway route matches `/internal/` prefix

**Status:** ✅ FIXED

### IDOR Protection

**Evidence:**
- `backend/artist-portal-service/server.js:679-684` — `fetchArtistMe({ bearer })` returns authenticated user's artistName
- `backend/artist-portal-service/server.js:696` — `me.data.artistName` used (not user input)
- No `req.params`, `req.query`, or `req.body` used for artist identification

**Status:** ✅ CONFIRMED (Protected)

### MFA Gate

**Evidence:**
- `backend/artist-portal-service/server.js:688-694` — `fetchMfaStatus({ bearer })`, returns 403 if MFA not enabled
- `artist-frontend/src/App.js:92-98` — `<ProtectedRoute allowWithoutMfa={false}>`

**Status:** ✅ CONFIRMED

### Input Validation

**Evidence:**
- `backend/artist-portal-service/server.js:697-698` — days: `Math.min(Math.max(..., 1), 90)`, topTracks: `Math.min(Math.max(..., 1), 50)`
- `backend/artist-service/server.js:981-982` — duplicated server-side validation
- `backend/artist-service/lib/db/artistAnalytics.js:59,126` — duplicated in DB module

**Status:** ✅ CONFIRMED (triple-validated)

### SQL Injection Prevention

**Evidence:**
- `backend/artist-service/lib/db/artistAnalytics.js:65-100` — all queries use `$1`, `$2`, `$3` placeholders
- `ARTIST_SPLIT_REGEX` is a compile-time constant (line 5), not user input
- `buildArtistMatchSql` injects SQL fragments at build time, not user data

**Status:** ✅ CONFIRMED (Parameterized)

**Note:** `ARTIST_SPLIT_REGEX` is used in `regexp_split_to_table(COALESCE(${columnSql}, ''), '${ARTIST_SPLIT_REGEX}')`. The regex is a hardcoded constant (`String.raw`), not derived from user input. The user-supplied artist name flows through `$1` parameter only. No injection vector.

### Service-to-Service Auth (Hardening Pass)

**Evidence:**
- `backend/artist-service/server.js:973-990` — inline middleware reads `INTERNAL_SERVICE_TOKEN` from env, requires `X-Internal-Token` header, uses `crypto.timingSafeEqual` for comparison
- `backend/artist-portal-service/server.js:703` — sends `X-Internal-Token: process.env.INTERNAL_SERVICE_TOKEN` in headers
- `backend/go-api-gateway/internal/httpx/middleware/headers.go:30` — `h.Del("X-Internal-Token")` strips header from browser requests
- `.env.example:188` — `INTERNAL_SERVICE_TOKEN=change_this_internal_service_token_minimum_32_chars`
- `docker-compose.yml:662,693` — both services receive `INTERNAL_SERVICE_TOKEN` env var

**Status:** ✅ CONFIRMED

**Controls:**
- Token must be ≥32 characters (returns 503 if misconfigured)
- Missing token → 401 SERVICE_TOKEN_REQUIRED
- Wrong token → 403 SERVICE_TOKEN_INVALID
- Gateway strips X-Internal-Token from browser → prevents spoofing
- Token value never logged

### Nginx Edge Deny for /internal/ (Hardening Pass)

**Evidence:**
- `nginx/nginx.conf:254-256` — `location ^~ /internal/ { return 404; }` in artists.earflow.ru vhost

**Status:** ✅ CONFIRMED (Defense-in-depth)

**Note:** Even without this block, `/internal/` was unreachable — nginx only proxied `/api/` and `/covers/` paths. The explicit deny prevents accidental exposure if a catch-all location is added later.

### Public Meta Endpoint — No Private Field Leak

**Evidence:**
- `backend/artist-service/server.js:899-912` — explicit response construction with only: artist, artistId, artistPublicId, isVerified, hasOwner, bio, trackCount, albumCount, totalPlays, heroCoverPath, avatarCoverPath, bannerCoverPath, topTrack
- `getArtistMeta()` returns uniqueListenersMonthly/AllTime, likesCount, dislikesCount, playlistAdds — but the handler filters them out
- No spread operator (`...meta`) in the public response

**Status:** ✅ CONFIRMED (No private fields leaked)

### Dashboard Metrics Internal Endpoint (Dashboard Data Flow Fix)

**Evidence:**
- `backend/artist-service/server.js:972-1005` — `GET /internal/artists/:artist/dashboard-metrics` with X-Internal-Token middleware
- Middleware: checks INTERNAL_SERVICE_TOKEN length ≥32, validates X-Internal-Token with timingSafeEqual
- Response: { monthlyPlays, totalPlaysAllTime, uniqueListenersMonthly, uniqueListenersAllTime, likesCount, dislikesCount, playlistAdds }
- `backend/artist-portal-service/server.js:662-685` — dashboard endpoint calls internal endpoint and merges metrics into meta

**Status:** ✅ CONFIRMED (Secure data flow)

**Purpose:** Dashboard receives private metrics only through protected portal endpoint, public meta remains safe
