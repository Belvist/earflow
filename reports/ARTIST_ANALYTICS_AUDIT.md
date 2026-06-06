# Artist Analytics Audit

**Initial audit:** 2025-01-20
**Last updated:** 2026-05-08 (Sprint 2 + hardening pass)

---

## Executive Summary

Artist analytics is **functional with core metrics implemented** across two sprints and a hardening pass. The module serves analytics for artists on `artists.earflow.ru`.

**Sprint 1:** Added dashboard metrics (all-time plays, unique listeners, likes, dislikes, playlist adds) to `getArtistMeta()`, added listen event rate limiting.

**Sprint 2:** Added dedicated analytics page with daily stream trend (gap-free), top tracks with per-track metrics, listener engagement (avg duration, completion/skip rate), and interaction type breakdown.

**Hardening pass:** Moved analytics from public `/api/` to `/internal/` prefix, added `INTERNAL_SERVICE_TOKEN` with timing-safe comparison, nginx edge deny, gateway header stripping.

---

## 1. Architecture

### 1.1 Data Flow

```
Browser (artists.earflow.ru)
  → nginx (artists.earflow.ru vhost)
    → artist-api-gateway (require_user: true)
      → artist-portal-service /api/artist-portal/analytics
        → artist-service /internal/artists/:artist/analytics [service token auth]
          → PostgreSQL (user_interactions, listens, likes, dislikes, playlist_tracks, songs)

Browser (artists.earflow.ru)
  → nginx (artists.earflow.ru vhost)
    → artist-api-gateway (require_user: true)
      → artist-portal-service /api/artist-portal/dashboard
        → artist-service /api/artists/:artist/meta
        → artist-service /internal/artists/:artist/dashboard-metrics [service token auth]
          → PostgreSQL
```

### 1.2 Endpoint Classification

| Endpoint | Service | Access | Auth | Purpose |
|----------|---------|--------|------|---------|
| `GET /api/artists/:artist/meta` | artist-service | **Public** | No | Vitrine: basic artist card data |
| `GET /api/artist-portal/dashboard` | artist-portal-service | **Protected** | Bearer + isArtist + MFA | Dashboard aggregate (public meta + private metrics) |
| `GET /api/artist-portal/analytics` | artist-portal-service | **Protected** | Bearer + isArtist + MFA | Full analytics proxy |
| `GET /internal/artists/:artist/analytics` | artist-service | **Internal** | X-Internal-Token (INTERNAL_SERVICE_TOKEN) | Raw analytics data |
| `GET /internal/artists/:artist/dashboard-metrics` | artist-service | **Internal** | X-Internal-Token (INTERNAL_SERVICE_TOKEN) | Dashboard KPI metrics |

### 1.3 Field Classification (Public vs Private)

**Public `/api/artists/:artist/meta` returns:**

| Field | Type | Source |
|-------|------|--------|
| artist | string | artist card |
| artistId | number | artist card |
| artistPublicId | string | artist card |
| isVerified | boolean | artist card |
| hasOwner | boolean | artist card |
| bio | string | artist card |
| trackCount | number | `COUNT(*)` from songs |
| albumCount | number | `COUNT(DISTINCT album)` from songs |
| totalPlays | number/null | `sumArtistAllTimeListens()` from user_interactions/listens |
| heroCoverPath | string/null | most popular track cover |
| avatarCoverPath | string/null | artist card |
| bannerCoverPath | string/null | artist card |
| topTrack | object/null | top track by popularity/play_count |

**Private `/internal/artists/:artist/analytics` returns (via `/api/artist-portal/analytics` proxy):**

| Field | Source |
|-------|--------|
| topTracks[] | LATERAL JOIN per-track: plays, uniqueListeners, likes, dislikes |
| dailyTrend[] | generate_series gap-free daily stream counts |
| engagement | avgDurationMs, avgProgress, completionRate, skipRate |
| sourceBreakdown | interaction type distribution (play, complete, skip, like, dislike) |

**Computed by `getArtistMeta()` but NOT in public response:**

| Field | Status | Reason |
|-------|--------|--------|
| monthlyPlays | Filtered out | Private — available only through protected artist-portal endpoints, not through public meta |
| totalPlaysAllTime | Filtered out | Dashboard alias for total all-time plays; public meta exposes the same class of value as `totalPlays`, but not under the dashboard KPI field name |
| uniqueListenersMonthly | Filtered out | Private — available only through protected artist-portal endpoints, not through public meta |
| uniqueListenersAllTime | Filtered out | Private — available only through protected artist-portal endpoints, not through public meta |
| likesCount | Filtered out | Private — available only through protected artist-portal endpoints, not through public meta |
| dislikesCount | Filtered out | Private — available only through protected artist-portal endpoints, not through public meta |
| playlistAdds | Filtered out | Private — available only through protected artist-portal endpoints, not through public meta |

**Verification:** `server.js:899-912` constructs response with explicit field list, no spread operator.

---

## 2. Dashboard Data Flow Fix

**Status:** ✅ FIXED (Dashboard Metrics Data Flow Fix Sprint)

**Problem:** After hardening pass, public `/api/artists/:artist/meta` correctly filters private fields (monthlyPlays, totalPlaysAllTime, uniqueListenersMonthly, uniqueListenersAllTime, likesCount, dislikesCount, playlistAdds). But `DashboardStats.js` reads these fields from `/api/artist-portal/dashboard`, which previously fetched meta through the public endpoint. Result: dashboard tiles showed 0.

**Solution:** Added internal endpoint `/internal/artists/:artist/dashboard-metrics` in artist-service with X-Internal-Token protection. Updated `/api/artist-portal/dashboard` to:
1. Keep bearer + isArtist + MFA checks
2. Fetch public meta from `/api/artists/:artist/meta` (safe vitrine fields)
3. Fetch private dashboard metrics from `/internal/artists/:artist/dashboard-metrics` (X-Internal-Token)
4. Merge safe public meta + private dashboard metrics
5. Return merged meta to frontend

**Architecture:**
```
Browser
  → GET /api/artist-portal/dashboard
    → artist-portal-service (bearer + isArtist + MFA)
      → artist-service /api/artists/:artist/meta (public)
      → artist-service /internal/artists/:artist/dashboard-metrics (X-Internal-Token)
```

**Files Changed:**
- `backend/artist-service/server.js` - Added `/internal/artists/:artist/dashboard-metrics` endpoint
- `backend/artist-portal-service/server.js` - Updated `/api/artist-portal/dashboard` to fetch and merge internal metrics

---

## 3. Frontend Implementation

### 3.1 Dashboard Page

**File:** `artist-frontend/src/ui/pages/DashboardPage.js`

**Components:**
- `DashboardHero` — artist name, verification badge, public profile link, avatar/hero cover
- `DashboardStats` — 4 KPI tiles (monthlyPlays, totalPlaysAllTime, uniqueListenersMonthly, likesCount)
- Analytics CTA button → navigates to `/analytics`

**Data source:** `GET /api/artist-portal/dashboard` → `{ me, meta, mfa }`

**Status:** ✅ FIXED — DashboardStats now receives merged public meta + private dashboard metrics from `/api/artist-portal/dashboard`.

Dashboard KPI fields:
- monthlyPlays
- totalPlaysAllTime
- uniqueListenersMonthly
- likesCount

These fields are not exposed through public `/api/artists/:artist/meta`.

### 3.2 Analytics Page

**File:** `artist-frontend/src/ui/pages/AnalyticsPage.js`

**Data source:** `GET /api/artist-portal/analytics?days={7|14|30|60|90}&topTracks=20`

**Components:**

| Component | File | Purpose |
|-----------|------|---------|
| AnalyticsSummaryStrip | `analytics/AnalyticsSummaryStrip.js` | 8 KPI cards in responsive grid |
| StreamChart | `analytics/StreamChart.js` | Pure SVG area chart (zero library overhead) |
| TopTracksTable | `analytics/TopTracksTable.js` | Per-track metrics table with cover art |
| EngagementPanel | `analytics/EngagementPanel.js` | 4-metric engagement grid |
| InteractionBreakdown | `analytics/InteractionBreakdown.js` | Horizontal stacked bar + legend |

**Route protection:**
- `<ProtectedRoute allowWithoutMfa={false}>` — requires auth + MFA
- Period selector whitelisted: `PERIOD_OPTIONS.some((o) => o.value === val)` → [7, 14, 30, 60, 90]
- Error handling: 401 → login, 403/MFA_REQUIRED → /security/2fa, 403/ARTIST_ACCESS_REQUIRED → /onboarding, 502/network → retry message

### 3.3 Transport & Usecase

| File | Purpose |
|------|---------|
| `transport/analyticsApi.js` | HTTP client for `/api/artist-portal/analytics` |
| `usecases/analyticsUsecase.js` | Wraps transport, returns `{ ok, data, status }` |

---

## 4. Backend: artist-service

### 4.1 getArtistMeta() — Sprint 1 Metrics

**File:** `backend/artist-service/lib/db/artists.js`

**Computes (all parameterized SQL via `$1`, `$2`):**

| Metric | Function | Data Source |
|--------|----------|-------------|
| trackCount | inline COUNT(*) | songs |
| albumCount | inline COUNT(DISTINCT album) | songs |
| monthlyPlays | `sumArtistMonthlyListens()` | user_interactions (primary), listens (fallback) |
| totalPlaysAllTime | `sumArtistAllTimeListens()` | user_interactions (primary), listens (fallback) |
| uniqueListenersMonthly | `countArtistUniqueListenersMonthly()` | COUNT(DISTINCT user_id) from user_interactions/listens |
| uniqueListenersAllTime | `countArtistUniqueListenersAllTime()` | COUNT(DISTINCT user_id) from user_interactions/listens |
| likesCount | `countArtistLikes()` | likes JOIN songs |
| dislikesCount | `countArtistDislikes()` | dislikes JOIN songs |
| playlistAdds | `countArtistPlaylistAdds()` | playlist_tracks JOIN songs |

**Helper functions in:** `backend/artist-service/lib/db/artistPlatformMonthlyPlays.js`

### 4.2 artistAnalytics.js — Sprint 2 Analytics

**File:** `backend/artist-service/lib/db/artistAnalytics.js`

**Functions:**

| Function | SQL Pattern | Notes |
|----------|-------------|-------|
| `getTopTracks(artistName, { limit })` | LATERAL JOIN per-track | plays, uniqueListeners, likes, dislikes per track |
| `getDailyStreamTrend(artistName, { days })` | generate_series + LEFT JOIN | Gap-free daily counts |
| `getListenerEngagement(artistName)` | AVG + FILTER | avgDurationMs, avgProgress, completionRate, skipRate |
| `getSourceBreakdown(artistName)` | GROUP BY interaction_type | play, complete, skip, like, dislike counts |
| `getFullAnalytics(artistName, options)` | Promise.all([...]) | Parallel aggregation |

**SQL security:**
- ✅ All queries parameterized ($1, $2, $3)
- ✅ `NULLIF` for division by zero in completion/skip rates
- ✅ `FILTER (WHERE ... > 0)` on AVG to exclude nulls/zeroes
- ✅ `COALESCE` wraps all aggregates for null safety
- ✅ `ARTIST_SPLIT_REGEX` is a compile-time constant, not user input

### 4.3 Internal Endpoint

**Route:** `GET /internal/artists/:artist/analytics`

**Middleware:** shared `requireInternalServiceToken`
1. Reads `INTERNAL_SERVICE_TOKEN` from env
2. Requires token ≥32 chars (→ 503 if misconfigured)
3. Validates `X-Internal-Token` header with `crypto.timingSafeEqual`
4. Missing → 401 `SERVICE_TOKEN_REQUIRED`
5. Wrong → 403 `SERVICE_TOKEN_INVALID`

**Parameters:**
- `days` (1–90, default 30) — server-side clamped
- `topTracks` (1–50, default 20) — server-side clamped

### 4.4 Internal Dashboard Metrics Endpoint

**Route:** `GET /internal/artists/:artist/dashboard-metrics`

**Purpose:** Lightweight KPI endpoint for artist dashboard tiles.

**Auth:** Same `INTERNAL_SERVICE_TOKEN` middleware as `/internal/artists/:artist/analytics`.

**Response:**
```json
{
  "monthlyPlays": 0,
  "totalPlaysAllTime": 0,
  "uniqueListenersMonthly": 0,
  "uniqueListenersAllTime": 0,
  "likesCount": 0,
  "dislikesCount": 0,
  "playlistAdds": 0
}
```

This endpoint is not exposed through nginx or go-api-gateway and is used only by artist-portal-service.

---

## 5. Backend: artist-portal-service

### 5.1 Dashboard Endpoint

**Route:** `GET /api/artist-portal/dashboard`

**Auth chain:**
1. Bearer token → `fetchArtistMe()` → verify isArtist + get artistName
2. MFA check → `fetchMfaStatus()` → require `enabled === true`
3. Fetch public meta → `fetchArtistMeta()` → public `/api/artists/:artist/meta`
4. Fetch private KPI metrics → `/internal/artists/:artist/dashboard-metrics`
5. Merge safe public meta + private dashboard metrics

**IDOR protection:** Uses `me.data.artistName` from auth response, not user input.

**Status:** ✅ FIXED

The dashboard endpoint now returns merged metadata:
- public artist meta from `/api/artists/:artist/meta`
- private dashboard KPI metrics from `/internal/artists/:artist/dashboard-metrics`

Private metrics are fetched only server-to-server with `X-Internal-Token`.

### 5.2 Analytics Proxy

**Route:** `GET /api/artist-portal/analytics`

**Auth chain:** Same as dashboard (bearer + isArtist + MFA).

**Proxy call:**
```
GET ${ARTIST_SERVICE_URL}/internal/artists/${safeArtist}/analytics?days=${days}&topTracks=${topTracks}
Headers: { X-Internal-Token: process.env.INTERNAL_SERVICE_TOKEN }
```

**IDOR protection:** Uses `me.data.artistName` from auth, not query/path params.

---

## 6. Security

### 6.1 Access Control Summary

| Layer | Control | Status |
|-------|---------|--------|
| nginx | `location ^~ /internal/ { return 404; }` | ✅ Defense-in-depth |
| go-api-gateway | No route matches `/internal/` prefix | ✅ By design |
| go-api-gateway | `InternalHeaderSanitizer` strips `X-Internal-Token` | ✅ Prevents browser spoofing |
| gateway.artist.yaml | `/api/artist-portal` → class: unsafe, require_user: true | ✅ Auth required |
| artist-portal-service | Bearer + isArtist + MFA check | ✅ Triple gate |
| artist-portal-service | IDOR: uses `me.data.artistName`, not user input | ✅ Ownership enforced |
| artist-service | `INTERNAL_SERVICE_TOKEN` timing-safe compare | ✅ S2S auth |
| artist-service | Token length check ≥32 | ✅ Fail-closed |

### 6.2 Rate Limiting

**Listen events:** `POST /api/listens` — 10 requests per 30 seconds per user:track combination (added Sprint 1).

**Analytics endpoint:** No separate rate limiting (protected by MFA gate + portal-only access).

### 6.3 Remaining Risks

| Risk | Severity | Status |
|------|----------|--------|
| M-11: multer memoryStorage 200 MB OOM | **HIGH** | ❌ Not fixed (separate sprint) |
| No minimum play duration threshold | Medium | ❌ Deferred |
| Guest listeners not counted (user_id IS NOT NULL) | Low | ❌ Documented limitation |
| Artist name regex matching false positives | Low | ❌ Deferred |

---

## 7. Database Schema

### 7.1 Analytics-Relevant Tables

**user_interactions** (primary source):
- Columns: id, user_id, song_id, interaction_type, session_id, duration_ms, progress, metadata, created_at, event_time
- Indexes: user_id, created_at, interaction_type, (user_id, interaction_type), (song_id, created_at), (user_id, created_at, interaction_type)

**listens** (fallback source):
- Columns: id, user_id, song_id, listened_at
- Indexes: (user_id, listened_at DESC), (song_id), (song_id, listened_at DESC)

**likes** / **dislikes**: id, user_id, song_id, created_at

**playlist_tracks**: id, playlist_id, song_id, position, added_at, added_by

**user_history** (aggregate table, used by recommendations):
- Columns: user_id, song_id, play_count, liked, last_played, total_play_time, skip_count

**songs** (cached metrics):
- `play_count INTEGER DEFAULT 0` — not consistently updated, album stats use it
- `popularity INTEGER DEFAULT 0`

### 7.2 Data Source Inconsistency (Known)

Album stats (`getAlbumStats`) use `songs.play_count` (aggregate column), while artist analytics use `user_interactions`/`listens` (event tables). Different data sources → potentially inconsistent metrics between album view and artist analytics. Not fixed — requires standardizing on one source.

### 7.3 Recommended Indexes (Not Applied)

**File:** `backend/migrations/recommended_analytics_indexes.sql`

| Index | Table | Columns | Purpose |
|-------|-------|---------|---------| 
| idx_ui_song_type_time | user_interactions | (song_id, interaction_type, created_at DESC) | Top tracks, daily trend |
| idx_ui_type_song | user_interactions | (interaction_type, song_id) | Source breakdown, engagement |
| idx_dislikes_song | dislikes | (song_id) | Missing — dislikes per song |
| idx_songs_artist_available | songs | (artist, id) WHERE is_available=TRUE | Artist-filtered queries |

**Status:** Deferred — requires separate migration plan + load testing before production.

---

## 8. Formulas

### 8.1 Implemented Formulas

**Monthly plays:**
```sql
COUNT(*) FROM user_interactions ui
  JOIN songs s ON s.id = ui.song_id
  WHERE ui.interaction_type = 'play'
    AND (ui.event_time >= date_trunc('month', CURRENT_TIMESTAMP)
         OR ui.created_at >= date_trunc('month', CURRENT_TIMESTAMP))
    AND artist matches
    AND s.is_available = TRUE
```

**All-time plays:** Same without time filter.

**Unique listeners (monthly/all-time):**
```sql
COUNT(DISTINCT ui.user_id) ... WHERE ui.user_id IS NOT NULL
```

**Completion rate:**
```sql
COUNT(*) FILTER (WHERE interaction_type = 'complete')
  / NULLIF(COUNT(*) FILTER (WHERE interaction_type IN ('play','complete')), 0)
```

**Skip rate:**
```sql
COUNT(*) FILTER (WHERE interaction_type = 'skip')
  / NULLIF(COUNT(*) FILTER (WHERE interaction_type IN ('play','skip','complete')), 0)
```

**Daily trend (gap-free):**
```sql
SELECT d::date AS day, COALESCE(COUNT(ui.id), 0) AS streams
FROM generate_series(CURRENT_DATE - $2::int, CURRENT_DATE, '1 day') d
LEFT JOIN user_interactions ui ON ...
GROUP BY d ORDER BY d
```

---

## 9. Performance

### 9.1 Current State

| Issue | Impact | Status |
|-------|--------|--------|
| No Redis caching | Every analytics load queries DB | ❌ Not implemented |
| No recommended indexes | Slow queries as data grows | ❌ Migration prepared, not applied |
| LATERAL JOIN for top tracks | Acceptable for <50 tracks, may slow on >1000 | ⚠️ Monitor |
| `buildArtistMatchSql` regex split | Full table scan potential | ⚠️ Deferred |
| generate_series timezone | Uses CURRENT_DATE (server tz) | ⚠️ Minor |

### 9.2 Caching Recommendation

Cache `/internal/artists/:artist/analytics` response in Redis:
- Key: `analytics:${normalizedArtistName}:${days}:${topTracks}`
- TTL: 5–10 minutes
- Invalidation: on listen/like/playlist events (or TTL-only for simplicity)

---

## 10. Files Inventory

### Created (Sprint 2)

| File | Purpose |
|------|---------|
| `backend/artist-service/lib/db/artistAnalytics.js` | Analytics DB module |
| `artist-frontend/src/transport/analyticsApi.js` | HTTP transport |
| `artist-frontend/src/usecases/analyticsUsecase.js` | Business logic wrapper |
| `artist-frontend/src/ui/pages/AnalyticsPage.js` | Analytics page |
| `artist-frontend/src/ui/components/analytics/StreamChart.js` | SVG area chart |
| `artist-frontend/src/ui/components/analytics/TopTracksTable.js` | Top tracks table |
| `artist-frontend/src/ui/components/analytics/EngagementPanel.js` | Engagement metrics |
| `artist-frontend/src/ui/components/analytics/InteractionBreakdown.js` | Interaction breakdown |
| `artist-frontend/src/ui/components/analytics/AnalyticsSummaryStrip.js` | KPI strip |
| `artist-frontend/src/ui/components/analytics/index.js` | Barrel export |
| `backend/migrations/recommended_analytics_indexes.sql` | Index migration (not applied) |

### Modified (Sprint 1 + 2 + Hardening)

| File | Changes |
|------|---------|
| `backend/artist-service/lib/db/artists.js` | getArtistMeta returns 7 new metrics (Sprint 1) |
| `backend/artist-service/lib/db/artistPlatformMonthlyPlays.js` | 7 new query functions (Sprint 1) |
| `backend/artist-service/server.js` | `/internal/` endpoint + S2S auth middleware (Sprint 2 + hardening) |
| `backend/artist-portal-service/server.js` | Analytics proxy + X-Internal-Token header (Sprint 2 + hardening) |
| `backend/database-service/routes/listens.js` | Rate limiting on POST /api/listens (Sprint 1) |
| `backend/go-api-gateway/internal/httpx/middleware/headers.go` | Strips X-Internal-Token (hardening) |
| `artist-frontend/src/App.js` | /analytics route (Sprint 2) |
| `artist-frontend/src/ui/components/ArtistTopBar.js` | Аналитика nav item (Sprint 2) |
| `artist-frontend/src/ui/pages/DashboardPage.js` | Analytics CTA button (Sprint 2) |
| `artist-frontend/src/ui/components/dashboard/DashboardStats.js` | 4-tile layout (Sprint 1), lint fixes (hardening) |
| `docker-compose.yml` | INTERNAL_SERVICE_TOKEN env (hardening) |
| `.env.example` | INTERNAL_SERVICE_TOKEN documentation (hardening) |
| `nginx/nginx.conf` | /internal/ deny block (hardening) |

---

## 11. Remaining Gaps & Next Sprint Priorities

### 11.1 Remaining Gaps

| # | Gap | Severity | Notes |
|---|-----|----------|-------|
| 1 | No Redis caching for analytics | Medium | Section 9.2 |
| 2 | Recommended indexes not applied | Medium | Section 7.3 |
| 3 | No minimum play duration threshold | Medium | All play events counted |
| 4 | Guest listeners not counted | Low | user_id IS NOT NULL filter |
| 5 | Artist regex matching false positives | Low | Deferred |
| 6 | Data source inconsistency (album vs artist) | Low | Section 7.2 |
| 7 | M-11: multer memoryStorage 200 MB OOM risk | **HIGH** | Separate sprint |
| 8 | No automated tests | Medium | Neither backend nor frontend |

### 11.2 Next Sprint: Upload Hardening (M-11)

1. Remove 200 MB `multer.memoryStorage()`
2. Stream-to-disk or stream-to-MinIO
3. MIME + magic bytes validation
4. Concurrent upload limits
5. Temp file cleanup
6. Large file upload test
7. Update SECURITY_VERIFICATION.md and KNOWN_ISSUES_VERIFICATION.md

### 11.3 Follow-up Sprint: Analytics Performance

1. Apply recommended indexes + load test
2. Add Redis caching (TTL 5–10 min)
3. Implement minimum play duration threshold

---

## 12. Pre-Production Verification Checklist

```bash
# 1. Internal analytics endpoint blocked from outside
curl -i https://artists.earflow.ru/internal/artists/test/analytics
# Expected: 404 from nginx

# 2. Internal dashboard-metrics endpoint blocked from outside
curl -i https://artists.earflow.ru/internal/artists/test/dashboard-metrics
# Expected: 404 from nginx

# 3. Old public analytics route gone
curl -i https://artists.earflow.ru/api/artists/test/analytics
# Expected: 404 / route not found (NOT analytics JSON)

# 4. Public meta does NOT contain private fields
curl -i https://artists.earflow.ru/api/artists/test/meta
# Expected: 200, response should NOT contain monthlyPlays, totalPlaysAllTime, uniqueListenersMonthly, etc.

# 5. Portal analytics without auth
curl -i https://artists.earflow.ru/api/artist-portal/analytics
# Expected: 401

# 6. Portal analytics with auth but no MFA
# Expected: 403 MFA_REQUIRED

# 7. Internal analytics endpoint without token (inside Docker)
curl -i http://artist-service:3040/internal/artists/test/analytics
# Expected: 401 SERVICE_TOKEN_REQUIRED

# 8. Internal analytics endpoint with wrong token
curl -i -H "X-Internal-Token: wrong" http://artist-service:3040/internal/artists/test/analytics
# Expected: 403 SERVICE_TOKEN_INVALID

# 9. Internal analytics endpoint with correct token
curl -i -H "X-Internal-Token: $INTERNAL_SERVICE_TOKEN" http://artist-service:3040/internal/artists/test/analytics
# Expected: 200 (only inside Docker network)

# 10. Internal dashboard-metrics endpoint without token (inside Docker)
curl -i http://artist-service:3040/internal/artists/test/dashboard-metrics
# Expected: 401 SERVICE_TOKEN_REQUIRED

# 11. Internal dashboard-metrics endpoint with wrong token
curl -i -H "X-Internal-Token: wrong" http://artist-service:3040/internal/artists/test/dashboard-metrics
# Expected: 403 SERVICE_TOKEN_INVALID

# 12. Internal dashboard-metrics endpoint with correct token
curl -i -H "X-Internal-Token: $INTERNAL_SERVICE_TOKEN" http://artist-service:3040/internal/artists/test/dashboard-metrics
# Expected: 200, response contains monthlyPlays, totalPlaysAllTime, uniqueListenersMonthly, likesCount, etc.

# 13. Portal dashboard without auth
curl -i https://artists.earflow.ru/api/artist-portal/dashboard
# Expected: 401

# 14. Portal dashboard with auth but no MFA
# Expected: 403 MFA_REQUIRED

# 15. Portal dashboard with auth+MFA returns meta with real dashboard metrics
# Expected: 200, meta contains merged public fields + private dashboard metrics
```
