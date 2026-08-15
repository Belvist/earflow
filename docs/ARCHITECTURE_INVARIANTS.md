# Архитектурные инварианты — Earflow

**Назначение:** жёсткие правила, нарушение которых = архитектурный регресс. AI-агент **обязан** прочитать этот файл перед любым изменением, затрагивающим listed-области. Если предложение нарушает инвариант — стоп, обсудить с человеком.

**Формат:** `[ID] Правило — Почему — Красный флаг (что нарушает)`.

---

## Cross-cutting (все роли, все сервисы)

### INV-ARCH-001 — Один механизм на одну ответственность (no stacked escape hatches)

Для одного и того же поведения или состояния — **один** канал управления. Исправление бага не оправдывает добавление второго параллельного пути без удаления или слияния старого.

- **Почему:** слои расходятся (prod vs local, React vs DOM vs CSS); отладка превращается в «какой слой сработал»; баги множатся (урок mini play style 2026-06).
- **Правило для AI:** `.cursor/rules/earflow-ui-client-prefs.mdc` (секция INV-ARCH-001), `INV-FE-008`.
- **Красный флаг:** React state + imperative `apply*ToDom` + `public/*-overrides.css` + `!important` в `App.js` для **одного** UI pref; второй polling «если WS упал» при уже принятом always-on WS; дублирование ownership на frontend и backend.
- **Исключение:** временный escape hatch только с `docs/PENDING.md` + `docs/DECISIONS.md` + **раскрытием пользователю в том же ответе**.

---

## Recommendations

### INV-REC-001 — recommendations-service единственный SoT для listener reco

Персональная выдача, сессия, exclude, skip-burst refresh и feedback realtime — **только** `recommendations-service` (Engine V2 + `sessionStateMachine`). Frontend шлёт intents и рендерит DTO; не считает skip-burst, не шлёт `excludeIds` как authority.

- **Красный флаг:** `GET /api/songs/recommendations` (database-service) для prod listener; client-side skip burst → refresh без `clientActions.refreshRecommended`; дублирующий ranking/exclude path на frontend.
- **Контекст:** `backend/recommendations-service/CONTEXT.md`

---

## DeviceSync / Playback authority

### INV-DS-001 — Backend единственный источник правды для playback state

Все изменения `nowPlaying`, `activeDeviceId`, `lease`, `timeline` инициируются на backend (`device-sync-service`). Frontend — receiver.

- **Красный флаг:** frontend code вида `transferTo(self)`, `optimisticActiveDevice = self.id`, `localOutputState = 'ACTIVE'` без серверного frame.
- **Источник:** Spotify Connect модель. Race conditions от dual authority — наша история до 2026-05.

### INV-DS-002 — `cmd:play` = intent, не объявление

Когда любой девайс отправляет `cmd:play` и **не является active** (или active отсутствует), backend сам делает `StartTransfer`. Frontend никогда не делает self-transfer перед `play`.

- **Файл:** `backend/device-sync-service/internal/devices/registry.go` → `Registry.SendCommand`.
- **Тесты:** `transfer_fsm_test.go::TestSendCommandTransferOnPlay*`.
- **Красный флаг:** в `deviceSyncControls.js` появляется `transferTo` перед `sendCommand({cmd:'play'})`.

### INV-DS-003 — Никаких periodic publish от frontend

Frontend публикует `nowPlaying` snapshot **только** на реальные события: смена трека, play↔pause, drift позиции > `POSITION_DRIFT_PUSH_SEC`. Никаких `setInterval(publishNowPlayingIfDue, X)`.

- **Файл:** `frontend/src/components/DeviceSync/nowPlayingPublishPolicy.js`.
- **Красный флаг:** появление новых `setInterval`/`setTimeout` для publish в `DeviceSyncProvider.js`.

### INV-DS-004 — Server frame ordering trusted

Frontend применяет любой WS frame от `device-sync-service` без stale-фильтрации. Backend через Redis Pub/Sub гарантирует ordering per-user.

- **Красный флаг:** появление функций вида `isStaleX`, `if (incomingRev < currentRev) break;` в `useDeviceSync.js`.

### INV-DS-005 — Никакого локального rebuild `devices[]` или `nowPlaying.deviceId`

При `devices:active` frame frontend сохраняет только `activeRevision`. Все остальные поля приходят через свои собственные frames (`np:update`, `lease:update`, `devices:update`).

- **Красный флаг:** код вида `devices.map(d => ({ ...d, isActive: d.id === activeId }))` в `useDeviceSync.js`.

### INV-DS-006 — WebSocket — always-on после `register`

Никакой "standby REST polling если <2 устройств". WS открывается всегда после регистрации device. REST `listDevices` — только одноразовый best-effort bootstrap перед первым `init` frame.

- **Красный флаг:** появление `setInterval(listDevices, ...)`, `connectionState: 'standby'`, `if (devices.length < 2) return;` в connect path.

### INV-DS-008 — Cached deviceId должен валидироваться против server device set перед mint/use

Frontend не имеет права mint'ить WS-ticket, открывать `/ws/devices?ticket=...` или слать `POST /api/devices/commands` от `deviceId` из `sessionStorage`/ref-кэша без cross-check'а что этот device **до сих пор зарегистрирован** на backend'е в той же connect-итерации. device-sync Redis evict'ит idle device'ы после `DEVICE_TTL` (~10 мин); `sessionStorage` переживает reload вкладки → stale id.

- **Реализация:** `useDeviceSync.js` — после `apiClient.listDevices()` проверять `deviceIdRef.current in listed.devices[].id`; если нет → `deviceIdRef.current = null; writeStoredDeviceId(null)` + re-register. Safety net: при 2 подряд WS upgrade без `onopen` — сбросить cached deviceId.
- **Почему:** gateway `/api/auth/stream-ticket` mint'ит `ws_connect` ticket **без** Redis-lookup'а device-sync (так задумано — нет Redis SETNX на mint hot path, `INV-SEC-015`). Без client-side cross-check фронт loop'ит на свежих билетах для несуществующего device → `TouchDevice` nil → 403 storm (`NOT_OWNED` на commands, `forbidden` на WS upgrade). См. `DECISIONS.md` 2026-07-16.
- **Красный флаг:** код mint'ит WS ticket / шлёт `cmd` от cached `deviceIdRef.current` без предшествующего `listDevices().devices.includes(deviceId)`; `sessionStorage.getItem(DEVICE_ID_STORAGE_KEY)` читается в `connect()` без проверки актуальности; WS `onclose` без `sawWsOpen` не сбрасывает cached id после повторных неудач.

### INV-DS-009 — Auth epoch/revoke состояние — Redis SoT, не in-memory per replica

Никакой code в device-sync / direct-stream / ebap-hls-* не имеет права полагаться на **in-memory-only** state (`sync.RWMutex` map, `sync.Map`) для хранения session epoch floors, device epoch floors, revoke tombstones, jti denylist — всё, что должно быть **одинаково на всех репликах** с момента revoke.

- **Почему:** реплика после restart/reconnect pub/sub пропустила RevokeEvent → stale `SessionEpochStale`/`IsSessionRevoked` → один WS upgrade проходит у replica A, 401 у replica B → пользователи видят «через раз». Cross-replica race — главный баг SEC-005 до 2026-08-09. См. `DECISIONS.md` 2026-08-09.
- **Реализация:** `backend/device-sync-service/internal/streamticket/epoch_cache.go` хранит L1 local map + write-through в **auth-redis** под `auth:session:epoch:{sid}` / `auth:session:revoked:{sid}` с TTL 45d. Read: local hit → reply; local miss → Redis `GET` → populate local. Override prefix: `STREAM_TICKET_EPOCH_KEY_PREFIX` (default `auth:session:` — же namespace что gateway `auth:session:meta:*`).
- **Допустимое исключение:** `StatisticCache`, rate-limit buckets, goroutine metrics — всё что не влияет на auth correctness. Любой "shared view" должен быть Redis или PG.
- **Красный флаг:** новый `sessions map[string]int64` / `revokedSids map[string]struct{}` без auth-redis рядом; `EpochCache` без rdb первым параметром в конструкторе; revoke subscriber пишет только в local map.

### INV-DS-010 — Server-pushed rotated ticket в приоритете над opaque-mint на reconnect

При reconnect WS frontend **в первую очередь** пробует `ticket:rotate` token из предыдущего успешного handshake, **затем** SEC-005 opaque mint, **затем** legacy REST `/api/devices/ws-ticket`.

- **Почему:** mint по 60s TTL даёт race при slow LTE handshake (mint → open → timeout → mint → ...). Server-pushed rotation гарантирует что каждый следующий reconnect использует свежий under-its-own-TTL token без отдельного mint round-trip. См. Spotify Connect ticket rotation по аналогии. Избавляет от "через раз". См. `DECISIONS.md` 2026-08-09.
- **Хранилище frontend:** module-scoped `Map<deviceId, {token,expiresAtMs}>` в `useDeviceSync.js`, **in-memory only** (никакого localStorage/sessionStorage — SEC-005 red flag). Delete on use, logout, stale device.
- **Backend:** `client.go::sendRotatedTicket()` после успешного handshake+init. Никаких race по parallel mint/verify — тот же auth-redis, тот же SEC-005 path для initial mint.
- **Красный флаг:** reconnect пробует opaque/form `mintWsConnectStreamTicket` ПЕРЕД тем как check rotatedTicketCache; ticket rotation кладёт token в sessionStorage; несколько ротаций накоплены в массиве (TTL не чистит их).

---

## Security

### INV-SEC-001 — JWT в httpOnly cookies, не в localStorage

Frontend не имеет права читать/писать JWT. Auth-state через `useAuth` хук, который полагается на gateway-set cookies.

- **Красный флаг:** `localStorage.setItem('token', ...)`, `Authorization: Bearer ${localToken}` в frontend.

### INV-SEC-002 — Параметризованные SQL во всех Node-сервисах

Никакой конкатенации user input в SQL. Используем pg-параметры (`$1`, `$2`).

- **Красный флаг:** `\`SELECT ... WHERE user_id = '${userId}'\`` в backend.

### INV-SEC-003 — Service-to-service через `X-Service-Token` + JWT audience/issuer

Сервисы не доверяют сырым headers (`X-User-Id` приходит только из gateway session middleware).

- **Файл:** `backend/go-api-gateway/internal/auth/`.
- **Красный флаг:** Node-сервис читает `X-User-Id` напрямую без validation через service token.

### INV-SEC-010 — Browser API: cookie + device proof (PoP), не cookie-only

Для listener/artist gateway authenticated browser API недостаточно `mp_sid` (+ `mp_csrf` на unsafe). Требуется ECDSA P-256 proof (`X-Auth-Device-*`) от `authDeviceId`, привязанного к sid в Redis.

- **Реализация:** `DeviceProofMiddleware`, `POST /api/auth/device/register`, `RevokeSessionFull`.
- **Allowlist (без proof):** login/register/telegram, `GET /api/auth/csrf`, `POST /api/auth/device/register`, `public-config`, health/metrics.
- **WebSocket:** `/ws/*` не аутентифицируется cookie-only; ticket через authenticated POST (например `/api/devices/ws-ticket` с proof).
- **Prod fallback запрещён:** `ALLOW_COOKIE_AUTH_WITHOUT_PROOF=1` только local/test; в production env игнорируется.
- **Красный флаг:** `if (!proof) next()` на authenticated routes; второй путь «только cookies» в prod.

### INV-SEC-011 — PoP e2e harness routes never in production gateway

`/e2e/*` (seed-session, fixture) только в `cmd/pop-e2e-harness` с `//go:build pop_e2e_harness`. Prod `cmd/gateway` binary не содержит harness strings.

- **Красный флаг:** `/e2e/seed-session` в `server.go` или `http_routes.go`; harness без build tag.

### INV-SEC-012 — CI blocks PoP bypass in production deploy configs

`scripts/validate-auth-prod-guard.js` (also `validate:ai`, CI) fails if prod artifacts set `ALLOW_COOKIE_AUTH_WITHOUT_PROOF=1`, `REACT_APP_ALLOW_COOKIE_AUTH_WITHOUT_PROOF=1`, or `REACT_APP_DEVICE_PROOF_REQUIRED=0`.

- **Allowlist:** playwright configs, e2e specs, docs — not docker-compose prod / frontend Dockerfile.

### INV-SEC-013 — Route audit: protected `/api/*` requires PoP when session present

CI tests (`route_pop_audit_test.go`) assert gateway `require_user` routes and auth handler paths require `DeviceProofMiddleware` when authenticated sid exists; cookie-only sample paths return `401 DEVICE_PROOF_REQUIRED`.

- **Красный флаг:** new `require_user` gateway route without PoP coverage; protected path in `DeviceProofBypassPaths`.

### INV-SEC-014 — Spoofed internal headers never authenticate

`InternalHeaderSanitizer` strips client `X-User-Id`, `X-Artist-Id`, `X-Service-User`, service tokens before auth. Contract tests: spoofed headers + session cookie without proof → `401`; spoofed headers without session → `401 NO_SESSION`.

- **Красный флаг:** upstream reads client-controlled `X-User-Id`; sanitizer removed from `server.go` chain.

### INV-SEC-015 — Postgres auth SoT: no SELECT on every API request

Postgres tables `auth_sessions`, `auth_devices`, `refresh_tokens`, `security_events` are SoT; Redis remains session cache and PoP nonce path until Proof Access Token (PEND-SEC-013). Gateway hot handlers (`GET /api/profile`, catalog, stream) **must not** query Postgres per request.

- **Разрешённые PG reads:** security UI session list, admin/audit, backfill jobs — behind `AUTH_PG_SOT_MODE=pg_read`+.
- **Revoke:** `RevokeSessionFull` writes Postgres **before** Redis when `AUTH_PG_SOT_MODE` enables writes (`security-service` `AuthSoT`).
- **Красный флаг:** `pgx` query in gateway middleware per authenticated GET; Proof Access Token before epoch revoke (PEND-SEC-012).

### INV-SEC-016 — Auth rollout: prepared ≠ closed

Security phase (PoP, PG SoT, epoch revoke, Proof Access Token) is **closed** only after its **browser/prod gate**, not when backend code or automated script PASS alone.

- **Документация:** `docs/AUTH_ROLLOUT_GATES.md`, `.cursor/rules/earflow-auth-rollout-gates.mdc`
- **Красный флаг:** agent marks PEND-SEC-* closed after `verify-*.sh` only; «готово для миллионов» without capacity report; new WS/MFA features before SEC-013 browser DoD 8/8.

### INV-SEC-017 — Proof Access Token: hot path token, sensitive full ECDSA

When `PROOF_ACCESS_TOKEN_ENABLED`, hot authenticated GET/light API may use `X-Auth-Proof-Access-Token` (local JWT verify, no Redis SETNX). Sensitive paths (`logout`, `refresh`, `proof/token`, `sessions/*`, `password/change`, `security/*`, `2fa/*`, `device/register`) **must** require full `X-Auth-Device-Proof*`; token-only → `401`.

- **Close gate:** `scripts/run-auth-proof-token-browser-dod.sh` or documented 8/8 DevTools PASS.
- **Красный флаг:** hot path accepts token-only on sensitive routes; claiming scale readiness without capacity gate; frontend sends full ECDSA on every GET when token cache is valid (misses optimization goal).

### INV-SEC-018 — Native web login: ASWebAuthenticationSession + PKCE + device-bound exchange

Нативный «вход как на сайте» (iOS/Android) — только через системный auth-браузер (`ASWebAuthenticationSession`) + OAuth 2.0 Authorization Code **PKCE (S256)**. Возврат сессии — через одноразовый PKCE-bound code (`/api/auth/native/finalize` → `earflow://` → `/api/auth/native/exchange`), который привязывает device-ключ к сессии. Дальше — обычный PoP (`INV-SEC-017`).

- **redirect_uri** строго по allowlist (`NATIVE_AUTH_REDIRECT_URIS`) — нет open-redirect; code одноразовый (GETDEL) + TTL ≤ 60s; exchange бесполезен без `code_verifier`.
- **Красный флаг:** WKWebView/in-app webview, который читает пароль/куки логина; cookie-transplant как способ внести сессию; приём сессии по code без проверки PKCE или без one-time consume; finalize, отдающий данные пользователя вместо редиректа с code; добавление второго native-login пути рядом с этим (`INV-ARCH-001`).

### INV-SEC-019 (предложение, 2026-08-11) — WebCrypto PoP ключи только неизвлекаемые

**Область:** `frontend/src/auth/authDeviceCrypto.js` И `artist-frontend/src/auth/authDeviceCrypto.js` — **ОБЕ** копии обязаны использовать единый путь. Сейчас две параллельные копии — это уже tech debt (INV-ARCH-001: dual implementations одного протокола).

Client-side ECDSA для Device Proof MUST создаваться с `extractable: false` и `usages: ['sign']`. IndexedDB хранит opaque CryptoKey handle, не raw key material. Экспортация `pkcs8` запрещена в production code paths (jest-тест проверяет `pkcs8 === null`).

- **Red flag (любой из двух):** `true` в generateKey / exportKey ('pkcs8'|'jwk') под PoP context; ключи в localStorage/sessionStorage.
- **Red flag:** добавление `invalidateAuthDeviceBinding` /гоre-export в одной из двух копий без второй.

Client-side ECDSA для Device Proof MUST создаваться с `extractable: false` и `usages: ['sign']`. IndexedDB хранит opaque CryptoKey handle, не raw key material. Экспортация `pkcs8` запрещена в production code paths (jest-тест проверяет `pkcs8 === null`).

- **Red flag:** `true` в generateKey / exportKey ('pkcs8'|'jwk') под PoP context; ключи в localStorage/sessionStorage.

### INV-SEC-020 (предложение, 2026-08-11) — Revoke propagation также имеет sweep safety-net

Redis Pub/Sub revoke events are **best-effort**. Every consumer (gateway, device-sync, streaming service) обязан иметь periodic re-read источника правды (Redis `auth:sids:revoked` / shared epoch floor) с TTL-синхронизацией локального кэша. Иначе miss-событие = revocation задержка до pod restart (worst-case многие часы).

- **Реализация:** go-api-gateway `SessionManager.startRevocationSweep` + device-sync-service. Sweep interval — `AUTH_REVOCATION_SWEEP_INTERVAL`, default 30s.
- **Red flag:** новый consumer pub/sub `earflow:auth:session:revoke:v1` без аналогичного sweep; revocation логика которая только подписывается.

### INV-SEC-021 (2026-08-15) — Любой revoke чистит ОБА слоя ключей: gateway mp:sess И auth-service сессию

Gateway `RevokeSessionFull` MUST чистить не только `mp:sess:{gw-sid}`, но и auth-service ключи, адресованные node-sid/node-jti из claims refresh-токена: `auth:sid:{node-sid}`, `auth:session:meta:{node-sid}`, `auth:stepup:{node-sid}`, `auth:refresh:{node-jti}`, `auth:grace:{node-jti}`, `SRem auth:user_sids:{uid}` (`revokeNodeSession`). Иначе logout оставляет ghost-сессию живой до 365d TTL (подтверждено на проде).

- **Реализация:** `SessionManager.RevokeSessionFull` вызывает `nodeSessionClaims` (чтение `mp:sess` ДО удаления) + `revokeNodeSession`; то же в NATS/pubsub subscriber. Все новые revoke-пути обязаны идти через `SessionManager.RevokeSessionFull`. Извлечение claims — строго ДО любых downstream-ревоков, которые удаляют `mp:sess` (при `AUTH_PG_SOT_MODE=dual_write` security-service revoke удаляет `mp:sess` раньше локального — иначе ghost-сессия выживает, см. DECISIONS 2026-08-15).
- **Red flag:** прямой вызов package-level `RevokeSessionFull(ctx, rdb, prefix, sid, ...)` без последующей чистки node-ключей; revoke-путь, который не читает refresh-токен из `mp:sess` до его удаления; чтение `mp:sess` после sot/security-service revoke.

### INV-SEC-022 (2026-08-15) — Писатели Redis-ключей auth — с TTL, активные устройства обновляют его

Все ключи, создаваемые в Redis-auth (кроме осознанных долгоживущих), MUST иметь TTL. Device-chain (`auth:device:*`, `auth:sid_devices:*`, `auth:user_auth_devices:*`) при `maxmemory-policy noeviction` без TTL растёт бесконечно (на проде было 432 ключа без TTL и росло с каждым логином). `AuthDeviceStore.Save` ставит TTL = `SESSION_TTL_SECONDS`, `Touch` (каждый успешный proof) его продлевает.

- **Red flag:** новый `SET ... EX 0` / `Set(..., 0)` на auth-ключи; device/session-ключ, который не обновляет TTL при активности.
- **Red flag:** писатель device/session-ключей мимо `AuthDeviceStore` (обход TTL).

### INV-SEC-023 (2026-08-15) — Device-proof выполняется ДО refresh-ротации; PoP нельзя ослаблять

Refresh-ротация (gateway `SessionAuthMiddleware`) не имеет права происходить раньше, чем пройден device-proof на этом же запросе. Порядок middleware на gateway: `DeviceProofMiddleware` НАРУЖУ, `SessionAuthMiddleware` внутри. Украденный `mp_sid` cookie без device-ключа → 401 (proof), refresh жертвы не ротируется/не сжигается. При `ALLOW_COOKIE_AUTH_WITHOUT_PROOF=1` (не-прод) ослабление — осознанный escape hatch, не default.

- **Red flag:** снова `SessionAuthMiddleware(DeviceProofMiddleware(...))` (Session наружу) в server.go/тестах — это возвращает ротацию до proof (H-1).
- **Red flag:** `deviceProofRequiredForRequest` без резолва sid из cookie (только `ctxSID`) — под флипом PoP перестанет применяться к не-sensitive `/api`-путям.
- **Red flag:** PoP-требование смягчено/сделано условным в проде без аудита.

### INV-SEC-024 (2026-08-15) — Чувствительные локальные auth-POST под double-submit CSRF

Локальные auth-POST в `MountRoutes` (refresh, logout, proof/token, stream-ticket, device/register) проходят `CSRFProtectionMiddleware` (Origin + cookie/header match + HMAC). Прод `SameSite=none` — CSRF-cookie не защищает сама, только Origin. Pre-session (login/register/telegram/csrf) и native-потоки исключены (нет csrf-поверхности).

- **Red flag:** новый чувствительный POST в `MountRoutes` мимо CSRF-группы; добавленные эксклюды refresh/logout в middleware; `skipCsrf: true` на refresh/logout/device-register во фронте (`client.js` logout).
- **Red flag:** CSRF-группа расширяется на pre-session маршруты без csrf-cookie (login/register) — сломает первый вход.

---

## Frontend

### INV-FE-001 — `PlayerContext` не делает прямой fetch ownership state

Player читает ownership state через `DeviceSyncContext`. Не дублирует `currentTrack/isPlaying` локальной мутацией поверх remote state.

- **Красный флаг:** `setCurrentTrack` внутри `PlayerContext` без проверки `isActiveOnServer`.

### INV-FE-002 — Стили — styled-components рядом с компонентом

`<Component>.styles.js` рядом с `<Component>.js`. Не один глобальный CSS файл на весь модуль.

### INV-FE-003 — Pointer-жесты только через arbiter + gesture machine

Swipe/drag surfaces во frontend должны проходить через `GestureArbiterProvider` и `usePointerGestureMachine` либо через arbiter-aware hooks (`usePointerDragScroll`, `usePointerSeek`, `useSheetDragArbitration`). Mini-player, player sheet dismiss, cover stack, playlist rail, seek и bottom sheet не имеют права распознавать один `pointerId` как независимые локальные gestures.

- **Документация:** `docs/GESTURE_ARCHITECTURE.md`, `.cursor/rules/earflow-gesture-architecture.mdc`
- **Красный флаг:** новый `onTouchStart`/`onTouchMove`, Framer `drag` + `onDragEnd` для swipe, `window.addEventListener('scroll', ...)` для сброса gesture, или локальный pointer state machine без `arbiter.tryClaim/release`.

### INV-FE-004 — Directional drag surface обязан задавать `touch-action`

Поверхность, которая владеет directional pointer-drag (dismiss-down, sheet drag, seek, cover swipe), обязана задать `touch-action`, отключающий конкурирующую нативную ось скролла (`none`, либо `pan-x`/`pan-y` для перпендикулярной оси). Иначе на РЕАЛЬНОМ touch браузер сам начинает нативный скролл и шлёт `pointercancel` — жест умирает, хотя `setPointerCapture` вызван. Pointer capture НЕ отменяет нативный скролл; это делает только `touch-action`.

- **Красный флаг:** surface с `usePointerGestureMachine`/claim на скроллящейся странице, у которого `touch-action: auto` (по умолчанию) на элементе под пальцем или его предке; ставить `touch-action: none` на контейнер, который содержит scrollable descendants (ломает их нативный скролл — ставь на сам drag-элемент).

### INV-FE-005 — Mobile gesture e2e гоняются РЕАЛЬНЫМ touch, не мышью

E2E мобильных жестов обязаны диспатчить настоящий touch (`Input.dispatchTouchEvent` через CDP / `page.touchscreen`), дающий `touchstart`/`touchmove` и `pointerType:"touch"`. `page.mouse`/`locator.click()` в "мобильном" жестовом тесте — false-green: он проверяет mouse-путь и НЕ ловит баги `touch-action` / конкуренции с нативным скроллом. Helpers: `frontend/e2e/helpers/touch.js`.

- **Красный флаг:** `page.mouse.*` или `locator.click()` как имитация пальца в mobile gesture spec; комментарий "имитирует палец" над mouse-кодом.

### INV-FE-006 — Client UI prefs: unified store + server sync

Косметика слушателя (mini bar, play style, будущие поля) — **один** модуль `frontend/src/preferences/listenerUiPrefs.js`:

- local cache `earflow_listener_ui_v1` + `useSyncExternalStore` (через `useMiniBarVariant` / `useMiniPlayStyle`);
- **server:** `user_settings.listener_ui` JSONB (GET/PUT `/api/user/settings`) для авторизованных — sync между устройствами;
- `ListenerUiPrefsSync` гидратирует после login; `updatedAt` — conflict resolution (newer wins);
- DOM: `dataset` + CSS vars `--ef-mini-bar-variant`, `--ef-mini-play-style`.

- **DECISIONS:** 2026-06-01 listener UI prefs server sync.
- **Красный флаг:** новый отдельный `localStorage` key на каждый pref; picker-only `useState`; дублирующий store без `listener_ui` на backend.

### INV-FE-007 — Запрет imperative DOM paint для UI prefs

Функции вида `apply*ToDom` (inline `style.setProperty(..., 'important')`, ручное `display` на слотах) для client UI prefs **запрещены**. Исторический долг `applyMiniPlayStyleToDom` снят 2026-06-01 (DECISIONS).

- **Эталон:** `miniPlayStyle.js` / `miniBarVariant.js` + `useSyncExternalStore` + условный React-рендер; ранний FOUC — только `:root[data-mini-play-style]` в `mini-player-overrides.css`.
- **Красный флаг:** новый `apply*ToDom` / `querySelectorAll` + `!important` inline styles для UI pref; dual DOM slots «на всякий случай» вместо одного условного компонента.

### INV-FE-008 — AI обязан раскрывать trade-offs UI prefs пользователю

При добавлении или расширении client UI pref (второй play-слот в DOM, override CSS в `public/`, SW cache bust, `!important` в `App.js`) агент **в том же ответе** сообщает пользователю: (1) что принято как норма (external store), (2) что является техдолгом, (3) что нужно для проверки на prod (деплой, build hint). Не откладывать архитектурную оценку «на потом» или только в код-ревью.

- **Правило:** `.cursor/rules/earflow-ui-client-prefs.mdc`.
- **Красный флаг:** diff с `apply*ToDom` / `mini-player-overrides.css` / dual DOM slots, а в ответе пользователю только «готово, обновите страницу».

### INV-FE-009 — Playback progress: один источник времени для seek/progress UI

Позиция воспроизведения для seek bars, waveform и time labels — **один** канал: `currentTimeRef` + `PlayerStore.currentTime`, синхронизируемые через `PlayerContext.patchStorePlaybackTime` на preview/commit seek. UI surfaces используют `useSeekableProgress` (или его контракт), не отдельный local `useState` для progress percent.

- **Почему:** dual read (ref vs store) давал snap-back к 0 после scrub (2026-06-03).
- **Красный флаг:** progress UI читает `store.currentTime`, а `commitSeek`/`updateSeek` пишут только `currentTimeRef`; отдельный `previewPct` state в hero/modal без `onPreviewSeek` → `updateSeek`.
- **Норма:** `beginSeek` → `updateSeek` (preview) → `commitSeek` → `PlayerCore.seek`; `resolvePlaybackDurationSec` для duration до готовности audio element.

### INV-SHEET-001 — `sheetDragY` — единственный драйвер Y модалки

Вертикальная позиция fullscreen player (`MobilePlayerModal` overlay) задаётся **только** через `sheetDragY` из `usePlayerSheetState` (`style.y`). Никаких параллельных Framer `animate y` на том же overlay.

- **Owner:** `usePlayerSheetState.js` + `utils/playerSheetPhysics.js`.
- **Правило:** `.cursor/rules/earflow-player-sheet.mdc`.
- **Красный флаг:** `animate(yMotion, …)`, `animate={{ y: 0 }}` на modal overlay при переданном `sheetDragY`; прямой `sheetDragY.set` из gestures/modal.

### INV-SHEET-002 — Фаза OPEN только через owner settle

`PLAYER_SHEET_PHASE.OPEN` выставляется **только** в `finishOpen()` (tap) или `runSnap(…, OPEN)` onComplete. Нельзя ставить OPEN, пока `sheetDragY` не у top (кроме instant open path).

- **Красный флаг:** prop `openInstantly`; `sheetFullyOpen={true}` до `y===0`; phase OPEN при активном conflicting spring.

### INV-SHEET-003 — Modal без Framer animate по оси Y

`MobilePlayerModal` **запрещено** `initial`/`animate`/`exit` для vertical `y` на sheet overlay. Spring settle — только в `usePlayerSheetState.runSnap`.

- **Красный флаг:** `initial={{ y: … }}`, `animate={{ y: … }}` на `ModalOverlay` / sheet root при integrated `sheetDragY`.

### INV-SHEET-004 — Chrome overlay без spring lag

Opacity, scale, border-radius, backdrop fade — из `sheetProgress` (`useTransform`), 1:1 с пальцем. Transport controls (`ControlsDock`) **монтируются** только при `sheetFullyOpen && !draggingFromMini` — без параллельной ветки `controlsOpacity` + `chromeSettled`.

- **Красный флаг:** spring `animate` на overlay opacity/scale параллельно `sheetProgress`; три ветки chrome (`controlsOpacity`, `chromeSettled`, `showPlayerControls`) для одного блока.

### INV-SHEET-005 — Drag прерывает snap; anchor + delta

Любой новый drag (`beginSheetDrag` / `beginDrag`) **останавливает** snap-анимацию и якорит Y в текущей позиции. Движение: `applySheetDragDelta(dy)` = `rubberBand(anchorY + dy)`. Dismiss работает **с mid-snap**, не только когда `phase === OPEN`.

- **Красный флаг:** `settleDrag` no-op «если snap идёт»; dismiss guard `!sheetFullyOpen`; `dragYFromMiniPull(closedY, dy)` без anchor при re-drag; `beginDrag` early return при `DRAGGING` без `stopSnapAnimation`.

### INV-SHEET-006 — Modal dismiss через sheet API

При integrated mini-bar sheet модалка **не** анимирует Y локально. Dismiss: `onSheetDragStart` → `beginSheetDrag`, `onSheetDragMove` → `applySheetDragDelta`, `onSheetDragSettle` → `settleDrag`. Кнопка close → `cancel()` / `finishClosed()`.

- **Красный флаг:** `animateDismissClose`, `animateDismissBack`, `writeSheetY` в modal без owner; dismiss без `useOwnedSheetDrag`.

### INV-SHEET-007 — Mini-bar не отдаёт жест page scroll

Mini-bar (`touch-action: none`) классифицирует open через `classifyMiniBarSheetIntent` — **без** метрик `window.scrollY`. `handleGestureTrack` не вызывает `sheet.cancel()` при видимой модалке; `handleScrollIntent` не закрывает sheet.

- **Красный флаг:** `classifyMiniPlayerOpenIntent(input)` напрямую в MINI_PLAYER_OPEN profile; `sheet.cancel()` в `onTrack`/`onScrollIntent` при `isSheetModalVisible`.

### INV-SHEET-008 — Player chrome L3: portal, pointer-events, scroll handoff

Mobile listener player chrome (`PlayerChrome` → `document.body` portal) **не** живёт внутри scrollable L1. Mini-bar: `pointer-events: none` при `modalVisible` или `sheetOpen` (in-flight drag сохраняется через pointer capture). Dismiss drag в modal: только при `scrollTop === 0` у `[data-queue-scrollarea]` / `[data-sheet-scrollarea]` (`sheetScrollHandoff.js`). Global `pointerup` settle — **только** для `dragSource === 'mini'`; modal dismiss не должен получать `settleDrag(0,0)` от window backup.

- **Owner:** `PlayerChrome/`, `usePlayerSheetState.js`, `sheetScrollHandoff.js`, `MobilePlayerModal.js`.
- **Правило:** `docs/MOBILE_PLAYER_SHEET_DESIGN.md` §2, §5–6.
- **Красный флаг:** inline `<MobilePlayerBar>` в `App.js` на mobile; `miniBarPointerEvents: auto` при `modalVisible`; dismiss при `queue.scrollTop > 0`; window `pointerup` settle без `dragSourceRef` guard.

### INV-GESTURE-010 — Exclusive mini-bar pointer (per slot)

Жест, начатый на mini-bar (`data-mini-gesture-zone`, `claimOnPointerDown` + `exclusive`), **не отдаётся** другим surfaces на **том же `pointerId`** до `pointerup`. Другие surfaces вызывают `shouldDeferToMiniPlayerGesture` и не стартуют tracking в зоне mini. Перевод `PLAYER_SHEET` → `MINI_TRACK_SWIPE` на том же `pointerId` — единственный allowed transfer.

- **Owner:** `GestureArbiterProvider.js`, `miniPlayerGestureZone.js`, `useMiniPlayerPan.js`, `usePointerGestureMachine.js`.
- **Красный флаг:** SEEK перехватывает mini на том же `pointerId`; cover claim при touch на mini; `exclusive` без `pointer-down` на mini surfaces.

### INV-GESTURE-011 — Per-pointer arbiter + domain session

`GestureArbiterProvider` хранит **`Map<pointerId, owner>`**, не один глобальный `activeRef`. Политика claim — **`gestureDelegates.evaluateGestureClaim`**. UI-домены: **`useMiniPlayerGestureSession`** для mini-bar, не пара хуков в родителе. `recoverGestures` / `cancelOwner` — аварийный путь.

- **Документация:** `docs/GESTURE_ARCHITECTURE.md`
- **Красный флаг:** singleton arbiter; `MobilePlayerBar` вызывает `usePlayerSheetState` отдельно; preempt чужого `pointerId`.

### INV-GESTURE-012 — Arbiter-native sheet drag (no Framer recognizer)

Generic `BottomSheet` и аналоги двигают Y через **`useSheetDragArbitration` + `usePointerGestureMachine`**, не через Framer `drag` / `dragControls.start`. Spring только для settle (`animate(motionValue)`).

- **Owner:** `BottomSheet.js`, `useSheetDragArbitration.js`
- **Красный флаг:** `drag="y"`, `useDragControls`, `dragControls.start` на sheet handle; второй `tryClaim` без machine на том же handle.

### INV-SHEET-009 — Snap-to-closed не блокирует mini-bar; recover при залипании

Быстрые horizontal track swipes вызывают `finishClosed()` до анимации смены трека. Watchdog на `DRAGGING` вызывает `settleDrag`, не `recoverInteraction`. `recoverInteraction()` — **аварийный** путь (tab hide / unmount), не штатный после свайпов.

- **Почему:** ранний `phase=CLOSED` до spring обнулял mini `pointer-events` при ещё видимой модалке → «всё мёртво».
- **Owner:** `usePlayerSheetState.js`, `useMiniPlayerPan.js`, `miniTrackSwipeAnimation.js`.
- **Красный флаг:** `snapToClosed` с `setPhaseSafe(CLOSED)` **до** `runSnap`; horizontal swipe без `finishClosed`; `forceUnlock` вызывает `recoverInteraction` на каждый `sheet-closed`; нет `recoverInteraction` в публичном API sheet.

### INV-SHEET-011 — Фаза SNAPPING между finger-up и settled OPEN/CLOSED

После `settleDrag` / dismiss commit sheet переходит в `PLAYER_SHEET_PHASE.SNAPPING` до завершения spring. `modalVisible` остаётся true при close-snap (`holdModalForCloseSnap`). Новый drag (`beginSheetDrag`) **прерывает** snap. Controls (`showPlayerControls`) монтируются только при `phase === OPEN`, не во время `SNAPPING`.

- **Owner:** `playerSheetPhase.js`, `usePlayerSheetState.js`, `MobilePlayerModal.js`.
- **Красный флаг:** `runSnap` без `SNAPPING`; dismiss/controls логика читает только `DRAGGING|OPEN` без `SNAPPING`; `settleDrag` no-op в `SNAPPING`.

### INV-SHEET-010 — Mini-bar: один pan controller, legacy stack запрещён

Mini-bar expand / track swipe / tap — **один** поток: `document` capture `pointerdown` (rail steal) + `window` `pointermove/up` в `useMiniPlayerPan.js`. React handlers на `MiniPlayerShell` **запрещены**. Legacy stack (`useMiniPlayerGestureMachine`, `useMiniPlayerGestures`, `useMiniPlayerGestureCoordinator`, `useMiniPlayerGestureCaptureRouting`) **удалён** — не восстанавливать.

- **Почему:** слои capture-routing + gesture machine + React shell + window continuation давали freeze ~50%, TDZ crash, mid-drag settle.
- **Owner:** `useMiniPlayerPan.js`, `useMiniPlayerGestureSession.js`, `miniPlayerPanSession.js`.
- **Эталон:** `docs/MOBILE_PLAYER_SHEET_DESIGN.md` §2, §5.
- **Красный флаг:** любой из legacy файлов; `onPointerDown` на mini shell; `settleDrag` во время active expand pan (кроме `pointerup`); второй mini pan path параллельно `useMiniPlayerPan`.

---

## Backend (Node)

### INV-BE-001 — Health endpoint + graceful shutdown в каждом сервисе

Каждый Node-сервис экспортит `GET /health` и слушает `SIGTERM` для graceful shutdown.

### INV-BE-002 — Миграции через явные SQL-файлы

Никаких автомиграций ORM. Все changes в `backend/<service>/db/migrations/` или `backend/00-create-tables.sql`.

---

## Social

### INV-SOCIAL-001 — Backend owns feed DTO, frontend is renderer-only

Лента `/social` получает render-ready DTO от backend. Frontend не вычисляет порядок ленты, `liked`, `canManage`, автора, счётчики или cursor из локального состояния и не хранит mock posts как fallback.

- **Почему:** social feed multi-device by nature; локальная логика быстро расходится с сервером и создаёт второй source of truth.
- **Owner:** `backend/database-service/routes/social.js`, `backend/database-service/lib/socialPosts.js`.
- **Красный флаг:** `SocialPage` сортирует посты, пересчитывает likes/counts/permissions, подставляет автора из `localStorage`, держит seed/mock feed после появления backend API.

### INV-SOCIAL-002 — Social viewer identity only from gateway session

Protected `/api/social/*` routes читают viewer только из gateway-injected `X-User-Id` после `require_user + require_service_token`. `userId`, `authorId`, `viewerId` из body/query не участвуют в authz.

- **Owner:** `backend/go-api-gateway/gateway.yaml`, `backend/database-service/routes/social.js`.
- **Красный флаг:** `POST /api/social/posts` принимает `user_id` из body; `GET /api/social/feed?userId=...`; direct browser route без `X-Service-Token`; gateway route без `require_user`.

### INV-SOCIAL-003 — Public post DTO is privacy-minimized

Social post DTO exposes only fields needed for rendering and viewer-scoped controls: `author.displayName`, `author.avatarUrl`, `author.initials`, `metrics.likes`, `viewer.liked`, `viewer.canManage`. Internal user ids, handles and exact update timestamps stay server-side unless a separate public profile contract is designed.

- **Почему:** stable internal ids/handles in feed responses become unnecessary correlation surfaces.
- **Красный флаг:** `author.id`, `author.handle`, `updatedAt` in `/api/social/feed`; like/unlike returning full post DTO; frontend showing delete controls for posts without `viewer.canManage`.

---

## Gateway (Go)

### INV-GW-001 — Маршруты только в `gateway.yaml` / `gateway.artist.yaml`

Никакого hardcoded routing в `.go` файлах. Routing — конфигом.

### INV-GW-002 — Policy classes не ослаблять без аудита

`public` → `unsafe` или `stream` → `public` требует security review.

---

## iOS (native)

### INV-IOS-001 — HLS сегменты не через AVAssetResourceLoaderDelegate; auth через AVURLAsset options

Для HLS на iOS `AVAssetResourceLoaderDelegate` может отдавать **только** ключи шифрования, плейлисты (.m3u8) и редиректы. Отдача байтов сегмента (.m4s/.ts/.mp4) через `respondWithData` → `CoreMediaErrorDomain -12881` (подтверждено Apple DTS). Native AVPlayer владеет сетью; auth (Origin + cookies) инжектится через `AVURLAsset(options:)`.

**Красный флаг:** `AVAssetResourceLoaderDelegate` + `dataRequest.respond(with:)` для HLS; custom scheme (`earflow-stream://`) на сегментах; «native HTTPS fallback» как второй playback-путь; inline `Cookie` в `AVURLAssetHTTPHeaderFieldsKey` одновременно с `AVURLAssetHTTPCookiesKey`. См. `docs/DECISIONS.md` 2026-06-25.

### INV-IOS-002 — AVAudioSession + Now Playing + Remote Command единым владельцем

Системная интеграция воспроизведения (категория/активация `AVAudioSession`, `MPNowPlayingInfoCenter`, `MPRemoteCommandCenter`, прерывания, смена маршрута) живёт в **одном** owner (`NowPlayingController`), управляемом `PlaybackCoordinator`. Remote-команды только форвардят intent в координатор — не запускают свой playback.

**Красный флаг:** `AVAudioSession.setCategory/setActive` в двух местах (напр. снова в `AVPlayerEngine`); установка `MPNowPlayingInfoCenter.nowPlayingInfo` из нескольких мест; remote-команда, дергающая `AVPlayer`/`PlaybackActor` напрямую мимо координатора; обновление Now Playing на каждый progress-тик без throttle; обложка/метаданные через аутентифицированный cookie jar. См. `docs/DECISIONS.md` 2026-06-25.

### INV-IOS-003 — на непрерывном playback-пути нет unbounded-аккумуляции

Любой кэш/буфер на пути долгого воспроизведения должен быть ограничен: артефакты (обложки) — жёсткий лимит + eviction (FIFO/LRU) и downscale, а не full-res `UIImage` бессрочно; высокочастотный latest-value `AsyncStream` (progress ~2 Гц) — bounded buffering (`.bufferingNewest(1)`); каждый `load`/смена трека полностью освобождает предыдущий `AVPlayer`/`AVPlayerItem` (pause + `replaceCurrentItem(nil)` + снятие observers + `player = nil`); forward-буфер AVPlayer ограничен (`preferredForwardBufferDuration`). Иначе — jetsam OOM на устройстве за минуты непрерывного воспроизведения.

**Красный флаг:** `dict`/`array` как property растёт по уникальному ключу (cover URL, trackId) без eviction; `AsyncStream {}` без `bufferingPolicy` для high-freq потока; новый `AVPlayer` без полного release старого; full-res `UIImage`/`MPMediaItemArtwork`, удерживаемый бессрочно; «исправлено» по зелёной сборке без device Instruments (Allocations/Leaks/Memory Graph). См. `docs/DECISIONS.md` 2026-06-25 и `PEND-IOS-004`.

### INV-IOS-004 — Persisted playback state без auth-материала; restore re-resolve'ит stream

Снимок состояния плеера для cold-start auto-resume (`PlaybackStateStore` → `PlaybackSnapshot` в sandbox) хранит **только** стабильные метаданные каталога (`TrackItem`) + позицию (сек) + индекс + очередь (cap). На восстановлении свежий HLS-поток **re-resolve'ится** через обычный pipeline (`StreamSessionService.createSession`), а воспроизведение идёт через единый путь `PlaybackCoordinator.restore` → `play(startAt:)` → `PlaybackActor` (никакого второго playback-механизма, `INV-ARCH-001`/`INV-IOS-002`).

**Красный флаг:** persist подписанного/токенизированного stream-URL (`?token=`/`?st=`/`masterURL`), `mp_*` cookies, JWT или иного auth-материала в snapshot; реплей сохранённого URL вместо `createSession` («оптимизация» лишнего POST); restore до auth-готовности (даст 401 и сотрёт сохранённое); запись позиции на каждый progress-тик (disk thrash, нарушает `INV-IOS-003`); второй persistence-owner (scattered UserDefaults/file writes вместо одного `PlaybackStateStore`). См. `docs/DECISIONS.md` 2026-06-25 и `PEND-IOS-004`.

---

## Когда вводить новый инвариант

Новое правило в этот файл добавляется **только** после того, как:

1. Произошёл архитектурный регресс (race, security, performance).
2. Записан в `docs/DECISIONS.md` с разделом "Чтобы не повторилось".
3. Сформулирован "красный флаг" — конкретный паттерн кода, который AI/человек должен ловить при review.

Инвариант — не «пожелание». Инвариант — это **контракт**, нарушение которого ломает систему.
