# Earflow Service Map

Карта всех сервисов платформы Earflow с назначением, маршрутами, зависимостями и рисками.

## Legend

- **Critical:** Сбой этого сервиса полностью блокирует платформу
- **High:** Сбой значительно ухудшает UX или блокирует ключевые функции
- **Medium:** Снижение функциональности, но платформа работает
- **Low:** Вспомогательные функции

---

## Gateway Layer

### api-gateway (Go)
**Назначение:** Основной API Gateway для слушателей — маршрутизация, auth, CSRF, rate limits

**Основные файлы:**
- `backend/go-api-gateway/gateway.yaml` — конфигурация маршрутов
- `backend/go-api-gateway/gateway.artist.yaml` — маршруты артистов
- `backend/go-api-gateway/internal/app/server.go` — инициализация сервера
- `backend/go-api-gateway/internal/proxy/reverse_proxy.go` — проксирование запросов
- `backend/go-api-gateway/internal/auth/session_manager.go` — управление сессиями
- `backend/go-api-gateway/internal/auth/csrf.go` — CSRF защита

**Порт:** 3000

**Входящие маршруты (через Nginx):**
- `/api/*` — все API запросы
- `/api/stream/v2/*` — direct streaming
- `/api/ebap-hls/*` — EBAP HLS для iOS
- `/covers/*` — статические обложки

**Зависимости:**
- Redis (auth) — хранение сессий
- Redis (main) — rate limits, кэш
- auth-service — валидация JWT
- database-service — данные каталога
- upload-service — загрузка файлов
- direct-stream-service — стриминг
- ebap-hls-adapter — HLS для iOS
- recommendations-service — рекомендации
- search-service — поиск
- artist-service — данные артистов
- playlist-service — плейлисты
- lyrics-service — тексты песен

**Environment variables:**
- `JWT_SECRET` — секрет для JWT
- `SESSION_ENCRYPTION_KEY` — шифрование сессий в Redis
- `REDIS_PASSWORD` — пароль Redis
- `COOKIE_DOMAIN`, `COOKIE_SAMESITE`, `COOKIE_SECURE` — настройки cookies
- `SERVICE_KEY_*` — ключи service-to-service auth

**Риски:**
- **Critical:** Полный отказ всех API
- **High:** CSRF bypass, session hijacking
- **Medium:** Rate limit evasion

**Что нельзя ломать:**
- CSRF защита на unsafe методах
- Session middleware (установка X-User-Id)
- Header stripping (удаление spoofed headers)
- Rate limiting

**Тесты:**
- `backend/go-api-gateway/internal/auth/session_store_test.go`

---

### artist-api-gateway (Go)
**Назначение:** API Gateway для артистов — маршрутизация Artist Portal

**Основные файлы:**
- `backend/go-api-gateway/gateway.artist.yaml` — конфигурация маршрутов
- Использует тот же код что и api-gateway, но с отдельным конфигом

**Порт:** 3000

**Входящие маршруты:**
- `/api/artist-portal/*` — API Artist Portal

**Зависимости:**
- Redis (auth)
- artist-portal-service
- artist-service
- upload-service

**Риски:**
- **High:** Отказ Artist Portal (загрузка треков, управление карточкой)

---

## Auth & Security Layer

### auth-service (Node.js)
**Назначение:** Аутентификация, авторизация, MFA, профили пользователей

**Основные файлы:**
- `backend/auth-service/server.js` — основной сервер
- `backend/auth-service/lib/mfa/httpRoutes.js` — MFA endpoints
- `backend/auth-service/lib/mfa/stepUp.js` — MFA step-up логика

**Порт:** 3001

**Входящие маршруты:**
- `/api/auth/login` — вход
- `/api/auth/register` — регистрация
- `/api/auth/refresh` — refresh токен
- `/api/auth/2fa/*` — MFA endpoints
- `/api/auth/profile` — профиль

**Зависимости:**
- PostgreSQL — пользователи, MFA recovery codes
- Redis (auth) — step-up статус, rate limiting
- MinIO — аватары

**Environment variables:**
- `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`
- `ENCRYPTION_KEY` — шифрование данных
- `REDIS_PASSWORD`
- `SERVICE_KEY_AUTH_SERVICE`

**Риски:**
- **Critical:** Полный отказ входа/регистрации
- **High:** Account takeover через MFA bypass
- **Medium:** Утечка сессий

**Что нельзя ломать:**
- MFA step-up логика
- Refresh token rotation
- Password hashing (PBKDF2-SHA512)

**Тесты:** Нет

---

### security-service (Go)
**Назначение:** Управление безопасностью — сессии, recovery codes, аудит

**Основные файлы:**
- `backend/security-service/internal/httpapi/server.go` — HTTP API
- `backend/security-service/internal/store/sessions.go` — Redis сессии
- `backend/security-service/internal/recoverycodes/recoverycodes.go` — recovery codes

**Порт:** 3008

**Входящие маршруты:**
- `/api/security/*` — security endpoints

**Зависимости:**
- PostgreSQL
- Redis (auth)

**Environment variables:**
- `SERVICE_KEY_AUTH_SERVICE`
- `SECURITY_*` — настройки безопасности (PBKDF2, timeouts, limits)

**Риски:**
- **High:** Отказ MFA recovery, сессий
- **Medium:** Ограниченный аудит безопасности

**Что нельзя ломать:**
- Recovery code generation
- Session management
- Password policy enforcement

**Тесты:** Нет

---

## Data Layer

### database-service (Node.js)
**Назначение:** Основной API для данных каталога — песни, артисты, плейлисты

**Основные файлы:**
- `backend/database-service/server.js` — основной сервер
- `backend/database-service/routes/songs.js` — песни
- `backend/database-service/routes/playlists.js` — плейлисты

**Порт:** 3003

**Входящие маршруты:**
- `/api/songs/*` — песни
- `/api/artists/*` — артисты
- `/api/playlists/*` — плейлисты

**Зависимости:**
- PostgreSQL

**Environment variables:**
- `SERVICE_JWT_PRIVATE_KEY_B64`, `SERVICE_JWT_PUBLIC_KEY_B64`
- `SERVICE_KEY_*` — валидация service tokens
- `DB_*` — настройки подключения к БД

**Риски:**
- **Critical:** Отказ доступа к каталогу (песни, артисты, плейлисты)
- **Medium:** Медленные запросы

**Что нельзя ломать:**
- Service JWT validation
- SQL queries (параметризованные)
- Playlist tracks vs playlist_songs (использовать playlist_tracks)

**Тесты:** Нет

---

### search-service (Go)
**Назначение:** Полнотекстовый поиск через Meilisearch

**Основные файлы:**
- `backend/search-service/internal/server/server.go` — основной сервер
- `backend/search-service/internal/indexer/indexer.go` — индексация

**Порт:** 3010

**Входящие маршруты:**
- `/api/search/*` — поиск

**Зависимости:**
- PostgreSQL — source of truth
- Meilisearch — поисковый индекс
- Redis (main) — кэш результатов

**Environment variables:**
- `MEILI_MASTER_KEY`
- `LOG_LEVEL`, `SEARCH_*` — настройки поиска

**Риски:**
- **High:** Отказ поиска
- **Medium:** Устаревший индекс

**Что нельзя ломать:**
- Индексация при изменениях в БД
- Fallback на SQL если Meilisearch недоступен

**Тесты:** `go test ./...`

---

### recommendations-service (Node.js)
**Назначение:** ML-рекомендации на основе прослушиваний

**Основные файлы:**
- `backend/recommendations-service/server.js` — основной сервер
- `backend/recommendations-service/lib/worker.js` — worker для обработки событий
- `backend/recommendations-service/lib/sessionSecurity.js` — secure session IDs

**Порт:** 3006

**Входящие маршруты:**
- `/api/recommendations/*` — рекомендации

**Зависимости:**
- PostgreSQL — данные прослушиваний
- Redis (main) — кэш рекомендаций
- NATS JetStream — события прослушиваний

**Environment variables:**
- `RECO_SESSION_SECRET`
- `REDIS_PASSWORD`

**Риски:**
- **Medium:** Отказ рекомендаций (показывается дефолт)
- **Low:** Устаревшие рекомендации

**Что нельзя ломать:**
- Secure session ID generation (HMAC)
- Event processing из NATS

**Тесты:** `backend/recommendations-service/tests/`

---

## Media Layer

### upload-service (Node.js)
**Назначение:** Загрузка аудио и обложек, обработка файлов

**Основные файлы:**
- `backend/upload-service/server.js` — основной сервер
- `backend/upload-service/lib/storage.js` — MinIO integration
- `backend/upload-service/middleware/csrfProtection.js` — CSRF
- `backend/upload-service/middleware/authenticateUser.js` — auth middleware

**Порт:** 3002

**Входящие маршруты:**
- `/api/upload/*` — загрузка файлов

**Зависимости:**
- MinIO — хранилище файлов
- PostgreSQL — метаданные файлов
- Redis (main) — кэш, rate limits

**Environment variables:**
- `JWT_SECRET`
- `MEDIA_URL_SECRET`, `MEDIA_URL_TTL_SECONDS`
- `MINIO_*`
- `ALLOWED_ORIGINS`

**Риски:**
- **High:** Отказ загрузки (артисты не могут загружать треки)
- **Critical:** Загрузка вредоносных файлов
- **High:** CSRF bypass на upload

**Что нельзя ломать:**
- Валидация типов файлов (audio, images)
- CSRF protection
- File size limits
- Service JWT validation

**Тесты:** `backend/upload-service/test/`

---

### direct-stream-service (Node.js/TypeScript)
**Назначение:** Прямой стриминг аудио с подписанными URL/cookies

**Основные файлы:**
- `backend/direct-stream-service/src/main.ts` — основной сервер
- `backend/direct-stream-service/src/config.ts` — конфигурация
- `backend/direct-stream-service/src/auth/directUrlToken.ts` — URL tokens

**Порт:** 3012

**Входящие маршруты:**
- `/api/stream/v2/session` — создание сессии стриминга
- `/api/stream/v2/share` — share links
- `/api/stream/v2/*` — стриминг аудио

**Зависимости:**
- MinIO — аудио файлы
- PostgreSQL — метаданные треков
- Redis (main) — кэш сессий

**Environment variables:**
- `SYSTEM_ROOT_SECRET`
- `DIRECT_STREAM_URLTOKEN_SECRET`
- `DIRECT_STREAM_PUBLIC_ORIGIN`

**Риски:**
- **Critical:** Отказ стриминга (плеер не работает)
- **High:** Unauthorized access к аудио
- **Medium:** Кэш poisoning

**Что нельзя ломать:**
- Signature verification (HMAC-SHA256)
- User access control (mapSongAccess)
- Rate limiting на сессии

**Тесты:** Нет

---

### ebap-hls-adapter (Node.js/TypeScript)
**Назначение:** HLS адаптер для iOS стриминга (EBAP protocol)

**Основные файлы:**
- `backend/ebap-hls-adapter/src/server.ts` — основной сервер
- `backend/ebap-hls-adapter/src/crypto/crypto.ts` — криптография
- `backend/ebap-hls-adapter/src/hls/session.ts` — HLS сессии

**Порт:** 3013

**Входящие маршруты:**
- `/api/ebap-hls/v1/session` — создание HLS сессии
- `/api/ebap-hls/v1/lyrics.bin` — зашифрованные тексты

**Зависимости:**
- MinIO (ebap-cache, ebap-hls) — EBAP chunks, HLS segments
- Redis (main) — кэш сессий
- ebap-encoder-worker — генерация EBAP chunks
- ebap-hls-packager-worker — HLS packaging

**Environment variables:**
- `SYSTEM_ROOT_SECRET`
- `EBAP_TRACK_KEY_MASTER_SECRET`
- `EBAP_HLS_COOKIE_SECRET`
- `EBAP_HLS_URLTOKEN_SECRET`

**Риски:**
- **High:** Отказ iOS стриминга
- **Medium:** Устаревшие HLS segments

**Что нельзя ломать:**
- Track key derivation (HKDF-SHA256)
- Cookie/token verification
- Segment encryption

**Тесты:** Нет

---

## Artist Layer

### artist-service (Node.js)
**Назначение:** API данных артистов, заявки на карточки

**Основные файлы:**
- `backend/artist-service/server.js` — основной сервер

**Порт:** 3007

**Входящие маршруты:**
- `/api/artists/*` — данные артистов
- `/api/artist-claims/*` — заявки на карточки

**Зависимости:**
- PostgreSQL

**Environment variables:**
- `JWT_SECRET`
- `ARTIST_CLAIM_*` — настройки auto-review/approve

**Риски:**
- **Medium:** Отказ Artist Portal (данные артистов)
- **Low:** Заявки на карточки не обрабатываются

**Что нельзя ломать:**
- Auto-review логика
- Artist claim workflow

**Тесты:** Нет

---

### artist-portal-service (Node.js)
**Назначение:** Backend для Artist Portal — загрузка треков, управление карточкой

**Основные файлы:**
- `backend/artist-portal-service/server.js` — основной сервер
- `backend/artist-portal-service/routes/tracks.js` — загрузка треков
- `backend/artist-portal-service/middleware/csrfProtection.js` — CSRF

**Порт:** 3015

**Входящие маршруты:**
- `/api/artist-portal/*` — Artist Portal API

**Зависимости:**
- upload-service — проксирование загрузки
- artist-service — данные артистов
- auth-service — MFA step-up

**Environment variables:**
- `JWT_SECRET`
- `ARTIST_PORTAL_DISABLE_TRACK_UPLOAD_STEP_UP`
- `ALLOWED_ORIGINS`

**Риски:**
- **High:** Отказ Artist Portal
- **Critical:** MFA step-up bypass на upload

**Что нельзя ломать:**
- MFA step-up проверка на upload
- CSRF protection
- Bearer token validation

**Тесты:** `backend/artist-portal-service/__tests__/`

---

## Other Services

### playlist-service (Node.js)
**Назначение:** Управление плейлистами

**Основные файлы:**
- `backend/playlist-service/server.js` — основной сервер

**Порт:** 3009

**Входящие маршруты:**
- `/api/playlists/*` — плейлисты

**Зависимости:**
- PostgreSQL

**Риски:**
- **Medium:** Отказ плейлистов

**Тесты:** Нет

---

### lyrics-service (Node.js)
**Назначение:** Тексты песен

**Основные файлы:**
- `backend/lyrics-service/server.js` — основной сервер

**Порт:** 3011

**Входящие маршруты:**
- `/api/lyrics/*` — тексты

**Зависимости:**
- PostgreSQL

**Риски:**
- **Low:** Отказ текстов песен

**Тесты:** Нет

---

### device-sync-service (Go)
**Назначение:** Синхронизация воспроизведения между устройствами

**Основные файлы:**
- `backend/device-sync-service/internal/server/server.go` — основной сервер
- `backend/device-sync-service/internal/devices/registry.go` — реестр устройств

**Порт:** 3014

**Входящие маршруты:**
- WebSocket — realtime sync

**Зависимости:**
- PostgreSQL
- NATS JetStream — события воспроизведения

**Environment variables:**
- `DEVICE_SYNC_*`

**Риски:**
- **Low:** Отказ синхронизации устройств

**Тесты:** Нет

---

### party-go (Go)
**Назначение:** Party Sync — совместное прослушивание

**Основные файлы:**
- `backend/party-go/gateway.service.go` — Party Gateway
- `backend/party-go/state.service.go` — Party State

**Порты:** Gateway 3020, State 3021

**Входящие маршруты:**
- `/api/party/*` — Party API
- WebSocket — realtime party sync

**Зависимости:**
- NATS JetStream

**Риски:**
- **Low:** Отказ Party Sync

**Тесты:** Нет

---

## Workers

### ebap-encoder-worker (Node.js)
**Назначение:** Генерация EBAP chunks для iOS стриминга

**Основные файлы:**
- `backend/ebap-encoder-worker/src/worker.js` — основной worker

**Зависимости:**
- PostgreSQL — очередь треков
- MinIO (ebap-cache) — EBAP chunks
- pg_notify — уведомления о новых треках

**Риски:**
- **High:** Отказ iOS стриминга (нет EBAP chunks)

**Тесты:** Нет

---

### ebap-hls-packager-worker (Node.js)
**Назначение:** HLS packaging для iOS

**Основные файлы:**
- `backend/ebap-hls-packager-worker/src/worker.js` — основной worker

**Зависимости:**
- MinIO (ebap-hls) — HLS segments

**Риски:**
- **High:** Отказ iOS стриминга (нет HLS segments)

**Тесты:** Нет

---

### transcode-worker (Node.js)
**Назначение:** Транскодирование аудио в multiple qualities

**Основные файлы:**
- `backend/transcode-worker/src/worker.js` — основной worker
- `backend/transcode-worker/src/healthServer.js` — health endpoint

**Порт:** 3051 (health)

**Зависимости:**
- PostgreSQL — очередь транскодирования
- MinIO — аудио файлы
- FFmpeg — транскодирование
- pg_notify — уведомления

**Риски:**
- **Medium:** Отказ адаптивного качества (работает только оригинал)

**Тесты:** `backend/transcode-worker/src/healthServer.test.js`

---

### audio-features-worker (Python)
**Назначение:** Извлечение аудио features для ML

**Основные файлы:**
- `backend/audio-features-worker/worker.py` — основной worker

**Порт:** 3051 (health)

**Зависимости:**
- database-service — метаданные треков
- MinIO — аудио файлы

**Риски:**
- **Low:** Отказ audio features (рекомендации работают без них)

**Тесты:** Нет

---

### reco-feedback-worker (Node.js)
**Назначение:** Обработка feedback для рекомендаций

**Основные файлы:**
- `backend/reco-feedback-worker/src/worker.js` — основной worker

**Зависимости:**
- PostgreSQL — feedback данные
- recommendations-service — обновление рекомендаций

**Риски:**
- **Low:** Отказ feedback обработки (рекомендации работают без него)

**Тесты:** Нет

---

## Infrastructure Services

### PostgreSQL (pgvector:pg15)
**Назначение:** Основная БД с pgvector для векторного поиска

**Порт:** 5432 (internal only)

**Версия:** pgvector/pgvector:pg15

**Health check:** `pg_isready`

**Миграции:**
- `backend/00-create-tables.sql`
- `backend/02-recommendations-schema.sql`
- `backend/03-subscription-schema.sql`
- `backend/04-mood-schema.sql`

**Риски:**
- **Critical:** Полный отказ платформы (нет данных)
- **Critical:** Потеря данных без бэкапа

**Что нельзя ломать:**
- Schema без миграций
- pgvector extension

---

### Redis (main)
**Назначение:** Кэш, rate limits, service caches

**Порт:** 6379 (internal only)

**Версия:** redis:7.4.2-alpine3.21

**Health check:** `redis-cli ping`

**Конфигурация:**
- `maxmemory: 256mb`
- `maxmemory-policy: allkeys-lru`
- `appendonly: yes`

**Риски:**
- **High:** Отказ кэша (медленные запросы, нет rate limits)
- **Medium:** Потеря кэша при рестарте (восстанавливается из БД)

**Что нельзя ломать:**
- Password authentication (REDIS_PASSWORD)

---

### Redis (auth)
**Назначение:** Хранилище сессий и auth (no eviction)

**Порт:** 6379 (internal only)

**Версия:** redis:7.4.2-alpine3.21

**Конфигурация:**
- `maxmemory: 512mb`
- `maxmemory-policy: noeviction` — сессии не должны удаляться

**Риски:**
- **Critical:** Потеря всех сессий (пользователи разлогинятся)
- **High:** Отказ auth (невозможно войти)

**Что нельзя ломать:**
- No eviction policy
- Session encryption

---

### MinIO
**Назначение:** S3-совместимое хранилище объектов

**Порты:** 9000 (S3 API), 9001 (Console) — localhost only

**Версия:** minio/minio:RELEASE.2025-01-20T14-49-07Z

**Buckets:**
- `audio` — аудио файлы
- `covers` — обложки
- `ebap-cache` — EBAP chunks
- `ebap-hls` — HLS segments

**Health check:** `curl http://localhost:9000/minio/health/live`

**Риски:**
- **Critical:** Потеря аудио файлов (без бэкапа)
- **Critical:** Отказ стриминга (нет аудио)

**Что нельзя ломать:**
- Bucket permissions (covers: public, audio: private)
- Access control

---

### Meilisearch
**Назначение:** Полнотекстовый поисковый движок

**Порт:** 7700

**Health check:** HTTP GET /

**Риски:**
- **High:** Отказ поиска (есть fallback на SQL)
- **Medium:** Устаревший индекс

**Что нельзя ломать:**
- Master key (MEILI_MASTER_KEY)

---

### NATS JetStream
**Назначение:** Message bus для realtime (device-sync, party, recommendations)

**Порт:** 4222

**Риски:**
- **Medium:** Отказ realtime features
- **Low:** Потеря событий при рестарте (JetStream persists)

---

## Frontend Layer

### frontend (React)
**Назначение:** SPA для слушателей

**Порт:** 3004

**Основные файлы:**
- `frontend/src/App.js` — основной компонент
- `frontend/src/context/PlayerContext.js` — player context
- `frontend/src/playback/` — playback логика
- `frontend/src/player-core/` — vanilla TS player core

**Зависимости:**
- API Gateway — backend API
- Direct Stream / EBAP HLS — стриминг

**Environment variables:**
- `REACT_APP_API_URL`
- `REACT_APP_PUBLIC_ORIGIN`

**Риски:**
- **High:** Отказ фронтенда (пользователи не могут слушать музыку)

**Что нельзя ломать:**
- Player core logic
- Auth flow
- Streaming integration

**Тесты:** `npm test`

**Build:** `npm run build` (craco)

---

### artist-frontend (React)
**Назначение:** SPA для артистов

**Порт:** 3005

**Основные файлы:**
- `artist-frontend/src/App.js` — основной компонент
- `artist-frontend/src/state/auth/AuthContext.js` — auth context

**Зависимости:**
- Artist API Gateway
- Artist Portal Service

**Риски:**
- **Medium:** Отказ Artist Portal (артисты не могут управлять контентом)

**Тесты:** Нет

**Build:** `npm run build`

---

## Nginx Edge

### nginx
**Назначение:** Edge reverse proxy — TLS, CSP, CORS, rate limits, static cache

**Основные файлы:**
- `nginx/nginx.conf` — основной конфиг
- `nginx/conf.d/earflow.conf` — earflow.ru
- `nginx/conf.d/auth.conf` — auth.earflow.ru
- `nginx/conf.d/api.conf` — api.earflow.ru
- `nginx/conf.d/artists.conf` — artists.earflow.ru
- `nginx/conf.d/stream.conf` — strmhaha.earflow.ru

**Порты:** 80, 443

**Риски:**
- **Critical:** Полный отказ платформы (нет входа)
- **High:** TLS misconfiguration
- **High:** CSP bypass

**Что нельзя ломать:**
- TLS configuration
- Security headers (CSP, HSTS)
- Rate limiting
- Static cache configuration
