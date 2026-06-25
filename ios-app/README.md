# Earflow iOS (Listener)



Native SwiftUI listener app for Earflow. **All traffic goes through API Gateway** — no direct internal service access.



## Agent workflow (обязательно)



Перед любой задачей в `ios-app/`:



1. `ios-app/.project-memory/AGENT_WORKFLOW.md`

2. `ios-app/.project-memory/CURRENT_STATE.md`

3. `universal_project_agent_pack/.ai/AGENT_RULES.md`



## Requirements



- macOS with **Xcode 15+**

- iOS 17+ deployment target

- Optional: [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`)



## Quick start



```bash

cd ios-app



# 1. Generate Xcode project (first time or after project.yml changes)

xcodegen generate



# 2. Open in Xcode

open Earflow.xcodeproj



# 3. Select iPhone simulator → Run (⌘R)

```



## Build & test from CLI



From repo root:



```bash

bash scripts/verify-ios-native.sh

```



Or manually:



```bash

cd ios-app

xcodegen generate

xcodebuild -project Earflow.xcodeproj -scheme Earflow \

  -destination 'platform=iOS Simulator,name=iPhone 17' \

  build test CODE_SIGNING_ALLOWED=NO

```



## Local API override (DEBUG) — симулятор без интернета



Prod `https://api.earflow.ru` **нужен интернет**. Если на симуляторе сети нет — поднимите gateway на Mac:



```bash

# из корня репозитория

docker compose -f docker-compose.yml -f docker-compose.auth-e2e.yml up -d \

  postgres redis redis-auth database-service auth-service security-service \

  api-gateway auth-e2e-edge



curl -sS http://127.0.0.1:18080/api/public-config

```



В Xcode: **Product → Scheme → Edit Scheme → Run → Arguments → Environment Variables**



- Включить (галочка): `EARFLOW_API_BASE_URL` = `http://127.0.0.1:18080`

- Пересобрать (⌘R)



На экране логина (DEBUG) будет `API: http://127.0.0.1:18080`. Интернет на симуляторе для этого **не нужен** — только docker на Mac.



### Если интернет нужен (prod API)



Симулятор делит сеть с Mac: проверь Wi‑Fi на Mac, отключи VPN, перезапусти Simulator. Снимите галочку с `EARFLOW_API_BASE_URL` в Scheme — приложение пойдёт на `https://api.earflow.ru`.



## Architecture



| Module | Responsibility |

|--------|----------------|

| `Core/Auth` | `AuthActor`, Keychain, P-256 proof, proof token cache |

| `Core/Network` | `GatewayClient` — only `api.earflow.ru` (or dev host) |

| `Core/Playback` | `PlaybackActor`, `PlaybackCoordinator`, HLS session |

| `Core/Services` | Catalog, Search, Social |

| `Core/Logging` | `EarflowLog` — redacted journal |

| `Core/DeviceSync` | WS skeleton — server state = truth |

| `Features/` | SwiftUI — thin presentation |



See `docs/IOS_APP.md`, `ios-app/CONTEXT.md`, `ios-app/.project-memory/`.



## Status (Phase 2 — 2026-06-23)



- EmailAuth UI, 4-tab shell, home/search/social/profile, mini player

- Auth + playback foundations, gateway-only, debug log

- **`PEND-IOS-001` closed** (2026-06-23) — 34 automated tests; TestFlight separate

- Device Sync / full player sheet / App Intents: not done



## Verify



```bash

npm run verify:ios-native

```



Debug logs in app: **Профиль → Настройки → Журнал отладки**


