# iOS Playback — Phase 3 (engineering)

**Owner:** playback / streaming only — **не смешивать** с home UI / sheet gestures.  
**Manual gate:** OPEN until device log shows `engine ready` + audible audio.

---

## Контракт (web → iOS)

| # | Web (`HlsSession` + hls.js) | iOS native |
|---|-----------------------------|------------|
| 1 | `POST /api/ebap-hls/v1/session` `{ trackId }` | `StreamSessionService.createSession` — same |
| 2 | Direct stream: `?st=` via stream-ticket | HLS: **no** `?st=` — only `token` + `mp_hls` (web `getSongHlsSession` parity) |
| 3 | `GET master.m3u8` via browser (cookies + `token`, **no** Sec-Fetch-Dest: document) | `HLSPlaybackPreflight` + `AuthenticatedStreamResourceLoader` (URLSession, **не** native AVPlayer HTTPS) |
| 4 | hls.js fetches segments with credentials | Resource loader rewrites playlist → `earflow-stream://api.earflow.ru/...` |

**Host (prod):** session API returns `strmhaha.earflow.ru` in `masterUrl`; iOS rewrites bytes to **`api.earflow.ru`** (`AppConfiguration.prefersGatewayForNativeHLS`). Оба хоста в nginx имеют `/api/ebap-hls/*`; iOS на gateway из‑за TLS/VPN и единого cookie jar.

**nginx:** `Sec-Fetch-Dest: document` на `.m3u8` → 403. AVPlayer native HTTPS шлёт это → **запрещён**. Единственный путь — custom scheme + resource loader.

---

## Фазы (строго по порядку)

### Phase 0 — сборка (gate)
- [x] `cd ios-app && xcodegen generate` перед каждым verify
- [x] `npm run verify:ios-native` — build + 47 tests

### Phase 1 — звук на устройстве (BLOCKING)
**Критерий закрытия:** один трек, 10 сек, слышен звук + в логе:
```
session ready track=N mp_hls=true path=...
engine ready path=/api/ebap-hls/v1/hls/N/master.m3u8
```
**Запрещено в логе:** `native https failed`, `permission to access`, лавина `playback_load_timeout` при одном тапе.

| Симптом | Одно действие |
|---------|----------------|
| `hls preflight forbidden` | headers/cookie/token — не трогать UI |
| `hls preflight unauthorized` | mp_hls / session POST — auth path |
| preflight 200, AVPlayer fail | segment rewrite / loader only |
| таймауты при спаме треков | Phase 2 |

### Phase 2 — стабильность
- Быстрое переключение треков без `limit_conn` шторма
- Offline → мгновенная ошибка (не вечный loading)
- `playbackError` в UI

### Phase 3 — player UI (отдельно от streaming)
- Mini bar / sheet — **не** блокируют Phase 1
- Web 1:1 gestures (`INV-SHEET-*`) — явно OUT OF SCOPE до Phase 1 closed

---

## Файлы (single owner)

| Файл | Роль |
|------|------|
| `PlaybackActor.swift` | единственный owner play/pause/seek |
| `StreamSessionService.swift` | session + cache |
| `AVPlayerEngine.swift` | preflight → resource loader only |
| `AuthenticatedStreamResourceLoader.swift` | все HLS bytes |
| `StreamCookieHeaders.swift` | Origin/Referer/cookies |

**Не дублировать:** второй AVPlayer, native HTTPS fallback, parallel play без await cancel.

---

## Verify

```bash
cd ios-app && xcodegen generate
npm run verify:ios-native
```

Manual (device): login → **один** трек → audio + mini bar progress.
