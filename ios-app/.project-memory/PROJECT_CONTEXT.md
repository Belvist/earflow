# Project Context — Earflow iOS Listener

## Product

Native **listener** client for Earflow music platform. Same backend as `earflow.ru` web SPA — not a separate product API.

## Users

Logged-in listeners: discover music, search, social feed, playback, profile.

## Non-goals (v0.x)

- Artist portal (`artists.earflow.ru`) — separate app future.
- Backend logic duplication on device.
- Offline-first catalog sync (planned later).

## Repository location

```text
ios-app/
  Earflow/           Swift sources
  EarflowTests/      Unit tests
  project.yml        XcodeGen
  CONTEXT.md         Service card (Earflow monorepo)
  .project-memory/   Agent memory (this folder)
```

## External docs (monorepo)

| Doc | Purpose |
|-----|---------|
| `docs/IOS_APP.md` | Architecture reference |
| `docs/AUTH_TARGET_ARCHITECTURE.md` | Native auth principles |
| `docs/BACKEND_FRONTEND_BOUNDARY.md` | `INV-ARCH-002` |
| `universal_project_agent_pack/` | Production-grade agent discipline |

## Domains

- API: `https://api.earflow.ru` (only allowed HTTP host in prod)
- Covers: `https://earflow.ru/covers/{filename}`
- Auth UI parity: web `EmailAuth` on `auth.earflow.ru`

## Bundle

`ru.earflow.listener` · iOS 17+ · Swift 5.10 · SwiftUI
