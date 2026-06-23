# database-service — service context card

**Stack:** Node.js 22 + Express + pg
**Status:** production
**Owners:** Earflow backend

## Назначение

`database-service` владеет Postgres-backed API для listener catalog/user/social data behind `go-api-gateway`. Внешний браузер не ходит сюда напрямую: gateway добавляет `X-Service-Token` и, для user-scoped routes, authoritative `X-User-Id`.

## Public API

| Method | Path | Auth | Назначение |
|---|---|---|---|
| GET | `/health` | none | liveness + DB status |
| POST | `/auth/service-token` | service key | issue RS256 service token |
| GET | `/api/songs*` | service token | catalog song/search/radio/waveform reads |
| GET/PUT | `/api/users/:id/settings` | api-gateway service token | listener profile/settings |
| GET | `/api/users/:id/stats` | api-gateway service token | listener stats |
| GET/POST/DELETE | `/api/playlists*` | api-gateway service token + `X-User-Id` | playlist CRUD |
| GET | `/api/social/feed` | api-gateway service token + `X-User-Id` | backend-authored social feed DTO |
| POST | `/api/social/posts` | api-gateway service token + `X-User-Id` | create text post |
| POST/DELETE | `/api/social/posts/:id/like` | api-gateway service token + `X-User-Id` | like/unlike post |
| DELETE | `/api/social/posts/:id` | api-gateway service token + `X-User-Id` | soft-delete own post |

## Owns

Postgres:
  `users`, `user_settings`, `songs`, `playlists`, `playlist_tracks`, `likes`, `dislikes`, `listens`, `user_eq_settings`, catalog/recommendation support tables.
  `social_posts` — text posts for listener social feed, including denormalized `likes_count`.
  `social_post_likes` — one like per user/post.
  `service_sessions` — issued service-token session records.

## Reads

Postgres:
  `users` / `user_settings` for social author display fields.

## Publishes

Process-local short TTL cache for public social feed pages. Social feed remains pull-based HTTP; no Redis/NATS/WS frames.

## Dependencies

Required:
  - PostgreSQL
  - RS256 service JWT keypair env (`SERVICE_JWT_*`)
  - service keys for allowed service token issuance

Optional:
  - none for social v1

## Caveats / Gotchas

- User identity for `/api/social/*` comes only from gateway-injected `X-User-Id`; body/query user ids are ignored (`pickCreatePostFields`).
- Post lifecycle: `active → deleted` only via owner delete; `POST_STATUS` + SQL guards in `routes/social.js`.
- Social DTO is render-ready but privacy-minimized: `liked`, `canManage`, counts, author display and cursor are computed server-side; `author.id`, `author.handle`, exact `updatedAt` are not exposed.
- Like/unlike returns a `reaction` delta, not the full post DTO. Do not reintroduce full feed reload after reactions.
- `social_posts.likes_count` is the hot counter; migration `005_social_feed_likes_count.sql` backfills it from `social_post_likes`.
- Schema bootstrap/migrations must keep `users.photo_url` and `user_settings.display_name`; social author DTO reads them directly.
- `/api/social/*` must be exposed through gateway with `require_user: true` and `require_service_token: true`; direct browser access is not a supported path.
- `social_posts.status = deleted` is soft delete; feed queries must filter `status='active'`.

## Recent significant changes

- 2026-06-23 — Social backend-SOT formalized: state machine, spoofed body strip, gateway route test, validate:ai scans. См. `docs/DECISIONS.md`.
- 2026-06-16 — Social feed privacy/perf pass: minimal author DTO, `likes_count`, reaction delta, process-local feed cache. См. `docs/DECISIONS.md`.
- 2026-06-12 — Social feed v1 backend-owned posts/likes/API. См. `docs/DECISIONS.md`.

## Tests

```
npm --prefix backend/database-service run test:social
```

## Где смотреть глубже

- Entrypoint: `backend/database-service/server.js`
- Social route: `backend/database-service/routes/social.js`
- Social DTO/validation: `backend/database-service/lib/socialPosts.js`
- Schema: `backend/database-service/database/migrations/004_social_feed.sql`, `backend/database-service/database/migrations/005_social_feed_likes_count.sql`
