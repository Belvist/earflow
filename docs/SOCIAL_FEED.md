# Social Feed

## Назначение

`/social` — authenticated listener feed внутри Earflow. Раздел показывает backend-authored посты пользователей в компактных карточках: автор, подпись поста, текстовый bubble и реакции.

Цель v1 — рабочая текстовая лента без второго source of truth на frontend.

## Жёсткая архитектура

**Глобальное правило:** `INV-ARCH-002`, `docs/BACKEND_FRONTEND_BOUNDARY.md`. Social — reference implementation (`INV-SOCIAL-001..004`).

**Формула (обязательна):** Frontend = интерфейс + UX + запросы + отображение ответа. Backend = бизнес-логика + безопасность + состояние + данные. Database = хранение, не замена бизнес-логики.

Если отключить frontend и вызвать API напрямую с валидной сессией, backend всё равно должен проверить права, статусы и лимиты и не выполнить запрещённое действие.

| Слой | Владеет |
|------|---------|
| **Backend** | посты, лайки, порядок ленты, cursor, `likes_count`, soft-delete, rate limits, DTO mapping, `viewer.liked` / `viewer.canManage`, author display |
| **Gateway** | session, CSRF (`class: unsafe`), `X-User-Id`, `X-Service-Token`, rate limit profile `social` |
| **Frontend** | форма, карточки, кнопки, UX-валидация (не пустой body), отправка intent, применение backend ack (`post`, `reaction`, `deleted`) |

- Backend owns state: посты, лайки, порядок ленты, cursor, права удаления, авторские поля и счётчики.
- Frontend renderer-only: загружает DTO, показывает карточки, отправляет intent `create`, `like`, `unlike`, `delete`.
- Viewer identity берётся только из gateway-injected `X-User-Id`.
- `userId`, `authorId`, `viewerId`, `status` из body/query **игнорируются** при create (см. `pickCreatePostFields`).
- `/api/social/*` доступен только через Go gateway с `require_user: true` и `require_service_token: true`.
- Direct browser access to `database-service` не является поддерживаемым путём.
- **Нет optimistic UI** на like/delete — UI обновляется только после backend ack.
- **Нет** mock/seed feed на frontend после появления API.

См. инварианты:

- `INV-SOCIAL-001` — backend owns feed DTO, frontend is renderer-only.
- `INV-SOCIAL-002` — social viewer identity only from gateway session.
- `INV-SOCIAL-003` — privacy-minimized public DTO.
- `INV-SOCIAL-004` — post lifecycle state machine on backend only.

## State machine — `social_posts.status`

| State | Meaning | Visible in feed |
|-------|---------|-----------------|
| `active` | опубликован | yes |
| `deleted` | soft-deleted owner | no |

| From | Event | To | Guard | Side effects |
|------|-------|-----|-------|--------------|
| — | `POST /api/social/posts` | `active` | valid body + auth | insert row, `likes_count=0`, invalidate feed cache |
| `active` | `DELETE /api/social/posts/:id` | `deleted` | `user_id = viewer` | set `deleted_at`, invalidate feed cache |
| `active` | `POST …/like` | `active` | post active | upsert like, increment counter |
| `active` | `DELETE …/like` | `active` | post active | remove like, decrement counter |

Код: `POST_STATUS`, `canTransitionPostStatus` in `lib/socialPosts.js`. Переходы применяются в SQL/handlers, не на frontend.

## Backend

Owner: `backend/database-service`.

Ключевые файлы:

- `backend/database-service/routes/social.js` — HTTP route handlers.
- `backend/database-service/lib/socialPosts.js` — validation, cursor, DTO mapping.
- `backend/database-service/database/migrations/004_social_feed.sql` — initial schema migration.
- `backend/database-service/database/migrations/005_social_feed_likes_count.sql` — denormalized like counter + viewer overlay index.
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
  - `likes_count`
  - `created_at`, `updated_at`, `deleted_at`
- `social_post_likes`
  - one row per `(post_id, user_id)`

Social author DTO reads:

- `users.username` as internal display fallback only; it is not exposed as `author.handle`.
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

Protected-route audit: все `require_user` API routes (включая `/api/social/feed`) проходят PoP audit в `TestGatewayYAMLProtectedAPIRoutesRequireDeviceProof`. Dedicated test: `TestGatewayYAMLSocialRouteIsProtected`.

## API Contract

All routes require authenticated user session through gateway.

### GET `/api/social/feed`

Query:

- `limit` optional, backend caps it.
- `cursor` optional opaque backend cursor.
- `after` optional post id for lightweight newer-post checks.

Backend returns `Cache-Control: private` and may use short process-local public-page cache before applying viewer overlay.

Response:

```json
{
  "posts": [
    {
      "id": "101",
      "title": "Token for the new oil token",
      "body": "Text body",
      "kind": "text",
      "createdAtLabel": "5 минут назад",
      "author": {
        "displayName": "$Maduro",
        "avatarUrl": null,
        "initials": "MA"
      },
      "metrics": {
        "likes": 12
      },
      "viewer": {
        "liked": true,
        "canManage": false
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

Idempotent like. Returns reaction delta only:

```json
{ "reaction": { "postId": "101", "liked": true, "likes": 13 } }
```

### DELETE `/api/social/posts/:id/like`

Unlike. Returns reaction delta only:

```json
{ "reaction": { "postId": "101", "liked": false, "likes": 12 } }
```

### DELETE `/api/social/posts/:id`

Soft-deletes only own active post.

Response:

```json
{ "deleted": true, "id": "101" }
```

### Error codes (representative)

| HTTP | code | When |
|------|------|------|
| 401 | `AUTH_REQUIRED` | no `X-User-Id` |
| 403 | `SERVICE_FORBIDDEN` | not api-gateway service token |
| 400 | `SOCIAL_POST_BODY_REQUIRED` | empty body on create |
| 400 | `SOCIAL_POST_ID_INVALID` | bad post id |
| 400 | `SOCIAL_AFTER_INVALID` | bad `after` cursor |
| 404 | `SOCIAL_POST_NOT_FOUND` | missing or not active / not owner on delete |
| 429 | `SOCIAL_RATE_LIMITED` | rate limit exceeded |
| 500 | `SOCIAL_*_ERROR` | internal failure (no stack trace to client) |

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
- Do not refetch the whole feed after successful create/like/delete; apply backend `post`, `reaction` or `deleted` ack.

API client methods:

- `getSocialFeed({ limit, cursor, after, signal, cache })`
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
3. Click `Написать`, publish a post, confirm UI prepends backend returned post without a second feed GET.
4. Like/unlike a post, confirm UI applies returned reaction delta.
5. Delete own post from the `...` menu, confirm it disappears after backend ack.

## Deploy Notes

For VPS using `main` as prod:

```bash
cd /path/to/music-platform
git pull origin main
docker compose build --no-cache frontend api-gateway database-service
docker compose up -d frontend api-gateway database-service
docker compose ps
```

Apply migration if the deployment process does not run SQL migrations automatically:

```bash
docker compose exec -T postgres psql "$DATABASE_URL" -f /app/backend/database-service/database/migrations/004_social_feed.sql
docker compose exec -T postgres psql "$DATABASE_URL" -f /app/backend/database-service/database/migrations/005_social_feed_likes_count.sql
```

If migration files are not mounted inside the Postgres container, run from the app host with the production database URL:

```bash
psql "$DATABASE_URL" -f backend/database-service/database/migrations/004_social_feed.sql
psql "$DATABASE_URL" -f backend/database-service/database/migrations/005_social_feed_likes_count.sql
```

After deploy, smoke:

```bash
curl -I https://earflow.ru/social
curl -I https://api.earflow.ru/api/social/feed
docker compose logs --tail=100 api-gateway database-service frontend
```

`/api/social/feed` should require an authenticated session in browser flow; unauthenticated curl may return `401`, which is expected.
