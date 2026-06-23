# Backend / Frontend Contract — Earflow iOS

Pattern: **backend owns rules** · **iOS renders DTO** · **intents via gateway**

---

## Screen: Login / Register (`LoginView`)

### User actions

- Email login, register, Telegram widget auth

### Frontend states

`idle` · `loading` · `error` (inline message)

### API

| UI event | Endpoint | Auth | Errors |
|----------|----------|------|--------|
| Login | `POST /api/auth/email/login` | skipAuth | 401 invalid, 429 rate limit |
| Register | `POST /api/auth/email/register` | skipAuth | 400 validation |
| Telegram | `POST /api/auth/telegram/login` | skipAuth | invalid hash |
| After auth | `POST /api/auth/device/register` | cookies+proof skip paths | device errors |
| Public config | `GET /api/public-config` | skipAuth | telegram bot username |

### Backend

Validation, session cookies, Telegram HMAC, user creation

### Frontend

Form validation mirrors backend regex (`AuthValidators`); maps `GatewayError` to Russian UX strings

---

## Screen: Home (`HomeView`)

### Frontend states

`loading` · `success` (rails+likes) · `error` (banner) · pull-to-refresh

### API

| UI event | Endpoint | Notes |
|----------|----------|-------|
| Load | `GET /api/playlists/discover` | optional seed query |
| Likes | `GET /api/likes` | songs/tracks array |

### Frontend

Horizontal rails; play tap → `PlaybackCoordinator.play(track)` — no local queue logic

---

## Screen: Search (`SearchView`)

### API

| UI event | Endpoint |
|----------|----------|
| Query (debounced) | `GET /api/search/v1?q=&limit=20` |

### Frontend

Debounce in `SearchService` actor; empty query → empty result without call

---

## Screen: Social (`SocialView`)

### API

| UI event | Endpoint |
|----------|----------|
| Feed | `GET /api/social/feed?limit=N` |

### Backend

Post text, metrics.likes, viewer.liked, viewer.canManage

### Frontend (current)

Read-only list — **no** optimistic like (Phase 3)

---

## Screen: Player (`MiniPlayerBar` / `PlayerSheetView`)

### API

| UI event | Endpoint |
|----------|----------|
| Play | `POST /api/ebap-hls/v1/session` `{ trackId }` |

### Frontend

Shows `PlaybackState`; pause/resume/stop → `PlaybackActor` only

---

## Screen: Profile / Settings

### API

| UI event | Endpoint |
|----------|----------|
| Profile | via `AuthActor.currentProfile()` after login |
| Logout | `POST /api/auth/logout` |

### Debug

`EarflowLog` — local only, export via share sheet; no server upload yet

---

## Planned (not in contract yet)

Device Sync WS, analytics events, social POST like, playlist detail — see `TASKS.md`
