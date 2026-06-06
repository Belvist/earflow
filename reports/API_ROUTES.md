# Earflow API Routes Inventory

Полный список всех API routes платформы Earflow с классификацией по типу доступа и security controls.

## Legend

**Access Type:**
- **Public** — доступно без авторизации
- **Authenticated** — требуется пользовательский access/session token
- **Admin/Internal** — service-to-service, admin, worker endpoints, internal callbacks
- **Health/Metrics** — /health, /metrics, readiness/liveness
- **Unknown** — не удалось определить защиту

**Auth Required:**
- **Yes** — требуется проверка JWT/session token
- **No** — без авторизации
- **Service Token** — требуется service-to-service token

**CSRF Required:**
- **Yes** — CSRF защита включена (для unsafe методов)
- **No** — CSRF защита не требуется (safe methods/stream/static)
- **Bypass** — CSRF bypass для bearer-only API clients

**Rate Limit:**
- **Class** — класс rate limit (stream, cover, upload, search, etc.)
- **No** — без rate limit

**Risk:**
- **Critical** — критический риск безопасности
- **High** — высокий риск
- **Medium** — средний риск
- **Low** — низкий риск
- **None** — без риска

---

## Gateway Routes (go-api-gateway)

### gateway.yaml

| Service | Method | Route | Access Type | Auth Required | CSRF Required | Rate Limit | Source File | Risk |
|---------|--------|-------|-------------|---------------|---------------|------------|-------------|------|
| ebap_hls_adapter | POST | /api/ebap-hls/v1/session | Authenticated | Yes | Yes (unsafe) | stream | gateway.yaml:2-11 | Medium |
| ebap_hls_adapter | ALL | /api/ebap-hls | Authenticated | Yes | No (stream) | stream | gateway.yaml:13-21 | Medium |
| direct_stream | POST | /api/stream/v2/session | Authenticated | Yes | Yes (unsafe) | stream | gateway.yaml:23-32 | Medium |
| direct_stream | POST | /api/stream/v2/session/batch | Authenticated | Yes | Yes (unsafe) | stream | gateway.yaml:34-43 | Medium |
| direct_stream | POST | /api/stream/v2/share | Authenticated | Yes | Yes (unsafe) | stream | gateway.yaml:45-54 | Medium |
| direct_stream | ALL | /api/stream/v2 | Authenticated | Yes | No (stream) | stream | gateway.yaml:56-64 | Medium |
| upload | GET | /covers | Public | No (strip_auth) | No | cover | gateway.yaml:66-80 | Low |
| upload | GET | /api/songs/cover | Public | No (strip_auth) | No | cover | gateway.yaml:82-96 | Low |
| upload | GET | /api/songs/{id}/cover | Public | No | No | cover | gateway.yaml:98-110 | Low |
| upload | POST | /api/upload/user/avatar | Authenticated | Yes | Yes (unsafe) | upload | gateway.yaml:112-121 | Medium |
| auth | ALL | /api/auth | Public | No (auth_only) | No | No | gateway.yaml:123-131 | Low |
| auth | ALL | /api/verify | Public | No (auth_only) | No | No | gateway.yaml:123-131 | Low |
| auth | ALL | /api/profile | Public | No (auth_only) | No | No | gateway.yaml:123-131 | Low |
| recommendations | ALL | /api/recommendations | Public | No | No | No | gateway.yaml:135-142 | Low |
| database | GET | /api/songs/recommendations | Public | Service Token | No | No | gateway.yaml:144-152 | Medium |
| playlist | ALL | /api/playlists | Authenticated | Yes | Yes (unsafe) | No | gateway.yaml:154-164 | Medium |
| playlist | ALL | /api/queue | Authenticated | Yes | Yes (unsafe) | No | gateway.yaml:154-164 | Medium |
| playlist | GET | /api/playlists/discover | Public | No | No | No | gateway.yaml:166-176 | Low |
| subscription | GET | /api/subscriptions/plans | Public | No | No | No | gateway.yaml:178-188 | Low |
| subscription | ALL | /api/subscriptions | Authenticated | Yes | Yes (unsafe) | No | gateway.yaml:190-197 | Medium |
| playlist | ALL | /api/mix | Public | No | No | No | gateway.yaml:199-205 | Low |
| lyrics | GET | /api/lyrics/search | Authenticated | Yes + Service Token | No | No | gateway.yaml:207-216 | Medium |
| lyrics | ALL | /api/lyrics | Authenticated | Yes + Service Token | Yes (unsafe) | No | gateway.yaml:218-226 | Medium |
| party | ALL | /api/party | Authenticated | Yes | Yes (unsafe) | No | gateway.yaml:230-236 | Medium |
| party_v2_gateway | ALL | /ws/v2 | Authenticated | Yes | No (websocket) | No | gateway.yaml:238-245 | Medium |
| database | ALL | /api/songs/search | Public | Service Token | No | No | gateway.yaml:248-256 | Medium |
| search | GET | /api/search/v1 | Public | No | No | search | gateway.yaml:258-268 | Low |
| artist | ALL | /api/artists | Public | No | No | No | gateway.yaml:270-280 | Low |
| artist | ALL | /api/albums | Public | No | No | No | gateway.yaml:282-290 | Low |
| database | ALL | /api/songs | Public | Service Token | No | No | gateway.yaml:292-301 | Medium |
| upload | ALL | /api/likes | Authenticated | Yes | Yes (unsafe) | No | gateway.yaml:303-314 | Medium |
| upload | ALL | /api/dislikes | Authenticated | Yes | Yes (unsafe) | No | gateway.yaml:303-314 | Medium |
| upload | ALL | /api/eq | Authenticated | Yes | Yes (unsafe) | No | gateway.yaml:303-314 | Medium |
| metadata_parser | ALL | /api/metadata | Authenticated | Yes | Yes (unsafe) | No | gateway.yaml:316-323 | Medium |
| import_service | ALL | /api/import | Authenticated | Yes | Yes (unsafe) | No | gateway.yaml:325-332 | Medium |
| database | ALL | /api/user | Authenticated | Yes + Service Token | Yes (unsafe) | No | gateway.yaml:334-342 | Medium |
| device_sync | ALL | /api/devices | Authenticated | Yes | Yes (unsafe) | No | gateway.yaml:352-360 | Medium |
| device_sync | ALL | /ws/devices | Authenticated | Yes | No (websocket) | No | gateway.yaml:362-370 | Medium |

### gateway.artist.yaml

| Service | Method | Route | Access Type | Auth Required | CSRF Required | Rate Limit | Source File | Risk |
|---------|--------|-------|-------------|---------------|---------------|------------|-------------|------|
| artist | GET | /api/artists | Authenticated | Yes | No | artist_search | gateway.artist.yaml:2-13 | Medium |
| artist | GET | /api/artists/popular | Authenticated | Yes | No | artist_search | gateway.artist.yaml:15-26 | Medium |
| artist | GET,POST | /api/artists/claims | Authenticated | Yes | Yes (unsafe) | artist_claims | gateway.artist.yaml:28-40 | Medium |
| artist | GET,POST | /api/artists/admin | Authenticated | Yes | Yes (unsafe) | artist_claims | gateway.artist.yaml:42-54 | Medium |
| security | ALL | /api/auth/2fa/recovery | Authenticated | Yes | Yes (unsafe) | No | gateway.artist.yaml:59-67 | Medium |
| auth | ALL | /api/auth/2fa | Authenticated | Yes | Yes (unsafe) | No | gateway.artist.yaml:69-78 | Medium |
| security | ALL | /api/auth/security | Authenticated | Yes | Yes (unsafe) | No | gateway.artist.yaml:80-88 | Medium |
| security | ALL | /api/auth/password | Authenticated | Yes | Yes (unsafe) | No | gateway.artist.yaml:90-98 | Medium |
| security | POST | /api/auth/telegram/unlink | Authenticated | Yes | Yes (unsafe) | No | gateway.artist.yaml:100-110 | Medium |
| security | ALL | /api/auth/sessions | Authenticated | Yes | Yes (unsafe) | No | gateway.artist.yaml:112-120 | Medium |
| auth | ALL | /api/verify | Public | No (auth_only) | No | No | gateway.artist.yaml:122-134 | Low |
| auth | ALL | /api/profile | Public | No (auth_only) | No | No | gateway.artist.yaml:122-134 | Low |
| auth | ALL | /api/auth/profile | Public | No (auth_only) | No | No | gateway.artist.yaml:122-134 | Low |
| auth | ALL | /api/auth/verify | Public | No (auth_only) | No | No | gateway.artist.yaml:122-134 | Low |
| artist_portal | ALL | /api/artist-portal | Authenticated | Yes | Yes (unsafe) | No | gateway.artist.yaml:136-144 | Medium |

---

## Backend Service Routes

### auth-service

| Method | Route | Access Type | Auth Required | CSRF Required | Rate Limit | Source File | Risk |
|--------|-------|-------------|---------------|---------------|------------|-------------|------|
| GET | /health | Health/Metrics | No | No | No | server.js:880 | Low |
| GET | /metrics | Health/Metrics | No | No | No | server.js:906 | Low |
| POST | /api/auth/email/register | Public | No | No | authLimiter | server.js:1009 | Medium |
| POST | /api/auth/email/login | Public | No | No | authLimiter | server.js:1011 | Medium |
| POST | /api/auth/telegram/login | Public | No | No | authLimiter | server.js:1113 | Medium |
| POST | /api/auth/refresh | Public | No | No | No | server.js:1208 | High |
| POST | /api/verify | Public | No | No | No | server.js:1237 | Low |
| GET | /api/profile | Authenticated | Yes | No | No | server.js:1316 | Medium |
| GET | /api/auth/2fa/status | Authenticated | Yes | No | No | httpRoutes.js:174 | Medium |
| POST | /api/auth/2fa/setup | Authenticated | Yes | No | No | httpRoutes.js:192 | Medium |
| POST | /api/auth/2fa/enable | Authenticated | Yes | No | No | httpRoutes.js:229 | Medium |
| POST | /api/auth/2fa/step-up | Authenticated | Yes | No | No | httpRoutes.js:295 | Medium |
| GET | /api/auth/2fa/step-up/status | Authenticated | Yes | No | No | httpRoutes.js:353 | Medium |
| POST | /api/auth/2fa/disable | Authenticated | Yes | No | No | httpRoutes.js:380 | Medium |

### upload-service

| Method | Route | Access Type | Auth Required | CSRF Required | Rate Limit | Source File | Risk |
|--------|-------|-------------|---------------|---------------|------------|-------------|------|
| GET | /health | Health/Metrics | No | No | No | server.js:332 | Low |
| GET | /api/songs/user/:userId | Authenticated | Yes | No | No | server.js:554 | Medium |
| PUT | /api/songs/:id | Authenticated | Yes | No | No | server.js:582 | Medium |
| DELETE | /api/songs/:id | Authenticated | Yes | No | No | server.js:632 | Medium |
| GET | /api/likes | Authenticated | Yes | No | No | server.js:685 | Medium |
| POST | /api/likes/:songId | Authenticated | Yes | No | No | server.js:695 | Medium |
| DELETE | /api/likes/:songId | Authenticated | Yes | No | No | server.js:712 | Medium |
| GET | /api/eq | Authenticated | Yes | No | No | server.js:730 | Medium |
| POST | /api/eq | Authenticated | Yes | No | No | server.js:740 | Medium |

### database-service

| Method | Route | Access Type | Auth Required | CSRF Required | Rate Limit | Source File | Risk |
|--------|-------|-------------|---------------|---------------|------------|-------------|------|
| GET | /health | Health/Metrics | No | No | No | server.js:121 | Low |
| GET | /metrics | Health/Metrics | No | No | No | server.js:148 | Low |
| POST | /auth/service-token | Admin/Internal | No | No | authLimiter | server.js:167 | Medium |
| ALL | /api/users | Admin/Internal | Service Token | No | apiLimiter | server.js:249 | Medium |
| ALL | /api/songs | Admin/Internal | Service Token | No | apiLimiter | server.js:250 | Medium |
| ALL | /api/song-features | Admin/Internal | Service Token | No | apiLimiter | server.js:251 | Medium |
| ALL | /api/playlists | Admin/Internal | Service Token | No | apiLimiter | server.js:252 | Medium |
| ALL | /api/listens | Admin/Internal | Service Token | No | apiLimiter | server.js:253 | Medium |
| ALL | /api/likes | Admin/Internal | Service Token | No | apiLimiter | server.js:254 | Medium |
| ALL | /api/dislikes | Admin/Internal | Service Token | No | apiLimiter | server.js:255 | Medium |
| ALL | /api/eq | Admin/Internal | Service Token | No | apiLimiter | server.js:256 | Medium |
| GET | /api/stats | Admin/Internal | Service Token | No | No | server.js:262 | Medium |
| DELETE | /api/cleanup-sessions | Admin/Internal | Service Token | No | No | server.js:288 | Medium |

### playlist-service

| Method | Route | Access Type | Auth Required | CSRF Required | Rate Limit | Source File | Risk |
|--------|-------|-------------|---------------|---------------|------------|-------------|------|
| GET | /health | Health/Metrics | No | No | No | server.js:148 | Low |
| GET | /metrics | Health/Metrics | No | No | No | server.js:178 | Low |
| ALL | /api/mix | Authenticated | Yes | No | No | server.js:203 | Medium |
| GET | /api/playlists/discover | Authenticated | Optional | No | No | server.js:215 | Low |
| ALL | /api/playlists/resolve | Authenticated | Yes | No | No | server.js:218 | Medium |
| ALL | /api/playlists/share | Authenticated | Yes | No | No | server.js:221 | Medium |
| ALL | /api/playlists | Authenticated | Yes | No | No | server.js:224 | Medium |
| ALL | /api/queue | Authenticated | Yes | No | No | server.js:225 | Medium |
| ALL | /internal/playlists/discover | Admin/Internal | Service Token | No | No | server.js:228 | Medium |
| ALL | /internal/playlists/share | Admin/Internal | Service Token | No | No | server.js:229 | Medium |
| ALL | /internal/playlists | Admin/Internal | Service Token | No | No | server.js:230 | Medium |

### artist-service

| Method | Route | Access Type | Auth Required | CSRF Required | Rate Limit | Source File | Risk |
|--------|-------|-------------|---------------|---------------|------------|-------------|------|
| GET | /health | Health/Metrics | No | No | No | server.js:734 | Low |
| GET | /metrics | Health/Metrics | No | No | No | server.js:739 | Low |
| GET | /api/artists/me | Authenticated | Yes | No | No | server.js:744 | Medium |
| GET | /api/artists | Public | No | No | No | server.js:762 | Low |
| GET | /api/artists/popular | Public | No | No | No | server.js:774 | Low |
| GET | /api/artists/:artist/meta | Public | No | No | No | server.js:864 | Low |
| GET | /api/artists/:artist/tracks | Public | No | No | No | server.js:972 | Low |
| GET | /api/artists/claims/my | Authenticated | Yes | No | No | server.js:464 | Medium |
| POST | /api/artists/claims | Authenticated | Yes | No | No | server.js:486 | Medium |
| PATCH | /api/artists/me/card | Authenticated | Yes | No | No | server.js:548 | Medium |
| GET | /api/artists/me/card | Authenticated | Yes | No | No | server.js:598 | Medium |
| GET | /api/artists/admin/claims | Authenticated | Yes | No | No | server.js:918 | Medium |
| POST | /api/artists/admin/claims/:id/review | Authenticated | Yes | No | No | server.js:933 | Medium |
| GET | /internal/artists/:artist/analytics | Admin/Internal | Service Token (INTERNAL_SERVICE_TOKEN) | No | No | server.js:1015 | Medium |
| GET | /internal/artists/:artist/dashboard-metrics | Admin/Internal | Service Token (INTERNAL_SERVICE_TOKEN) | No | No | server.js:972 | Medium |
| GET | /api/albums/resolve | Authenticated | Yes | No | No | server.js:645 | Medium |
| GET | /api/albums/:albumPublicId | Public | No | No | No | server.js:675 | Low |
| GET | /api/albums/:albumPublicId/tracks | Public | No | No | No | server.js:706 | Low |
| GET | /sitemap.xml | Public | No | No | limiter | sitemap/index.js:94 | Low |

### lyrics-service

| Method | Route | Access Type | Auth Required | CSRF Required | Rate Limit | Source File | Risk |
|--------|-------|-------------|---------------|---------------|------------|-------------|------|
| GET | /metrics | Health/Metrics | No | No | No | server.js:237 | Low |
| GET | /api/lyrics/:songId | Authenticated | Yes | No | No | server.js:382 | Medium |
| POST | /api/lyrics/import | Authenticated | Yes | No | No | server.js:423 | Medium |
| POST | /api/lyrics | Authenticated | Yes | No | No | server.js:462 | Medium |
| POST | /api/lyrics/plain | Authenticated | Yes | No | No | server.js:500 | Medium |
| PUT | /api/lyrics/:songId | Authenticated | Yes | No | No | server.js:547 | Medium |
| DELETE | /api/lyrics/:songId | Authenticated | Yes | No | No | server.js:591 | Medium |
| GET | /api/lyrics/search | Authenticated | Yes | No | No | server.js:626 | Medium |
| POST | /api/lyrics/:songId/report | Authenticated | Yes | No | No | server.js:679 | Medium |
| GET | /health | Health/Metrics | No | No | No | server.js:704 | Low |

### recommendations-service

| Method | Route | Access Type | Auth Required | CSRF Required | Rate Limit | Source File | Risk |
|--------|-------|-------------|---------------|---------------|------------|-------------|------|
| GET | /health | Health/Metrics | No | No | No | server.js:168 | Low |
| ALL | /api/recommendations | Authenticated | Yes | No | No | server.js:174 | Medium |

### direct-stream-service

| Method | Route | Access Type | Auth Required | CSRF Required | Rate Limit | Source File | Risk |
|--------|-------|-------------|---------------|---------------|------------|-------------|------|
| GET | /metrics | Health/Metrics | No | No | No | main.ts:569 | Low |
| GET | /health | Health/Metrics | No | No | No | main.ts:573 | Low |
| POST | /api/stream/v2/session | Authenticated | Yes | No | No | main.ts:577 | Medium |
| POST | /api/stream/v2/session/batch | Authenticated | Yes | No | No | main.ts:657 | Medium |
| POST | /api/stream/v2/share | Authenticated | Yes | No | No | main.ts:732 | Medium |
| GET | /audio/v1/* | Authenticated (via gateway) | Yes | No | No | main.ts:789 | Medium |

### ebap-hls-adapter

| Method | Route | Access Type | Auth Required | CSRF Required | Rate Limit | Source File | Risk |
|--------|-------|-------------|---------------|---------------|------------|-------------|------|
| GET | /metrics | Health/Metrics | No | No | No | main.ts | Low |
| GET | /ready | Health/Metrics | No | No | No | main.ts:774 | Low |
| POST | /api/ebap-hls/v1/session | Authenticated | Yes | No | session rate limit | main.ts:791 | Medium |
| GET | /api/ebap-hls/v1/lyrics | Authenticated (cookie) | Yes | No | No | main.ts:194 | Medium |
| GET | /api/ebap-hls/v1/lyrics/bin | Authenticated (cookie) | Yes | No | No | main.ts:256 | Medium |
| GET | /api/ebap-hls/* | Authenticated (token/cookie) | Yes | No | asset rate limit | main.ts | Medium |

### device-sync-service

| Method | Route | Access Type | Auth Required | CSRF Required | Rate Limit | Source File | Risk |
|--------|-------|-------------|---------------|---------------|------------|-------------|------|
| GET | /health | Health/Metrics | No | No | No | routes.go:339 | Low |
| GET | /ready | Health/Metrics | No | No | No | routes.go:352 | Low |
| POST | /api/devices/register | Authenticated | Yes | No | rate limit | routes.go:85 | Medium |
| POST | /api/devices/:deviceId/heartbeat | Authenticated | Yes | No | No | routes.go:124 | Medium |
| DELETE | /api/devices/:deviceId | Authenticated | Yes | No | No | routes.go:153 | Medium |
| GET | /api/devices | Authenticated | Yes | No | No | routes.go:177 | Medium |
| POST | /api/devices/transfer | Authenticated | Yes | No | No | routes.go:192 | Medium |
| POST | /api/devices/:deviceId/now-playing | Authenticated | Yes | No | No | routes.go:229 | Medium |
| GET | /api/devices/:deviceId/now-playing | Authenticated | Yes | No | No | routes.go:255 | Medium |
| POST | /api/devices/:deviceId/command | Authenticated | Yes | No | No | routes.go:274 | Medium |
| POST | /api/devices/ticket | Authenticated | Yes | No | No | routes.go:308 | Medium |
| ALL | /ws/devices | Authenticated | Yes | No (websocket) | No | routes.go | Medium |

### security-service

| Method | Route | Access Type | Auth Required | CSRF Required | Rate Limit | Source File | Risk |
|--------|-------|-------------|---------------|---------------|------------|-------------|------|
| GET | /health | Health/Metrics | No | No | No | server.go:75 | Low |
| GET | /metrics | Health/Metrics | No | No | No | server.go:115 | Low |
| GET | /api/auth/security/overview | Authenticated | Yes | No | No | handlers_overview.go:52 | Medium |
| POST | /api/auth/password/strength | Authenticated | Yes | No | No | handlers_password.go:16 | Medium |
| POST | /api/auth/password/change | Authenticated | Yes | No | No | handlers_password.go:71 | Medium |
| POST | /api/auth/telegram/unlink | Authenticated | Yes | No | No | handlers_telegram.go:15 | Medium |
| GET | /api/auth/sessions | Authenticated | Yes | No | No | handlers_sessions.go:15 | Medium |
| DELETE | /api/auth/sessions/others | Authenticated | Yes | No | No | handlers_sessions.go:31 | Medium |
| POST | /api/auth/2fa/recovery/regenerate | Authenticated | Yes | No | No | handlers_mfa.go:15 | Medium |

### artist-portal-service

| Method | Route | Access Type | Auth Required | CSRF Required | Rate Limit | Source File | Risk |
|--------|-------|-------------|---------------|---------------|------------|-------------|------|
| GET | /api/artist-portal/dashboard | Authenticated | Yes (bearer + isArtist + MFA) | No | No | server.js:633 | Medium |
| GET | /api/artist-portal/analytics | Authenticated | Yes (bearer + isArtist + MFA) | No | No | server.js:672 | Medium |
| GET | /api/artist-portal/tracks | Authenticated | Yes | Yes (bearer) | No | routes/tracks.js:46 | Medium |
| POST | /api/artist-portal/tracks | Authenticated | Yes | Yes (bearer) | No | routes/tracks.js:73 | Medium |
| PUT | /api/artist-portal/tracks/:id | Authenticated | Yes | Yes (bearer) | No | routes/tracks.js:103 | Medium |
| DELETE | /api/artist-portal/tracks/:id | Authenticated | Yes | Yes (bearer) | No | routes/tracks.js:136 | Medium |
| POST | /api/artist-portal/tracks/:id/cover | Authenticated | Yes | Yes (bearer) | No | routes/tracks.js:159 | Medium |
| POST | /api/artist-portal/tracks/:id/publish | Authenticated | Yes | Yes (bearer) | No | routes/tracks.js:192 | Medium |
| POST | /api/artist-portal/tracks/:id/unpublish | Authenticated | Yes | Yes (bearer) | No | routes/tracks.js:216 | Medium |
| POST | /api/artist-portal/artist-card/preview-token | Authenticated | Yes | Yes (bearer) | No | routes/preview.js:35 | Medium |
| PUT | /api/artist-portal/artist-card/preview-draft | Authenticated | Yes | Yes (bearer) | No | routes/preview.js:63 | Medium |
| GET | /api/artist-portal/public-preview/artist-meta | Public | No | No | No | routes/preview.js:98 | Low |

### party-go (party-gateway)

| Method | Route | Access Type | Auth Required | CSRF Required | Rate Limit | Source File | Risk |
|--------|-------|-------------|---------------|---------------|------------|-------------|------|
| GET | /health | Health/Metrics | No | No | No | main.go:19-39 | Low |
| ALL | /api/party/* | Authenticated | Yes | No | No | gateway.go | Medium |
| ALL | /ws/v2 | Authenticated | Yes | No (websocket) | No | gateway.go | Medium |

---

## Summary Statistics

**Total Routes:** ~120+

**By Access Type:**
- Public: ~25
- Authenticated: ~70
- Admin/Internal: ~15
- Health/Metrics: ~10
- Unknown: 0

**By Risk:**
- Critical: 0
- High: ~5
- Medium: ~80
- Low: ~35
- None: 0

**Key Findings:**
1. Gateway properly classifies routes with `class` (unsafe, stream, static, public, auth_only)
2. `require_user: true` is set for most authenticated routes
3. CSRF protection is enabled for `unsafe` class routes via gateway
4. Stream and static routes bypass CSRF (appropriate)
5. Service token authentication is used for internal service-to-service communication
6. Health/metrics endpoints are properly exposed for monitoring
7. WebSocket endpoints are properly marked with `websocket: true`

**Notes:**
- CSRF protection is enforced at the gateway level for `unsafe` class routes
- Bearer-only API clients can bypass CSRF (appropriate for API usage)
- Rate limiting is implemented via Redis with different classes (stream, cover, upload, search)
- All authenticated routes require JWT/session token verification
- Service tokens are used for internal communication between services
