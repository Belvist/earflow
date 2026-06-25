# Current State — Earflow iOS

**Updated:** 2026-06-26  
**Phase:** 3 — playback / Device Sync (auth gate **closed**)  
**Gate:** `PEND-IOS-005` **OPEN** — device playback smoke: `IPHONE_PLAYBACK_SMOKE_INSTRUCTIONS.md`

---

## Auth — closed (automated + prod bootstrap)

| Area | Status |
|------|--------|
| Native form + web login (ASWeb+PKCE, code) | ✅ — `verify:ios-native` 56 tests PASS; prod e2e PEND-IOS-002 |
| Device register + proof token | ✅ |
| Bootstrap / degraded / revalidate | ✅ |
| Logout + lifecycle cleanup | ✅ |
| MFA step-up UI/API | ✅ code; device beta OPEN |
| Auth Gate (DEBUG) | ✅ |
| Automated verify | ✅ `npm run verify:ios-native` — **91** tests PASS |
| Prod bootstrap | ✅ log evidence `user=@…` (numeric id redacted in client logs) |

**Residual (TestFlight, not blocking features):** MFA on physical device, native web-login prod e2e (`PEND-IOS-002`), App Store pipeline. WKWebView login removed (→ ASWebAuthenticationSession + PKCE, `INV-SEC-018`).

---

## Guest-first shell

- `RootView`: guest shell first; `LoginView` as sheet
- `degraded` banner + 12min `revalidateSession` (web parity)
- Session expired/revoked banners

## Home + Player UX — web parity pass (2026-06-23)

- **Home hero:** `HomeMobileHeroV3` layout — MetaRow (play справа), теги, progress strip снизу
- **Home:** «Для вас» **8 tracks** (`pickForYouTracks`), mood chips, popular artists, user playlists, deferred rails (900ms)
- **Catalog pages:** `PlaylistPageView` + `AlbumPageView` — push как web `/playlist/:id`, `/album/:pid`
- **Mini bar:** accent from cover, swipe expand, horizontal skip; play icon white monochrome
- **Full player:** `PlayerChromeOverlay` — web control order + secondary row; white icons; accent backdrop
- **Queue:** `PlaybackCoordinator.syncQueue` + next/prev; like via API

**Residual vs web 1:1 (do not claim done):** hero waveform seek (interactive), dislike/repeat/lyrics/queue wiring, continuous mini→sheet morph (`INV-SHEET-*`), mood-radar screen, Device Sync queue authority

## Playback infrastructure (Phase 3 engineering — 2026-06-23, native HLS 2026-06-25)

- **Native HLS:** `AVPlayerEngine` грузит `AVURLAsset` с `AVURLAssetHTTPHeaderFieldsKey` (Origin) + `AVURLAssetHTTPCookiesKey` (mp_hls). Resource loader **удалён** — отдача HLS-сегментов через `AVAssetResourceLoaderDelegate` запрещена Apple (`-12881`, `INV-IOS-001`).
- **Background / lock screen (P0 fix 2026-06-25 + 2026-06-26):** `NowPlayingController` — единственный владелец `AVAudioSession` (configure **не** в `init`; `.playback` без `.allowAirPlay`; activate на play-intent; **`setActive` разрешён в `.background`** для lock screen remote play; defer только в `.inactive`; deactivate только при `nowPlaying == nil`) + `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter`. **Hard gate:** `PlaybackActor` не вызывает `engine.play()` если session `.failed`/`.deferred`; deferred → `pendingEngineStart` + retry на `didBecomeActive`; remote play не возвращает `.success` вслепую. Smoke logs: `intent=session_activate result=ok|deferred|fail appState=…`. `AVPlayer` state от `timeControlStatus`. `audiovisualBackgroundPlaybackPolicy = .continuesIfPossible`. `UIBackgroundModes: audio` (`INV-IOS-002`).
- `StreamSessionService` cache + logout clear; `playbackError` on coordinator
- **Track switch:** skip HLS preflight после успешного `createSession` (−1 RTT); auth `revalidateSession` debounce 45s, foreground `preferRefresh: false`; **HLS prefetch** (`prefetch: true` / no `mp_hls` rotation) + next-track prewarm when &lt;30s remain (`StreamSessionService.prefetchSession`, platform contract `DECISIONS.md` 2026-06-25)
- **Memory (2026-06-25):** `artworkCache` cap 16 + downscale; `releaseActivePlayer`; `preferredForwardBufferDuration=60`; `progressStream` → `.bufferingNewest(1)`. Gate: `PEND-IOS-004` (Instruments on device).
- **Cold-start auto-resume:** `PlaybackStateStore` + `INV-IOS-004`; throttle/flush `INV-IOS-003`.
- Tests: `HLSPlaybackContractTests`, `NowPlayingControllerTests`, `PlaybackStateStoreTests`, `PlaybackActorAudioGateTests`, `UserProfileLogSafeTests`; `verify:ios-native` build+**104** PASS
- **Device gate OPEN (`PEND-IOS-005`):** background audio, lock screen controls, UI/audio sync, cold-start auto-resume — **только real iPhone**. Инструкция: `IPHONE_PLAYBACK_SMOKE_INSTRUCTIONS.md`. Unit-тесты и Simulator **не закрывают** gate.
- **HLS device gate OPEN (`PEND-IOS-003`):** audible stream on device без `-12881`.
- **Memory gate OPEN (`PEND-IOS-004`):** Instruments ~15 мин на device.

Design split: `ios-app/.project-memory/PLAYBACK_PHASE3.md`

---

## Verify

```bash
npm run verify:monorepo-integrity
npm run verify:ios-native   # build + 94 tests
```
