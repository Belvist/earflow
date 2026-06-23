# API Contracts — Earflow iOS

All paths relative to `https://api.earflow.ru`. Auth headers per `AuthActor.gatewayAuthHeaders`.

## Auth

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/api/auth/email/login` | `{ email, password }` | `{ user, ok }` + cookies |
| POST | `/api/auth/email/register` | `{ email, password, firstName, username }` | same |
| POST | `/api/auth/telegram/login` | Telegram widget payload | same |
| POST | `/api/auth/device/register` | `{ authDeviceId, publicKeySpki }` | `{ authDeviceId, sidHash, ok }` |
| POST | `/api/auth/proof/token` | — | `{ token, expiresIn }` |
| POST | `/api/auth/logout` | — | — |
| GET | `/api/public-config` | — | `{ telegramBotUsername }` |

## Catalog

| Method | Path | Response |
|--------|------|----------|
| GET | `/api/playlists/discover` | `{ seed?, rails[] }` |
| GET | `/api/likes` | `{ songs? \| tracks? }` |

## Search

| Method | Path | Response |
|--------|------|----------|
| GET | `/api/search/v1?q=&limit=&offset=` | `{ tracks, artists, albums }` |

## Social

| Method | Path | Response |
|--------|------|----------|
| GET | `/api/social/feed?limit=` | `{ posts[], page: { nextCursor, hasMore } }` |

## Playback

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/api/ebap-hls/v1/session` | `{ trackId }` | `{ masterUrl, expiresAtMs }` |

## Headers (authenticated)

- Session: cookies `mp_sid`, `mp_csrf`
- Mutations: `X-CSRF-Token`
- PoP hot path: `X-Auth-Device-Id`, `X-Auth-Proof-Access-Token`
- Sensitive: full `X-Auth-Device-Proof*` ECDSA

## Forbidden client patterns

- Any host other than `AppConfiguration.allowedGatewayHosts`
- Paths containing `minio`, `redis`, `internal/`, service names

## Reference implementations

- Web: `frontend/src/api/client.js`, `authDeviceCrypto.js`
- Gateway: `backend/go-api-gateway/internal/auth/`
