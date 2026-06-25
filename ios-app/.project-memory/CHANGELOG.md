# Changelog — Earflow iOS (agent memory)

## 2026-06-23 — Home hero + full player visual parity (web `HomeMobileHeroV3` / `MobilePlayerModal`)

- **Hero:** MetaRow как web — текст слева, play **справа** (белый круг, чёрная иконка); динамические теги (`HomeHeroTags`); полоска прогресса снизу (46px зона); градиент `BgDim`
- **Full player:** порядок контролов dislike | prev | pause/play | next | like; второй ряд repeat/lyrics/queue/more; «СЕЙЧАС ИГРАЕТ»; close в круге `rgba(255,255,255,0.1)`; accent backdrop светлее
- **Синие кнопки:** убраны `pause.circle.fill` / `play.circle.fill` и `EarflowTheme.accent` на play-иконках в очереди — белые monochrome SF Symbols
- `TrackItem.reason` для hero tags; `verify:ios-native` PASS

## 2026-06-24 — Web login → ASWebAuthenticationSession + PKCE (no more WKWebView)

- **Причина:** WKWebView-логин видел DOM/пароль, cookie-transplant (`syncFromWebKit`) хрупок и не Apple-recommended; вход-окно было техдолгом (cookie forgery уже закрыт PoP).
- `AuthWebLoginView` переписан: `ASWebAuthenticationSession` (системный браузер, SSO) + OAuth2 Authorization Code **PKCE S256**; `NativeWebLoginController`, `PKCE`, `NativeAuthURL`.
- Поток: `auth.earflow.ru/login` → `return_to=…/api/auth/native/finalize?…` → one-time PKCE-bound code → `earflow://auth/callback` → `AuthActor.completeNativeWebLogin(code:codeVerifier:)` → exchange привязывает device-ключ + ставит куки → PoP.
- Удалено: `SessionCookieStore.syncFromWebKit` + `import WebKit`; `resumeSessionAfterWebLogin` → `completeNativeWebLogin`.
- Gateway: `GET /api/auth/native/finalize`, `POST /api/auth/native/exchange` (Redis one-time code, allowlist redirect_uri).
- Verify: `verify:ios-native` build + 56 tests PASS. Prod e2e — `PEND-IOS-002`. См. `DECISIONS.md` 2026-06-24, `INV-SEC-018`.

## 2026-06-23 — Tap reliability + player sheet UX

- **Причина «не с первого раза»:** `DragGesture` на родителе блокировал `Button` (mini-bar, full player, hero)
- Mini-bar: swipe/expand только на зоне трека; play/like — 44×44, без общего gesture
- Full player: dismiss-drag только на handle; play/seek — без конфликта жестов
- `open()` — анимированный snap; mini morph через `miniOpacity`, chrome не пропадает резко
- Hero / track rows / nav / cards: отдельные hit targets + `contentShape`

## 2026-06-23 — Home web parity: playlist page navigation

- Плейлист → **отдельная страница** `PlaylistPageView` (web `/playlist/:id`), не sheet
- Mobile: tap карточки = navigate; **без** play-кнопки на карточке (как `PlaylistSectionMobile`)
- Порядок секций как web: discover rails → popular artists → «Мои плейлисты»
- «Для вас»: web `pickForYouTracks` — 8 треков, 52px cover, без текущего в списке
- `EarflowPlaylistTrackRow` — список на странице плейлиста (номер + обложка)

## 2026-06-23 — Home layout rhythm

- `EarflowTrackRow` — единый row (queue / playlist), `HomeSectionTitle`
- «Для вас» — max 5 треков, обложка 44px
- `homeRailSpacing` 28px между рельсами; `ShellChromeMetrics` для bottom inset скролла
- `PlaylistDetailSheet` + `CatalogService.fetchPlaylist`; tap карточки → sheet, play на карточке → только play
- Макеты A/B/C: `HOME_LAYOUT_MOCKUPS.md`, `HomeLayoutMockups.swift` (#Preview)

## 2026-06-23 — PEND-IOS-001 docs honesty pass (gate stays OPEN)

- `docs/PENDING.md` — `PEND-IOS-001` rewritten: implemented vs not closed on iPhone
- `IOS_AUTH_CLOSURE_CHECKLIST.md` — human gate before close
- `CURRENT_STATE.md`, `HANDOFF.md`, `docs/IOS_APP.md` — prepared ≠ closed
- `docs/DECISIONS.md` — entry: prepared, not closed (no CLOSED claim)

## 2026-06-23 — Playback + auth lifecycle (code)

- `StreamCookieHeaders`, `StreamTicketService`, HLS session cache
- Logout lifecycle: stop playback, clear tickets, device-sync disconnect
- `degraded` banner + 12min revalidate

## 2026-06-23 — PEND-AUTH-IOS-002 full contract chain (in progress)

- `docs/AUTH_ERROR_CODES.md` — SoT enum reference (`authErrorCodes.js`)
- Gateway tests: register VALIDATION_ERROR, EMAIL_ALREADY_REGISTERED, bare-401 gap
- iOS GatewayClient: 400/429 preserve `code` + `retryAfterSeconds` (was losing LOGIN_RATE_LIMITED)
- iOS maps VALIDATION_ERROR, EMAIL_ALREADY_REGISTERED separately
- PEND-AUTH-IOS-002 stays OPEN until gateway go test + prod path

## 2026-06-23 — PEND-AUTH-IOS-002 stable auth codes (backend)

- `backend/auth-service/lib/authErrorCodes.js` — INVALID_CREDENTIALS, LOGIN_RATE_LIMITED, etc.
- Login/register/refresh/MFA paths emit `code` + optional `retryAfterSeconds`
- Gateway passthrough tests `auth_exchange_errors_test.go`
- iOS maps backend codes (INVALID_CREDENTIALS, LOGIN_RATE_LIMITED)

## 2026-06-23 — Auth projection refactor (backend SoT)

- Removed iOS-invented `invalid_credentials` on bare 401
- `BackendAuthCode`, `AuthErrorProjection`, `AuthErrorProvenance`
- `docs/IOS_APP.md` §8 auth error mapping table
- `PEND-AUTH-IOS-002` — stable login error codes in Gateway

## 2026-06-23 — Auth gate sprint (PEND-IOS-001 P0)

**Next focus:** real iPhone login E2E — do not start new features until closed.

- `AuthErrorCategory`, `AuthErrorClassifier`, tests
- `AuthDiagnostics`, `AuthDiagnosticsView` (DEBUG only)
- `MfaStepUpView`, MFA step-up via `/api/auth/2fa/step-up`
- `GatewayHTTPErrorDetail`, richer 401/403 classification
- `verify-ios-native.sh` — named Simulator build+test + gate report
- `HANDOFF.md`, `CURRENT_STATE.md`, `docs/IOS_APP.md` — auth gate focus

## 2026-06-23 — Auth hardening + session handoff docs

- `GatewayClient`: Origin, X-Earflow-Client, 401→refresh retry, skipAuth 401 no clearSession
- `AuthActor`: refreshSession, web login resume, logFailure
- `AuthWebLoginView`, `SessionCookieStore.syncFromWebKit`
- `RootView`: authenticating keeps LoginView (fix cancelled login task)
- `docs/AGENT_SESSION_HANDOFF.md`, `ios-app/.project-memory/HANDOFF.md`
- `docs/DECISIONS.md` entry: agent handoff + iOS auth
- Rules: `earflow-context-discipline`, `earflow-ios-native`, `AGENTS.md` pointers

## 2026-06-23 — Phase 2 + project memory

- EmailAuth UI, Telegram widget, register/login
- MainShell 4-tab + mini player
- Home, Search, Social, Profile with gateway services
- EarflowLog + DebugLogView
- `.project-memory/` + `AGENT_WORKFLOW.md` per universal_project_agent_pack
- Cursor rule `earflow-ios-native.mdc`

## 2026-06-23 — Phase 0–1

- Initial XcodeGen project, AuthActor, PlaybackActor, GatewayClient
- Unit tests, `verify:ios-native` script
