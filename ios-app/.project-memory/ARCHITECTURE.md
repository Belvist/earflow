# Architecture — Earflow iOS

## Target architecture

Thin native client: **SwiftUI + actors** → **Go API Gateway** → existing Earflow microservices. Same contracts as web listener SPA.

```text
┌─────────────────────────────────────────────────────────┐
│ Features/ (SwiftUI) — presentation only                 │
│   Login, Home, Search, Social, Profile, Player chrome   │
├─────────────────────────────────────────────────────────┤
│ App/ — composition root                               │
│   AppDependencies, EarflowApp, AppConfiguration         │
├─────────────────────────────────────────────────────────┤
│ Core/                                                   │
│   Auth/AuthActor          Playback/PlaybackActor        │
│   Network/GatewayClient   Services/* (catalog, search)  │
│   Logging/EarflowLog      DeviceSync/ (skeleton)        │
│   Design/EarflowTheme     Models/ (gateway DTOs)        │
└─────────────────────────────────────────────────────────┘
                          │ HTTPS only
                          ▼
              api.earflow.ru (go-api-gateway)
```

## Layers (universal pack mapping)

| Layer | iOS mapping |
|-------|-------------|
| UI | `Features/**`, `EarflowTheme` |
| API client | `GatewayClient`, `*Service` actors |
| Application | `AuthActor`, `PlaybackActor`, `PlaybackCoordinator` |
| Domain / state machines | `AuthState`, `PlaybackState`, `STATE_MACHINES.md` |
| Infrastructure | Keychain, URLSession, AVPlayer, WKWebView (Telegram only) |
| Database | **none on device** (backend SOT) |

## Module boundaries

| Module | May call | Must not call |
|--------|----------|---------------|
| Features | `AppDependencies`, theme components | URLSession directly, AVPlayer |
| Services | `GatewayClient` | Auth headers logic duplicated |
| AuthActor | `GatewayClient`, Keychain | UIKit/SwiftUI |
| PlaybackActor | `GatewayClient`, AVPlayerEngine | Device Sync ownership |
| GatewayClient | URLSession | Internal service hosts |

## Dependency rules

1. **One mechanism per responsibility** (`INV-ARCH-001`).
2. **Backend SOT** for permissions, counts, feed order (`INV-ARCH-002`).
3. All HTTP through `GatewayClient.validateGatewayPath`.
4. Composition only in `AppDependencies` (@MainActor).

## Known architecture problems

| ID | Problem | Mitigation |
|----|---------|------------|
| IOS-ARCH-01 | Player sheet simplified vs web `INV-SHEET-*` | Phase 5 rewrite per `docs/MOBILE_PLAYER_SHEET_DESIGN.md` |
| IOS-ARCH-02 | Device Sync skeleton | Phase 4 WS client |
| IOS-ARCH-03 | Social read-only | Phase 3 like/unlike via gateway |

## Migration plan

Phase 3→5 per `TASKS.md`; no big-bang rewrite — extend services + thin views.

## Related

- `docs/IOS_APP.md` — detailed flows
- `universal_project_agent_pack/.project-memory/ARCHITECTURE.md` — template
