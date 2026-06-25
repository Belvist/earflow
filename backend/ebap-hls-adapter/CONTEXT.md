# ebap-hls-adapter — service context card

**Stack:** Bun + TypeScript (HTTP server)
**Status:** production
**Owners:** streaming

## Назначение

Control-plane + origin для EBAP HLS: создаёт playback-сессии (`POST /session`), отдаёт master/variant playlists и сегменты, lyrics. Потребители: listener SPA (hls.js), iOS `AVPlayer`, nginx edge (`api.earflow.ru`).

## Public API

| Method | Path | Auth | Назначение |
|---|---|---|---|
| POST | `/api/ebap-hls/v1/session` | user session / gateway | HLS session: `masterUrl`, `expiresAtMs`, `Set-Cookie: mp_hls` (+ lyrics) |
| GET | `/api/ebap-hls/v1/hls/*` | `mp_hls` cookie or `?token=` | Playlists + segments |
| GET | `/api/ebap-hls/v1/lyrics` | `mp_lyrics` cookie | Encrypted lyrics metadata |
| GET | `/health` | none | liveness |

### Session intent: play vs prefetch

`POST /session` body `{ trackId, prefetch?: true }` or header `X-Earflow-Session-Intent: prefetch`:

| Intent | `Set-Cookie: mp_hls` | `Set-Cookie: mp_lyrics` | Response |
|---|---|---|---|
| **play** (default) | yes — bound to `trackId` | yes | `masterUrl` + `expiresAtMs` |
| **prefetch** | **no** | **no** | `masterUrl` + `token` in URL + `prefetch: true` |

Prefetch warms `masterUrl` in client cache **without** rotating `mp_hls`. Overwriting `mp_hls` mid-playback breaks segment auth for the track that is still playing (same class of bug as direct-stream `mp_stream` prefetch).

On actual play/skip client must call session **without** prefetch so cookie rotates to the new track.

## Owns

```
Redis: ebap lyrics keys, rate limits, transcode locks (see src/redis/)
MinIO/S3: EBAP chunks, HLS output paths
Cookies: mp_hls (HMAC, track-bound), mp_lyrics (per-session AES key envelope)
```

## Dependencies

- Postgres (track readiness via gateway upstream)
- Redis
- S3/MinIO media
- ffmpeg (on-demand transcode path)

## Caveats

- `mp_hls` is **single** browser cookie — one active playback track per origin.
- Prefetch responses rely on signed `?token=` on `masterUrl`; cookie may still point at previous track until play session POST.
- iOS/web must use separate client caches for `play:` vs `prefetch:` session entries.
- Direct-stream (`mp_stream`) prefetch overwrite is **not** fixed here — HLS-only contract.

## Tests

- `backend/integration-tests/tests/hls_invariants.test.ts` — play session cookies, prefetch no-cookie
- `ios-app/EarflowTests/HLSPlaybackContractTests.swift` — native header/cookie contract
