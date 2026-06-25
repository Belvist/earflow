# Current State — Earflow iOS

**Updated:** 2026-06-23  
**Phase:** 3 — playback / Device Sync (auth gate **closed**)  
**Gate:** `PEND-IOS-001` **CLOSED** — see `docs/DECISIONS.md` 2026-06-23

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
| Automated verify | ✅ `npm run verify:ios-native` — 34 tests PASS |
| Prod bootstrap | ✅ log evidence `userId=157` |

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

## Playback infrastructure (Phase 3 engineering — 2026-06-23)

- `AuthenticatedStreamResourceLoader` — session cookies on all HLS segments
- `StreamSessionService` cache + logout clear; `playbackError` on coordinator
- Tests: `StreamSessionServiceIntegrationTests` (+37 total in verify gate)
- **Manual gate OPEN:** prod tap → audible playback

Design split: `ios-app/.project-memory/PLAYBACK_PHASE3.md`

---

## Verify

```bash
npm run verify:monorepo-integrity
npm run verify:ios-native   # build + 34 tests incl. auth lifecycle integration
```
