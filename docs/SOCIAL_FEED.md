# Social Feed

## Назначение

`/social` — authenticated listener feed внутри Earflow. Раздел показывает backend-authored посты пользователей в компактных карточках: автор, подпись поста, текстовый bubble и реакции.

Цель v1 — рабочая текстовая лента без второго source of truth на frontend.

## Жёсткая архитектура

- Backend owns state: посты, лайки, порядок ленты, cursor, права удаления, авторские поля и счётчики.
- Frontend renderer-only: загружает DTO, показывает карточки, отправляет intent `create`, `like`, `unlike`, `delete`.
- Viewer identity берётся только из gateway-injected `X-User-Id`.
- `userId`, `authorId`, `viewerId` из body/query запрещены для authz.
- `/api/social/*` доступен только через Go gateway с `require_user: true` и `require_service_token: true`.
- Direct browser access to `database-service` не является поддерживаемым путём.

См. инварианты:

- `INV-SOCIAL-001` — backend owns feed DTO, frontend is renderer-only.
- `INV-SOCIAL-002` — social viewer identity only from gateway session.

## Backend

Owner: `backend/database-service`.

Ключевые файлы:

- `backend/database-service/routes/social.js` — HTTP route handlers.
- `backend/database-service/lib/socialPosts.js` — validation, cursor, DTO mapping.
- `backend/database-service/database/migrations/004_social_feed.sql` — schema migration.
- `backend/database-service/database/init.sql` — fresh database bootstrap.
- `backend/00-create-tables.sql` — shared bootstrap schema.

Tables:

- `social_posts`
  - `id BIGSERIAL`
  - `user_id`
  - `title`
  - `body`
  - `kind = text`
  - `visibility = public`
  - `status = active | deleted`
  - `created_at`, `updated_at`, `deleted_at`
- `social_post_likes`
  - one row per `(post_id, user_id)`

Social author DTO reads:

- `users.username`
- `users.first_name`
- `users.last_name`
- `users.photo_url`
- `users.avatar_url`
- `user_settings.display_name`

Keep `users.photo_url` and `user_settings` in bootstrap/migrations. Removing them breaks feed author mapping.

## Gateway

Owner: `backend/go-api-gateway`.

Route:

```yaml
- id: social
  match:
    type: prefix
    value: /api/social
  upstream: database
  policies:
    class: unsafe
    require_user: true
    require_service_token: true
    rate_limit: social
    timeout: 10s
```

Rate limit profile: `backend/go-api-gateway/internal/ratelimit/profiles.go`.

Protected-route audit includes `/api/social/feed` in `internal/auth/route_pop_audit_test.go`.

## API Contract

All routes require authenticated user session through gateway.

### GET `/api/social/feed`

Query:

- `limit` optional, backend caps it.
- `cursor` optional opaque backend cursor.

Response:

```json
{
  "posts": [
    {
      "id": "101",
      "title": "Token for the new oil token",
      "body": "Text body",
      "kind": "text",
      "createdAt": "2026-06-12T10:00:00.000Z",
      "createdAtLabel": "5 минут назад",
      "updatedAt": "2026-06-12T10:00:00.000Z",
      "author": {
        "id": "7",
        "displayName": "$Maduro",
        "handle": "@maduro",
        "avatarUrl": null,
        "initials": "MA"
      },
      "metrics": {
        "likes": 12
      },
      "viewer": {
        "liked": true,
        "canDelete": false
      }
    }
  ],
  "page": {
    "nextCursor": null,
    "hasMore": false
  }
}
```

### POST `/api/social/posts`

Body:

```json
{
  "title": "Token for the new oil token",
  "body": "Post body"
}
```

Backend trims/normalizes input and enforces:

- `body` required
- `title <= 120`
- `body <= 2000`

Response:

```json
{ "post": { "...": "backend render-ready DTO" } }
```

### POST `/api/social/posts/:id/like`

Idempotent like. Returns updated backend DTO:

```json
{ "post": { "...": "backend render-ready DTO" } }
```

### DELETE `/api/social/posts/:id/like`

Unlike. Returns updated backend DTO.

### DELETE `/api/social/posts/:id`

Soft-deletes only own active post.

Response:

```json
{ "deleted": true, "id": "101" }
```

## Frontend

Owner: `frontend/src/components/SocialPage.js`.

Key files:

- `frontend/src/components/SocialPage.js`
- `frontend/src/components/SocialPage.styles.js`
- `frontend/src/components/SocialPage.test.js`
- `frontend/src/api/client.js`
- `frontend/src/App.js`

UX rules:

- Feed is content-first.
- Composer is closed by default and opens with `Написать`.
- Cards follow compact feed layout:
  - avatar + display name
  - title as subtitle under the author
  - body inside a dark rounded bubble
  - small like chip under the bubble
- Marketing footer is hidden on `/social`; bottom mobile nav stays.
- Do not add mock posts or seed fallback after backend API exists.
- Do not compute likes, permissions, author display, cursor or ordering on client.

API client methods:

- `getSocialFeed({ limit, cursor, signal })`
- `createSocialPost({ title, body })`
- `likeSocialPost(postId)`
- `unlikeSocialPost(postId)`
- `deleteSocialPost(postId)`

## Verification

Backend:

```bash
npm --prefix backend/database-service run test:social
```

Gateway:

```bash
cd backend/go-api-gateway
go test ./...
```

Frontend:

```bash
CI=true npm --prefix frontend test -- --watchAll=false --runInBand --runTestsByPath src/components/SocialPage.test.js
npm --prefix frontend run build
```

AI discipline:

```bash
npm run validate:ai
```

Manual smoke:

1. Open `/social` as authenticated listener.
2. Confirm feed cards render from `/api/social/feed`.
3. Click `Написать`, publish a post, confirm feed reloads from backend.
4. Like/unlike a post, confirm UI uses returned backend DTO.
5. Delete own post, confirm it disappears after backend reload.

## Deploy Notes

For VPS using `main` as prod:

```bash
cd /path/to/music-platform
git pull origin main
docker compose build --no-cache frontend go-api-gateway database-service
docker compose up -d frontend go-api-gateway database-service
docker compose ps
```

Apply migration if the deployment process does not run SQL migrations automatically:

```bash
docker compose exec -T postgres psql "$DATABASE_URL" -f /app/backend/database-service/database/migrations/004_social_feed.sql
```

If migration files are not mounted inside the Postgres container, run from the app host with the production database URL:

```bash
psql "$DATABASE_URL" -f backend/database-service/database/migrations/004_social_feed.sql
```

After deploy, smoke:

```bash
curl -I https://earflow.ru/social
curl -I https://api.earflow.ru/api/social/feed
docker compose logs --tail=100 go-api-gateway database-service frontend
```

`/api/social/feed` should require an authenticated session in browser flow; unauthenticated curl may return `401`, which is expected.
