# Current State — Earflow iOS

**Updated:** 2026-06-23  
**Phase:** 2 (UI + catalog shell) — **not** production-ready  
**Gate:** `PEND-IOS-001` **open**

---

## Phase summary

| Phase | Scope | Status |
|-------|--------|--------|
| 0–1 | Scaffold, auth core, playback core, tests | ✅ build PASS |
| 2 | EmailAuth UI, 4-tab shell, home/search/social/profile, logs | ✅ in tree |
| 3 | Playlists, artist pages, social actions, full player | ⏳ planned |
| 4 | Device Sync WS, analytics flush, background audio | ⏳ planned |
| 5 | App Intents, TestFlight gate, gesture QA | ⏳ planned |

---

## Implemented (verified in repo)

### Core

- `AuthActor` — login, register, telegram login, device register, proof token, logout
- `GatewayClient` — gateway-only, retry, CSRF, blocked internal URLs
- `PlaybackActor` + `PlaybackCoordinator` — single AVPlayer path, HLS session
- `EarflowLog` — ring buffer, redaction, in-app debug console
- `CatalogService`, `SearchService`, `SocialService`

### UI

- `LoginView` — dark EmailAuth parity (tabs, validators, Telegram WKWebView)
- `MainShellView` — home / social / search / profile + mini player bar
- `HomeView` — discover rails + likes
- `SearchView`, `SocialView`, `ProfileView`, `SettingsView`, `DebugLogView`

### Tests

- `CanonicalProofStringTests`, `AuthStateTests` (5 tests)
- `xcodebuild` generic iOS Simulator: **BUILD SUCCEEDED**

---

## Not implemented / partial

- Device Sync WebSocket client (skeleton only)
- Analytics queue flush to backend
- Lock screen / Control Center / background audio polish
- Social like/unlike write paths
- Playlist / album / artist detail screens
- Full mobile player sheet (gestures per `INV-SHEET-*`)
- Mood radar, party, EQ, subscription
- Real device + TestFlight verification
- CI macOS runner for `verify:ios-native`

---

## Known risks

- Telegram login via WKWebView — standard iOS pattern; not native Telegram SDK
- `PlaybackCoordinator` holds display metadata; playback truth remains `PlaybackActor` + backend
- Discover rails DTO supports `playlists[]`; UI flattens tracks for horizontal rails

---

## Next P0 tasks

See `TASKS.md` — Phase 3 entry items.
