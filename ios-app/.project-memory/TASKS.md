# Tasks — Earflow iOS

Priority: **P0** blockers · **P1** product · **P2** polish

---

## P0 — Gate `PEND-IOS-001`

- [ ] **P0** Simulator test on concrete device (`iPhone 17`) — `verify:ios-native` PASS
- [ ] **P0** Real iPhone smoke (login, play, background audio basic)
- [ ] **P0** Security pass: logout clears all secrets; log audit
- [ ] **P0** Device Sync WS client (no REST polling) — `earflow-device-sync` skill

## P1 — Phase 3 product parity

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
