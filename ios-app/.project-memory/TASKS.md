# Tasks — Earflow iOS

Priority: **P0** blockers · **P1** product · **P2** polish

---

## P0 — Gate `PEND-IOS-005` (playback device smoke)

- [x] **P0** P0 code: AVAudioSession -50 fix, timeControlStatus sync, auth hot-path (`verify:ios-native` 91 PASS)
- [ ] **P0** Real iPhone playback smoke — `IPHONE_PLAYBACK_SMOKE_INSTRUCTIONS.md` (lock screen, background ≥60s, switch, no auth storm)
- [ ] **P0** Close `PEND-IOS-005` only with evidence bundle + `DECISIONS.md` entry

## P0 — Auth / other

- [x] **P0** Simulator — `verify:ios-native` PASS
- [ ] **P0** Real iPhone auth prod e2e (`PEND-IOS-002`)
- [ ] **P0** Memory Instruments gate (`PEND-IOS-004`)

## P1 — Phase 3 product parity

- [x] **P1** Home mobile UX Phase 1 — hero, queue list, playlist rails, skeleton
- [x] **P1** Mini player + sheet Phase 1 — progress, seek, backdrop polish
- [ ] **P1** Playlist / album / artist detail screens
- [ ] **P1** Social like/unlike (`POST /api/social/posts/:id/like`) — backend DTO driven
- [ ] **P1** Profile full (`/api/profile`) + listener settings sync
- [ ] **P1** Queue / next track (backend or device-sync owned)
- [ ] **P1** AnalyticsQueue flush with idempotency keys

## P2 — Phase 4–5 polish

- [ ] **P2** Full player sheet per `docs/MOBILE_PLAYER_SHEET_DESIGN.md`
- [ ] **P2** Lock screen + Now Playing info center
- [ ] **P2** App Intents (play/pause/search)
- [ ] **P2** macOS CI job for `verify:ios-native`
- [ ] **P2** Mood radar, party (after web contract stable)

---

## Completed (archive)

- [x] Phase 0–1 scaffold (Auth, Gateway, Playback actors)
- [x] Phase 2 EmailAuth UI + 4-tab shell + catalog services
- [x] EarflowLog + debug console
- [x] `.project-memory/` per universal_project_agent_pack
