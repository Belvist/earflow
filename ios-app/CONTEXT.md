# Earflow iOS App — CONTEXT



**Domain:** listener native client (sibling to `earflow.ru` web SPA)  

**Bundle:** `ru.earflow.listener`  

**Gateway:** `https://api.earflow.ru` (prod)



## Agent discipline (binding)



**Before any change:** read `ios-app/.project-memory/AGENT_WORKFLOW.md`  

**Pack reference:** `universal_project_agent_pack/`  

**Cursor rule:** `.cursor/rules/earflow-ios-native.mdc`



After work: update `CURRENT_STATE.md`, `CHANGELOG.md`, contracts if API/screens changed.



## Owns (client-side)



- SwiftUI listener shell (auth, 4-tab nav, mini player)

- Keychain device identity + in-memory proof token cache

- `GatewayClient` — all HTTP to public gateway host only

- `PlaybackActor` — single AVPlayer, HLS session via `/api/ebap-hls/v1/session`

- `EarflowLog` — redacted debug journal

- Local UI state machines (projection only — not business truth)



## Does NOT own



- User identity, sessions, entitlements (backend + gateway)

- Playback authority across devices (`device-sync-service`)

- Stream ticket mint policy (`SEC-005` — consumes same contracts as web)

- Analytics accounting rules (backend)

- Social like counts / feed ordering (backend SOT)



## Upstream dependencies



| Service | Via | Purpose |

|---------|-----|---------|

| go-api-gateway | HTTPS | All API |

| auth/security (through gateway) | `/api/auth/*` | Login, device register, proof token |

| playlist-service | `/api/playlists/discover` | Home rails |

| database-service | `/api/likes`, `/api/social/*` | Likes, social feed |

| search (gateway) | `/api/search/v1` | Search |

| ebap-hls-adapter | `/api/ebap-hls/v1/session` | HLS master URL |

| device-sync-service | `/ws/devices` (planned) | Cross-device playback |



## Auth contract (must match web)



- Cookies: `mp_sid`, `mp_csrf` (URLSession jar)

- Device proof: ECDSA P-256, headers `X-Auth-Device-*`

- Hot path: `X-Auth-Proof-Access-Token` + `X-Auth-Device-Id`

- Reference: `frontend/src/auth/authDeviceCrypto.js`, `proofAccessToken.js`



## Phase status (2026-06-23)

- Auth implementation: **prepared** in repo (see `IOS_AUTH_CLOSURE_CHECKLIST.md`)
- `PEND-IOS-001`: **OPEN** — real iPhone smoke required; see `docs/PENDING.md`



## Caveats



- Device Sync WS + analytics flush: **skeletons**

- Player sheet: simplified vs web `INV-SHEET-*`

- Telegram: WKWebView widget (not native SDK)

- Do not set `ALLOW_COOKIE_AUTH_WITHOUT_PROOF` on prod



## Verification



```bash

npm run verify:ios-native

```



## Invariants



- `INV-ARCH-001` — one control path per behavior

- `INV-ARCH-002` — thin client / backend SOT

- `INV-DS-001..006` — when Device Sync ships

- `INV-SEC-010`, `INV-SEC-017` — auth



## Memory files



`ios-app/.project-memory/` — see `README.md` in that folder.


