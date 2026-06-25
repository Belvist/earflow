# iOS Playback — Phase 3 (engineering)

**Owner:** playback / streaming only — **не смешивать** с home UI / sheet gestures.  
**Manual gate:** **OPEN** (`PEND-IOS-005`) — real iPhone smoke: `IPHONE_PLAYBACK_SMOKE_INSTRUCTIONS.md`. Simulator + unit tests не закрывают background/lock screen.

---

## Контракт (web → iOS)

| # | Web (`HlsSession` + hls.js) | iOS native |
|---|-----------------------------|------------|
| 1 | `POST /api/ebap-hls/v1/session` `{ trackId }` | `StreamSessionService.createSession` — same |
| 2 | Direct stream: `?st=` via stream-ticket | HLS: **no** `?st=` — only `token` + `mp_hls` (web `getSongHlsSession` parity) |
| 3 | `GET master.m3u8` via browser (cookies + `token`) | `HLSPlaybackPreflight` (URLSession early auth-check) → **native** `AVURLAsset` |
| 4 | hls.js fetches segments with credentials | AVPlayer fetches segments natively; Origin+cookies через `AVURLAsset(options:)` |

**Host (prod):** session API returns `strmhaha.earflow.ru` in `masterUrl`; iOS rewrites master to **`api.earflow.ru`** (`StreamURLResolver.nativePlaybackURL`). Variants/segments относительные → AVPlayer резолвит на тот же host, переиспользует заголовки/куки.

**Auth-инъекция (native, `AVPlayerEngine.assetOptions`):** `AVURLAssetHTTPHeaderFieldsKey` = Origin/Referer/UA/Sec-Fetch (nginx требует Origin всегда); `AVURLAssetHTTPCookiesKey` = mp_hls и пр. (документированный ключ; куки **только** здесь, не inline).

**Root cause -12881 (closed 2026-06-25):** `AVAssetResourceLoaderDelegate.respond(with:)` для HLS-сегментов запрещён Apple (только ключи/плейлисты/редиректы). Resource loader **удалён**. `INV-IOS-001`.

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
| preflight 200, AVPlayer `-12881` | resolved 2026-06-25: native `AVURLAsset` (resource loader для сегментов запрещён, `INV-IOS-001`) |
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
| `AVPlayerEngine.swift` | preflight → **native** `AVURLAsset` + `assetOptions` (header/cookie injection); **не** трогает `AVAudioSession` |
| `StreamCookieHeaders.swift` | `assetHeaderFields` (Origin/Referer/Sec-Fetch, **без** Cookie) + `playbackCookies` → `[HTTPCookie]` |
| `NowPlayingController.swift` | единственный owner `AVAudioSession` + `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter`; driven by `PlaybackCoordinator` (`INV-IOS-002`) |

**Не дублировать:** второй AVPlayer, resource loader для HLS bytes (`-12881`, `INV-IOS-001`), inline Cookie вместе с `AVURLAssetHTTPCookiesKey`, parallel play без await cancel, **второй настройщик `AVAudioSession` / второй источник Now Playing** (`INV-IOS-002`).

---

## Verify

```bash
cd ios-app && xcodegen generate
npm run verify:ios-native
```

Manual (device): login → **один** трек → audio + mini bar progress.
Background (device, `INV-IOS-002`): свернуть приложение → звук продолжается; lock screen / Control Center показывают обложку+контролы; play/pause/next/prev/seek с локскрина работают; входящий звонок → pause, затем resume; вынуть наушники → pause.
