# Pending — известный архитектурный долг и нереализованные задачи

**Назначение:** единый список того, что **мы знаем что не сделано** или сделано временно. Альтернатива разбросанным `TODO` / `FIXME` в коде.

**Правила:**
- Запись добавляется когда обнаружен gap, временное решение, или отложенная фича.
- Запись удаляется когда задача выполнена (с упоминанием в `DECISIONS.md`).
- AI-агент **должен** проверить этот файл перед добавлением `// TODO` в код. Любой `TODO` в коде — это нарушение; место для него здесь.

**Формат:** `[ID] Область — Описание — Priority — Notes`.

---

### PEND-AUTH-001 — auth-core (Go): VPS e2e flip + phase 2 (opaque refresh, MFA, artist gateway, k8s)

**Priority:** high
**Status:** open

**Context:** Phase 1 миграции Node auth-service → `backend/auth-core` (Go) реализован и протестирован unit-тестами (крипто-векторы, refresh-ротация с grace, gateway `auth_legacy` upstream, compose-сервис добавлен). Node auth-service **не удалён**, а обёрнут в `auth_legacy` для MFA-роутов. Харденинг 2026-08-13 (см. `DECISIONS.md` "auth-core hardening pass"): clientIP доверяет только `X-Real-IP`, UNIQUE `users_email_hash_unique` (миграция `000003`) + `23505`→`EMAIL_TAKEN`, audit-стрим `auth:audit`. См. `DECISIONS.md` 2026-08-13, `backend/auth-core/CONTEXT.md`.

**Что сделать (VPS e2e — cannot validate from repo):**
1. **Применить миграцию `000003_users_email_hash_unique.sql`** (runner `db-migrations`) ДО флипа — иначе регистрация на auth-core сохраняет гонку.
2. Собрать и развернуть auth-core image на VPS; логи: `POST /api/auth/email/login` идёт на auth-core, `/api/auth/2fa/*` — на Node (auth_legacy).
3. Flip на api-gateway: `AUTH_SERVICE_URL=http://auth-core:3001` + `AUTH_LEGACY_SERVICE_URL=http://auth-service:3001` (обязательно оба). Smoke: register → login → refresh → verify → profile; повторный refresh до истечения grace даёт 401 reuse (есть в audit `auth:audit`), MFA-flow жив.
4. Задать стабильный prod `AUTH_DECOY_SALT` (VPS env; ephemeral default — только локально/тесты).
5. Проверить существующие пользователи (старые 100k-итерации) — rehash upgrade и legacy decrypt v1; проверить, что UNIQUE-дедуп не зацепил реальных дублей.
6. Убедиться, что `JWT_SECRET`/`ENCRYPTION_KEY` НЕ меняются при деплое (иначе ВСЕ сессии умрут).

**Готово в репо (2026-08-13 hardening, pre-VPS):**
- clientIP: `X-Real-IP` (nginx-authoritative) вместо первого `X-Forwarded-For` → IP-троттл не спуфится (`httpapi/server_test.go`).
- Миграция `000003_users_email_hash_unique.sql` + `CreateUser`→`23505`→400 `EMAIL_TAKEN`.
- Audit: `auth:audit` (register/login_locked/login_fail/login_success/telegram_login_*/refresh_rotate/refresh_reuse) — fire-and-forget, LTRIM 10k, TTL 7d.
- Durability подтверждена: redis-auth = AOF + named volume + `noeviction` — сессии переживают релиз/рестарт. Refresh sliding 365d.
- Полный code-review pass (2026-08-13): register/telegram под `throttleAuthIP` (паритет Node `authLimiter`), grace 30m→6h (device-proof гейт на gateway позволяет), `truncateRunes` (кириллица не раскалывается), `bustCache` регистронезависимо. См. `DECISIONS.md` "auth-core полный code-review pass".

**Phase 2 (после стабильного флипа):**
- Opaque refresh-токены (свойства — только Redis), единый sid (gateway ↔ auth-core).
- MFA (TOTP) на Go → полностью отключить Node auth-service и `auth_legacy`.
- artist-api-gateway flip на auth-core; `k8s/configmap.yaml` `AUTH_SERVICE_URL: "http://auth-core"`; удаление Node auth-service из docker-compose и deployment.

---

### PEND-AUTH-002 — Telegram-код подтверждения (2FA/step-up через бота)

**Priority:** medium
**Status:** pending (user: «добавим потом»)

**Что задумано:** после стабильного флипа — код подтверждения через Telegram-бота (аналог Telegram login-code) для: вход на новом устройстве, step-up на критичные действия (revoke-others, смена email/password, delete). Текущий MFA (TOTP) живёт в `security-service` (Go) + Node `lib/mfa/httpRoutes.js`; Telegram-код — отдельный второй фактор, не заменяет PoP (см. `SECURITY_ROADMAP.md`).

**Что сделать:** в `security-service` (или auth-core): выдача одноразового кода через бота по `telegram_id`, Redis `auth:tg2fa:{userId}` TTL ~5m, verify + короткоживущий step-up токен; gateway — маршруты `/api/auth/tg2fa/*`. UI: модалка ввода кода. Интеграция с Telegram Bot API `sendMessage`.

---

### PEND-AUTH-003 — Postgres SoT для refresh-сессий (durability beyond Redis)

**Priority:** high
**Status:** pending (roadmap `SECURITY_ROADMAP.md` п.3 — Postgres SoT)

**Контекст:** сессии целиком в Redis (`auth:sid:`, `auth:refresh:`, `grace`). AOF+volume+noeviction покрывают рестарты, НО: (а) форс-смена пароля/новый деплой с `-v` сносит все сессии (все вылетают), (б) нет epoch revoke (мгновенный масс-ривок), (в) нет источника правды для `revoke-all` и риск-аналитики. Цель — «не вылетает после обновления/долгого незахода» в терминах уровня крупных сервисов.

**Что сделать:** таблицы `auth_sessions`, `auth_devices`, `refresh_tokens`, `security_events` (схема по `AUTH_TARGET_ARCHITECTURE.md`); refresh-бидинг читается из PG c Redis-кэшем (grace-семантика сохраняется); `sessionEpoch`/`deviceEpoch` + Redis pub/sub для мгновенного revoke. После этого — PoP hot path (`PEND-SEC-013`) и `revoke-all`.

---

### PEND-AUTH-004 — Полный auth-ревью 2026-08-14: остаток findings после фиксов (client+server)

**Priority:** high
**Status:** open (часть исправлена 2026-08-14 — см. `DECISIONS.md` "auth полный ревью (client+server)"; ниже — НЕ исправленное, требует решений)

**Исправлено 2026-08-14:** silent 401 loop (SESSION_UNVERIFIED с refresh → fatal + soft-reauth → GUEST + resetRefreshBackoff), logout-гигиена (эпоха refresh, сброс таймеров, чистка стрим-кэшей, удалён wipe app-shell CacheStorage), deviceProofRecovery чистит proof-токен, gateway `verifyAccess` требует `type=access`. Тесты: `refreshManager.test.js`, `AuthContext.resilience.test.jsx`, `client.login.test.js`, `deviceProofRecovery.test.js` (266 client tests PASS; gateway build/vet/test PASS). Load test локально: hot 578.6 RPS p95 16.9ms err 0% — `reports/auth-capacity-20260814.md`.

**Server findings (gateway/auth-service/auth-core) — НЕ исправлены, на ревью человеку:**
1. **H2 XFF/X-Real-IP spoof** (`http_routes.go:490-513 copyClientMetadataHeaders`): клиентский XFF/X-Real-IP пробрасывается в upstream как есть; на prod закрыто nginx (`proxy_set_header X-Real-IP $remote_addr`), но defense-in-depth: санитайзлер должен снимать их или gateway выставлять от своего пира; + лимит длины password/login (CPU-DoS на PBKDF2 600k при спуфнутом IP).
2. **H3 logout↔refresh race** (`session_revoke.go`, `session_manager.go:386`): неатомарные Del/Set `mp:sess:{sid}` могут воскресить сессию после logout. Фикс: сериализовать по sid (singleflight), jti читать внутри атомарной операции.
3. **M1 logout требует полный ECDSA proof** (`proof_access_token.go:49-67`): с потерянным device-ключом пользователь не может разлогиниться (401 DEVICE_PROOF_REQUIRED). Решение: разрешить logout без PoP (Origin+CSRF достаточно).
4. **M2** транзиентный сбой локального `store.Set` после ротации = перманентный логаут (recovery только перечитывает Redis 5×) — использовать grace для восстановления.
5. **M3** gateway `/api/profile` отдаёт устаревший `sess.User` снапшот с момента логина (username/mfaEnabled/isAdmin устаревают) — обновлять из refresh-ответа или проксировать на upstream.
6. **M4** grace-окно 6h (auth-core) vs 30m (Node) + reuse не убивает grace-токены: многократный replay устаревшего jti до 6h. Сократить/сделать одноразовым.
7. **M5** контракт ошибок Node↔auth-core↔gateway расходится (`code` то есть, то нет; 400/401 сливаются) — единый контракт до флипа.
8. **M6** кэш `auth:profile:{uid}`/`auth:is_admin:{uid}` не инвалидируется при security-изменениях (до 600с) — SPA показывает неверный auth-flow.
9. **M7** refresh/verify/profile на Node без rate-limit (globalLimiter skip internal IP) — явные лимиты.
10. **M8** proof-access-токен (90с) не привязан к IP/path; sweep не покрывает gateway-логауты (пишут только security-service) — писать `auth:sids:revoked` при gateway logout.
11. **M9 cross-portal cookie clear** (`cookies.go:72-73 SetSessionCookies→ClearSessionCookies` чистит alt `mp_sid_artists`/`mp_csrf_artists`): логин/refresh на listener стирает куку artist-портала → тихий разлогин в соседнем портале. **Нужно продуктовое решение** (одна сессия на браузер vs раздельные) — сейчас намеренно не менялось.

**Client findings — НЕ исправлены:**
12. **Multi-tab device registration growth:** каждый fresh load минтит новый `authDeviceId`+keypair (INV-SEC-019: non-extractable key, in-memory per-tab) → при каждом обновлении страницы сервер получает новый device-запись; старые не чистятся. Не баг входа (ping-pong не подтверждён — сервер хранит PoP per-device), но ресурсный рост + длинный список устройств. Нужен GC/смержение.
13. **EmailAuth double-submit** — нет guard на повторный клик в `handleSubmit`; **ошибка формы не чистится при вводе**. UX-low.
14. **verifyToken empty-profile** не чистит localStorage user (намеренно не трогается — иначе ломается DEGRADED-with-cache при транзиентном пустом профиле).

---

### PEND-IOS-006 — Search: artist/album detail navigation (iOS)

**Priority:** low
**Status:** open

**Context:** SearchView теперь отображает ряды артистов и альбомов с обложками (`SearchArtistRow`/`SearchAlbumRow`), но тап пока no-op — навигация на страницы артиста/альбома не реализована. Треки играют сразу. См. `CHANGELOG.md` 2026-08-12.

**Что сделать:** по тапу на артиста/альбом — push страницу (аналог web `/artist/:id`, `/album/:pid`), переиспользуя `CatalogService.resolveAlbumPublicId` / `fetchAlbum` и существующие страницы каталога.

---

### PEND-IOS-002 — Native web login (ASWebAuthenticationSession + PKCE): prod e2e

**Priority:** medium
**Status:** implemented (code + unit/integration green), prod e2e open

**Implemented:** Gateway `POST /api/auth/native/exchange` + `GET /api/auth/native/finalize` (PKCE S256, one-time code Redis 60s, device-bound). iOS `ASWebAuthenticationSession` + PKCE replacing WKWebView (`AuthActor.completeNativeWebLogin`). Tests: `native_auth_http_test.go` PASS; `verify:ios-native` build+56 tests PASS. See `DECISIONS.md` 2026-06-24, `INV-SEC-018`.

**`return_to` query preservation — CONFIRMED in code (not an open risk):** `auth.earflow.ru` serves the same `frontend` build (nginx → `frontend` upstream; no separate backend login page). `frontend/src/App.js` keeps `location.search` when forcing `/login`, reads `params.get('return_to')`, `sanitizeReturnTo` (`utils/authRedirect.js`) allows https `*.earflow.ru` and returns `u.toString()` with query intact, then `window.location.replace(returnTo)`. iOS `URLComponents` encodes `&`/`=` inside the `return_to` value (verified empirically); PKCE tokens are base64url (no `+`), so the URLComponents `+` gotcha does not apply.

**Remaining (prod-verify, cannot validate from repo):**
1. Set/confirm gateway env `NATIVE_AUTH_REDIRECT_URIS=earflow://auth/callback` (default applied if unset).
2. Live device flow: open login sheet → site auth (email/Telegram/MFA) → `earflow://` callback → exchange → `authenticated`; assert cookie-only transplant still 401 `DEVICE_PROOF_REQUIRED`.

---

### PEND-IOS-003 — iOS native HLS: device playback gate + undocumented AVURLAsset key

**Priority:** high
**Status:** code done (native `AVURLAsset` header/cookie injection заменил resource loader; `-12881` root cause закрыт), **device playback OPEN**

**Implemented:** `AVPlayerEngine.makeAuthenticatedAsset`/`assetOptions` — `AVURLAssetHTTPHeaderFieldsKey` (Origin/Referer/UA/Sec-Fetch) + `AVURLAssetHTTPCookiesKey` (mp_hls). Удалён `AuthenticatedStreamResourceLoader` (Apple: сегменты через `respondWithData` → `-12881`). См. `DECISIONS.md` 2026-06-25, `INV-IOS-001`. `verify:ios-native` build+67 PASS.

**Техдолг:** `AVURLAssetHTTPHeaderFieldsKey` — **недокументированный** Apple ключ (де-факто стандарт, используется повсеместно, App Store его не реджектит — это строковый ключ словаря, не private API call). Если Apple когда-нибудь его уберёт — Origin перестанет инжектиться → nginx 401. Документированной альтернативы для произвольного заголовка нет; запасной путь — локальный reverse-proxy (тяжелее, больше attack surface) или ослабление nginx Origin-чека (security review).

**Remaining (cannot validate from repo — нужен реальный девайс):**
1. Login → один трек → лог `engine ready path=/api/ebap-hls/v1/hls/N/master.m3u8` + слышимый звук, **без** `-12881`.
2. Быстрое переключение треков без `playback_load_timeout` шторма.
3. Проверить с VPN (исходный кейс TLS/VPN флейки).

---

### PEND-IOS-004 — iOS playback memory: on-device Instruments confirmation (jetsam OOM)

**Priority:** high
**Status:** static fixes applied (code + `verify:ios-native` 71 tests PASS), **device profiling OPEN — НЕ доказано закрытым**

**Context:** iPhone 14 / iOS 26.5 — jetsam OOM через ~12 мин непрерывного воспроизведения (code 9). См. `DECISIONS.md` 2026-06-25 «iOS playback: устранение unbounded-памяти».

**Applied (static, ранжировано по уверенности):**
1. **HIGH** — `NowPlayingController.artworkCache` был unbounded (retained `MPMediaItemArtwork` с full-res `UIImage` на каждый уникальный cover) → лимит 16 (FIFO) + downscale 600px.
2. **Defense-in-depth** — `AVPlayerEngine.loadUncancelled` полностью освобождает старый плеер (`releaseActivePlayer`).
3. **Hypothesis/hardening** — `AVPlayerItem.preferredForwardBufferDuration = 60` (нельзя доказать из репо; зависит от HLS-сервера).
4. **Hardening** — `progressStream()` → `.bufferingNewest(1)`.

**Remaining (cannot validate from repo — нужен реальный девайс):**
1. Instruments **Allocations** (mark generation каждые 2-3 мин) + **Leaks** + **Memory Graph** — ~15 мин непрерывного воспроизведения **+ активное переключение треков** (главный множитель для artwork) + уход в background и обратно. Подтвердить, что resident memory выходит на плато, а не растёт линейно.
2. Если рост остаётся — снять generation-snapshot, найти класс с растущим числом инстансов (вероятные кандидаты: `AVPlayerItem`/`AVURLAsset` если плеер не освобождается; `MPMediaItemArtwork`/`UIImage`; CoreAnimation-слои от 2 Гц re-render).
3. Профилировать с VPN (исходный кейс был с VPN).

**Latent (не текущая причина, но реальный баг):** `AnalyticsQueue.sentKeys: Set<String>` растёт без границы (idempotencyKey уникален per-event из-за timestamp; `flushIfPossible` чистит `pending`, но не `sentKeys`). Сейчас **мёртвый код** — `enqueue`/`trackPlayback` нигде не вызываются. Ограничить (bounded set / clear on flush) при подключении аналитики, иначе тот же OOM-паттерн.

---

### PEND-IOS-005 — iOS playback device verification gate (background + lock screen + cold-start)

**Priority:** high  
**Status:** P0 code prepared (`verify:ios-native` build + **91** tests PASS), **device verification OPEN — НЕ доказано закрытым**

**Scope:** единый gate для (1) background audio / lock screen / remote commands после P0 AVAudioSession fix; (2) cold-start auto-resume; (3) track switch без auth storm; (4) UI/audio desync. Симулятор и unit-тесты **не доказывают** lock screen / audio route.

**Smoke instruction (обязательна перед CLOSED):** `ios-app/.project-memory/IPHONE_PLAYBACK_SMOKE_INSTRUCTIONS.md`

**Implemented (code):**
- P0 (2026-06-25): `AVAudioSession` не в `init`; `.playback` без `.allowAirPlay`; state от `timeControlStatus`; skip HLS preflight после `createSession`; auth revalidate debounce + `preferRefresh: false` на foreground; logs `user=@handle` не numeric id. См. `DECISIONS.md` 2026-06-25 «iOS P0 playback…».
- `NowPlayingController` — `AVAudioSession` + Now Playing + Remote Command (`INV-IOS-002`).
- `PlaybackStateStore` — secret-free persist + auto-resume (`INV-IOS-004`); throttle/flush (`INV-IOS-003`).

**Acceptance (все пункты на real iPhone — см. smoke doc):**

```text
[ ] no OSStatus -50 on device
[ ] background audio continues when phone locked (≥60s)
[ ] lock screen play/pause works with real sound
[ ] lock screen next works
[ ] progress never runs while audio is silent
[ ] no auth bootstrap on every track switch
[ ] no internal numeric userId in client logs
[ ] no stream tickets / cookies in logs
[ ] verify:ios-native PASS
```

**Remaining (cannot validate from repo):**
1. Полный сценарий A–E в `IPHONE_PLAYBACK_SMOKE_INSTRUCTIONS.md` (launch log, lock 60s+, lock controls, 3–5 track switch, optional cold-start auto-resume).
2. Evidence bundle: launch log (~30 строк), log play→lock→pause→play→next, скрин lock screen, UI после unlock.
3. При PASS — prepend `DECISIONS.md`, обновить `CURRENT_STATE` / `HANDOFF` / `CHANGELOG`, удалить эту запись из `PENDING.md`.

**Если частичный FAIL:** см. таблицу «Если FAIL» в smoke doc (не закрывать gate; не возвращать auth refresh в hot path при slow switch).

---

### PEND-SEO-001 — SSR / пререндер для ботов (crawlable контент без JS)

**Priority:** medium
**Status:** open (baseline SEO закрыт 2026-08-10 — см. DECISIONS)

**Context:** Earflow — чистый SPA. Мета/structured data выставляются клиентом (`utils/seo.js`), sitemap генерируется artist-service. Google рендерит JS, но: (1) при «белом экране»/ChunkLoadError бот видит пустоту; (2) Яндекс и соцсети (кроме og-превью) рендерят слабо или не рендерят; (3) `MusicSeoPage` контент индексируется нестабильно.

**Что рассмотреть:** prerender-слой для публичных роутов (`/`, `/music/*`, `/artist/*`, `/album/*`, легальные страницы) — nginx UA-switch на prerender-сервис (puppeteer/rendertron-подобный) или SSR-даунстрим. Не гнаться за Next.js-переписыванием — градация: сначала prerender прокси, SSR только если покажет ROI.

**Implemented:** `backend/prerender-service` (Node + Puppeteer, Chromium non-root, read-only, no cookies, cache, rate-limit). nginx: bot UA → prerender, whitelist путей, graceful fallback на SPA. Верифицировано: H1, title, текст, JSON-LD для Googlebot/Яндекс. 504 устранён (domcontentloaded + settle 2.5s).

**Verify:** `curl -A "Googlebot" https://earflow.ru/music/pop` → в HTML есть `<h1>` и текст страницы без исполнения JS.

---

### PEND-SEO-002 — Prerender не загружает song-данные на /track/* (title/H1 дефолтные, только cookie banner)

**Priority:** medium
**Status:** open — обнаружено 2026-08-13 при верификации numeric→public_id 301

**Context:** Для любых `/track/*` (и numeric, и public_id) prerender отдаёт HTML, где JSON-контент трека отсутствует: `<title>Трек — Earflow</title>`, `<h1>` нет, в `#root` только cookie banner. При этом `/` (home) рендерится полностью (h1 «Earflow»). Значит SPA работает в Chromium, но fetch трека не завершается к моменту снятия страницы. API доступен из контейнера (проверено через node fetch к `api-gateway:3000` — 200 с данными), т.е. это не блокировка gateway/токена.

**Гипотезы (на проверить):**
1. `TrackPage` фетчит `/api/songs/:id` (или `by-public-id`), но в prerender-контексте запрос долгий/падает из-за `PRERENDER_NAV_TIMEOUT_MS`/`SETTLE_MS` + `waitForFunction` ловит дефолтный H1 («Загрузка…»/отсутствие skeleton) слишком рано. `waitForFunction` ждёт `h1, h2, [role=heading]` без skeleton — но у `/track` до загрузки нет H1 (Page→Center="Загрузка…" без h1), значит waitForFunction должен ждать song... но song не успевает.
2. CSRF/refresh в prerender: `apiClient` может делать `/api/auth/csrf`/refresh перед публичным запросом → 403 → retry-пауза → превышение таймингов.

**План:** логировать console/pageerror в prerender-рендере для `/track/*`; добавить больше `waitForFunction`-терпимости (ждать появления `Lights`-подобного текста / non-default title); или отдавать song-контент через server-рендерный meta. Не блокирует деплой 301 (canonical на public-форму работает и без song).

---

### PEND-WAVE-001 — Server-side waveform peaks for hero / seek UI

**Priority:** medium
**Status:** code complete; backfill script ready — **VPS exec pending**

**Implemented:** `waveform_peaks` JSONB on `songs`, generation in `transcode-worker` (ffmpeg), `GET /api/songs/:id/waveform`, frontend `useTrackWaveformPeaks` → API only.

**Backfill:** `scripts/backfill-waveform-status.sql` + `scripts/run-waveform-backfill.sh` — marks existing tracks without peaks as `waveform_status='pending'` for transcode-worker. Run on VPS: `bash scripts/run-waveform-backfill.sh`.

---

## Streaming / Home UI (closed)

### PEND-STREAM-002 — HLS prefetch prod gate (prepared ≠ closed)

**Priority:** high
**Status:** CORS gate closed 2026-07-29; authenticated playback gates still open

**Context:** Platform prefetch contract implemented in repo (`DECISIONS.md` 2026-06-25 + 2026-07-29). Deployed to prod 2026-07-29.

**CORS verified (2026-07-29):**
- [x] OPTIONS `Allow-Headers` contains `X-Earflow-Session-Intent` on prod ✅
- [ ] POST play → `Set-Cookie: mp_hls` exactly once (needs auth cookie)
- [ ] POST `{ prefetch: true }` → no `Set-Cookie: mp_hls` (needs auth cookie)
- [ ] POST header `X-Earflow-Session-Intent: prefetch` → no `Set-Cookie: mp_hls` (needs auth cookie)
- [ ] Current track segments stay 200 after prefetch next (manual or e2e)
- [ ] iPhone smoke (`PEND-IOS-005`) — no 403 / silence / progress-without-sound

**Verify script:** `scripts/verify-hls-prefetch-prod.sh` (session POST needs `PROD_GATEWAY_COOKIE`, `PROD_CSRF_TOKEN`, `IT_TRACK_READY_ID`).

**Prod CORS snapshot (2026-07-29):** `Access-Control-Allow-Headers: Content-Type,Authorization,X-CSRF-Token,X-Correlation-ID,Cache-Control,Pragma,X-Lyrics-Key,X-Earflow-Session-Intent,X-Auth-Device-Id,X-Auth-Device-Proof,X-Auth-Device-Proof-Ts,X-Auth-Device-Proof-Nonce,X-Auth-Proof-Access-Token`

### PEND-STREAM-001 — ~~Direct-stream prefetch still overwrites `mp_stream` cookie~~ — закрыто 2026-07-29

Реализовано: `POST /api/stream/v3/session` с `{ prefetch: true }` / `X-Earflow-Session-Intent: prefetch` → ответ **без** `Set-Cookie` (cookie `mp_stream` не ротируется). Frontend `getSongDirectSession` принимает `options.prefetch`, кэш разделён `play:` / `prefetch:`. `useHlsPrefetch` вызывает direct prefetch с `{ prefetch: true }`. См. `DECISIONS.md` 2026-07-29.

## DeviceSync / Playback

Порядок закрытия Spotify-parity записан ниже: live verification → automated two-client gate → server-owned queue/session → удаление legacy frames → audio output selector.

### PEND-DS-001 — ~~Этап 2: единый `player_state` frame~~ — закрыто 2026-06-11

Реализовано: `player_state` union-frame с `devices`, `nowPlaying`, `timeline`, `lease`, `transfer`, `activeDeviceId`, `activeRevision`, `volumeByDevice` и монотонным `frameRev`; init/list включает `playerState`; frontend читает unified frame и отключает fragmented fallback после полного frame. Legacy frames оставлены deprecated на 1 релиз. См. `DECISIONS.md` 2026-06-11 и `backend/device-sync-service/CONTEXT.md`.

### PEND-DS-002 — ~~Volume per-device на backend~~ — закрыто 2026-06-11

Реализовано: `cmd:set_volume` персистит `user:{uid}:volume:{did}` (TTL `DEVICE_TTL`) и публикуется в `player_state.volumeByDevice`. См. `DECISIONS.md` 2026-06-11 и `backend/device-sync-service/CONTEXT.md`.

### PEND-DS-004 — Prod two-device Spotify parity verification

**Priority:** critical
**Status:** not closed

Кодовый путь для Spotify-style DeviceSync подготовлен: backend-owned `player_state`, transfer-on-play, `payload.nowPlaying` bootstrap для local play, per-device volume. Но “уровень Spotify” нельзя закрывать без live матрицы на двух реальных клиентах (Windows desktop + iPhone/Safari/PWA) после VPS deploy.

**Нужно проверить на prod/staging:**
1. Fresh pair: оба устройства online, active пустой → tap play на iPhone → Windows получает `player_state` с тем же `trackId`, `deviceId=iPhone`, `isPlaying=true`, позицией без старого snapshot.
2. Reverse: tap play на Windows при active iPhone → iPhone получает revoke/suspend, Windows active, второй клиент видит новый трек.
3. Passive controls: pause/play/seek/next/previous с non-active клиента управляют active device без self-transfer, кроме `cmd:play` ownership intent.
4. Volume: `set_volume` меняет только targeted active/per-device volume и не ломает playback state.
5. Reconnect: reload одного клиента, sleep/wake телефона, краткий WS reconnect → нет duplicate audio, active не мигает, `frameRev` монотонный.
6. Negative security: non-owned/expired device id не может публиковать nowPlaying или command; protected routes остаются через gateway/PoP.

**Evidence to attach before closing:** DevTools WS frames или server logs с `player_state.frameRev`, `activeDeviceId`, `nowPlaying.trackId`, `transfer.phase`; команды деплоя и commit hash.

### PEND-DS-005 — Server-owned queue/session context (причина: track mismatch между устройствами)

**Priority:** high (повышен 2026-08-10 — пользователь sees persistent track mismatch)
**Status:** not started

**Почему нужно.** Сейчас queue (список треков, текущий индекс, repeat/shuffle) живёт **только у активного устройства** (`PlayerCore.queue`). Команда `cmd:next` от controller отправляет «next» → active вызывает `playNextTrack()` → новый трек + push `np:update`. Это **happy-path only**:
- active девайс offline/background → cmd:next теряется → mismatch.
- active девайс переходит в другую дорожку, другие ещё не видят np:update → mismatch в UI.
- Transfer между устройствами: новый девайс не знает queue — он получил только текущий трек.

**Что делать (backend-only):**
1. `device-sync-service` хранит `queue:{uid}` в Redis: `{trackIds[], index, repeat, shuffle, queueSource, revision}`.
2. `cmd:next/prev` на backend **атомарно**:
   - Читает queue (не имеет → 409 `NO_QUEUE`).
   - Бампит index с учётом `repeat`.
   - Резолвит trackId → обновляет `nowPlaying` с новым треком (без `IsPlaying` change).
   - Broadcast `player_state` со всеми уже-updated.
   - Сообщает cmd:next к active как "execute" — с **authoritative trackId** в payload. Active только воспроизводит, не решает "что за трек".
3. `cmd:transfer` тоже несёт **полный snapshot queue** — позволяя `restore prevIdx + position` мгновенно на новом устройстве.
4. Frontend слушает `player_state.queue` (не `queueManager.local`) и обновляет UI из backend.

**Эффект:** next/prev становится мгновенным на **всех** устройствах (не только active). Track mismatch исчезает — backend SoT. No client sync needed.

**Инвариант:** если это делать — устрoить through `docs/DECISIONS.md` прежде чем писать код (это INV-DS-001 territory).

**Priority:** high
**Status:** not started

Сейчас DeviceSync синхронизирует текущий track/timeline и часть queue metadata (`queueSource`, `queueName`), но не владеет полноценной очередью как Spotify Connect. `next/previous` исполняются на active device, а passive client не получает backend-owned queue cursor/list.

**Что нужно:**
- Ввести backend-owned playback session/queue snapshot: source type, ordered track ids, current index, shuffle/repeat, queue revision.
- `cmd:next|previous` должен менять session на backend или требовать ack от active с новым snapshot; не держать разные очереди на клиентах.
- Frontend должен показывать passive queue как projection server session, без локального пересчёта ownership/order.
- Добавить tests на stale queue revision, transfer с queue continuity, local play replacing queue.

### PEND-DS-006 — Удалить deprecated fragmented frames после soak

**Priority:** medium
**Status:** waiting for prod soak

`player_state` уже является основным frame, но legacy `np:update`, `devices:active`, `devices:update`, `timeline:update`, `lease:update`, `transfer:update` ещё оставлены как fallback на один релиз. После подтверждённого prod soak нужно удалить fallback paths, чтобы не осталось двух параллельных state channels.

**Что нужно:**
- Зафиксировать prod soak без WS regressions.
- Удалить fragmented fallback из `useDeviceSync.js`.
- Упростить backend publish path: новые поля только через `player_state`.
- Обновить `CONTEXT.md`, `DECISIONS.md`, tests.

### PEND-DS-007 — Automated two-client DeviceSync e2e harness

**Priority:** high
**Status:** not started

Ручная проверка телефона/ПК нужна, но недостаточна. Нужен Playwright/mocked-audio e2e harness с двумя browser contexts под одним user/session, чтобы ловить regressions до VPS.

**Что нужно:**
- Два клиента с разными `clientKey/deviceId`, один backend stack или test double device-sync-service.
- Проверки: local play bootstrap, transfer button, passive pause/seek/next, reconnect, stale frame rejection, volumeByDevice.
- Артефакты: WS frame log + screenshot DevicesPanel/player bar.
- Встроить в `verify:player-mobile`/`validate:ai` как optional gate или отдельный `verify:device-sync`.

### PEND-DS-003 — Audio output device selector (Spotify-style "Этот компьютер — AirPods Pro")

**Priority:** low
**Status:** not started

Это **отдельная** от DeviceSync фича. У Spotify desktop показывает текущий OS audio output (AirPods, динамики). У нас этого нет — мы играем в системный default output.

**Что нужно:**
- Web Audio API позволяет `setSinkId(deviceId)` на HTMLMediaElement (Chrome 110+).
- UI селектор output device — отдельный из DeviceSync output.
- Не путать с `device` из DeviceSync — это **независимый** концепт.

---

## Mobile player sheet

### PEND-SHEET-001 — ~~Фаза `SNAPPING`~~ — закрыто 2026-06-04

Реализовано: `PLAYER_SHEET_PHASE.SNAPPING`, `INV-SHEET-011`, e2e `player-gestures-contract.spec.js` (dismiss during snap).

---

## Frontend

### PEND-FE-001 — `useDeviceSync.js` всё ещё ~1100 строк

**Priority:** medium
**Status:** частично разгружен в Этапе 1 (-15KB)

После Этапа 1 hook уменьшился, но всё ещё содержит много reconnect/heartbeat/visibility/online логики, которую можно вынести в отдельный модуль `frontend/src/hooks/deviceSyncTransport.js`. Это сделает основной hook читаемым.

**Blocks by:** ~~PEND-DS-001~~ разблокировано 2026-06-11 — `player_state` внедрён. Теперь можно выносить transport/reconnect/visibility логику из `useDeviceSync.js` без изменения public hook contract.

---

## Social

### PEND-SOCIAL-001 — Shared feed cache invalidation before database-service horizontal scale

**Priority:** medium
**Status:** not started

Social feed now uses a short process-local public-page cache in `database-service` plus viewer overlay per request. This reduces repeated DB reads without moving ownership to React. If `database-service` is scaled to multiple replicas or social traffic becomes high, move feed page cache/invalidation to Redis or NATS-backed namespace invalidation so create/delete/reaction updates invalidate all replicas.

**Do not:** cache viewer-specific DTOs in shared cache; expose `author.id`/`handle`; reintroduce full feed reload after every like.

### PEND-SOCIAL-002 — Finish verification and VPS rollout for social privacy/perf pass

**Priority:** high
**Status:** pending verification

The social privacy/perf pass code is prepared locally, but the full verification ladder is not closed yet. Completed so far: `node --check` for `backend/database-service/routes/social.js`, `backend/database-service/lib/socialPosts.js`, `frontend/src/components/SocialPage.js`, `frontend/src/api/client.js`.

**Still required before claiming done:**
- Run backend unit: `npm.cmd --prefix backend/database-service run test:social` on Windows, or `npm --prefix backend/database-service run test:social` in shell where npm scripts are allowed.
- Run frontend unit: PowerShell form `$env:CI='true'; npm.cmd --prefix frontend test -- --watchAll=false --runInBand --runTestsByPath src/components/SocialPage.test.js`.
- Run frontend build: `npm.cmd --prefix frontend run build`.
- Run project gate: `npm.cmd run validate:ai`.
- Browser smoke `/social`: verify compact card alignment, no `author.id`/`author.handle`/`updatedAt` in feed response, `...` menu only on own posts, like/unlike applies `reaction` without full feed reload.
- VPS rollout must apply `backend/database-service/database/migrations/005_social_feed_likes_count.sql` after `004_social_feed.sql`, then rebuild `database-service`, `api-gateway`, `frontend`.

**Why pending:** initial npm test commands were invoked through PowerShell as `npm`/`CI=true npm`; Windows blocked `npm.ps1` by execution policy and rejected POSIX env syntax. This is an execution-command issue, not a test result.

---

## Backend

### PEND-BE-002 — ~~recommendations-service unhealthy (circuit breaker OPEN) с 2026-07-25~~ — **закрыто 2026-08-13**

**Priority:** high
**Status:** closed (fix `972bb03+exploration` deployed)

**Корень (найден 2026-08-13):** НЕ рассинхрон образа — реальный **SQL-баг**. В `services/engineV2/retrieval/exploration.js` (`loadBroadDiscoveryCandidates`) алиас `jitter`, вычислен**ный в том же SELECT** (`(...) % 1000000::float / 1000000.0 AS jitter`), использовался **внутри выражения** ORDER BY: `ORDER BY LN(...) * 0.25 + jitter * 0.75`. PostgreSQL запрещает ссылаться на алиас SELECT внутри выражения ORDER BY (только голым идентификатором), поэтому `jitter` резолвился как колонка таблицы → `column "jitter" does not exist` (42703). Из-за этого circuit breaker открылся (5+ ошибок) и не восстанавливался: `checkDb()` идёт в обход breaker (`pool.query('SELECT NOW()')`), а затрагиваемый запрос всегда падал — HАLF_OPEN-попытка каждый раз тоже падала.

**Фикс:** выражение `jitter` заинлайнено в ORDER BY (валидно: `+ (abs(hashtextextended((s.id::text || ...), $2::bigint)) % 1000000)::float / 1000000.0 * 0.75`). Проверено на проде: `SELECT` строго из этого кода — `OK rows=10 ms=60`. `context.js` (`ORDER BY pop * (...)`) НЕ трогается — там `pop` приходит из CTE-колонки, не алиаса того же SELECT.

**Что сделано:** пересобран образ `recommendations-service` на VPS → health `200 healthy` (breaker CLOSED).

---

## Backend

### PEND-BE-001 — Service contracts документация per-service

**Priority:** medium
**Status:** partial (есть `reports/SERVICE_MAP.md` но он high-level)

Не у всех 20+ сервисов есть `CONTEXT.md` карточка (см. `docs/SERVICE_CONTEXT_TEMPLATE.md`). Создавать по мере касания сервиса в задачах.

**Текущее покрытие:**
- `backend/device-sync-service/CONTEXT.md` — есть (создан в Этапе 1).
- Остальные — TBD.

---

## Operations

### PEND-OPS-001 — Sticky sessions для WS при scale

**Priority:** low
**Status:** monitor

После Этапа 1 WS открывается всегда → базовая нагрузка WS на gateway ×2. Если активные онлайн >5k, нужны sticky session affinity (sticky cookie на `device-sync-service` instance).

**Частично снято 2026-08-09** — shared epoch cache в auth-redis (DECISIONS 2026-08-09) уже сделал verify path совместимым со всеми репликами без sticky. НЕ снято для недостающего распределения pub/sub channels (каждая реплика хранит собственные соединения → `user:{uid}` фреймы должны достичь у неё ALL подписанные devices — это делается через Redis Pub/Sub `dsync:user:{uid}`, более эффективна ат scale при sticky). Sticky остаётся рекомендацией для >5k сокетов, но не блокирует correctness.

---

## Security (PoP → production-grade) — см. `docs/SECURITY_ROADMAP.md`, `docs/AUTH_TARGET_ARCHITECTURE.md`

### PEND-SEC-000 — Auth invariants + CI prod-bypass guard

**Priority:** critical  
**Status:** done (2026-06-04)  

**Delivered:** `validate-auth-prod-guard.js` (docker-compose, Dockerfiles, k8s, CI workflows); wired in `validate:ai` + CI; `INV-SEC-011`/`INV-SEC-012`; route PoP audit (`route_pop_audit_test.go`); spoofed header contract tests (`spoofed_headers_contract_test.go`); ECDSA DER+P1363 contract tests; duplicate `auth_sessions` route id fixed in `gateway.yaml`.

### PEND-SEC-001a — Live gateway PoP harness e2e (без mock route)

**Priority:** critical  
**Status:** done (2026-06-04)  

`pop-e2e-harness` (miniredis + real middleware, `isProduction=true`) + `npm run test:e2e:pop-live`. Не production path — seed endpoint, не login flow.

### PEND-SEC-001 — Full-stack PoP e2e без mock (docker compose stack)

**Priority:** critical  
**Status:** done (2026-06-05, VPS `ru-vmv2-mini`)  

**Validated:** `bash scripts/run-auth-fullstack-e2e.sh` — bootstrap OK, Playwright `device-proof-fullstack.spec.js` **1 passed** (login → device register → profile 200; cookie transplant 401 `DEVICE_PROOF_REQUIRED`; refresh 401).

**Ops notes:** e2e overlay requires `COOKIE_DOMAIN=host` (not empty) when `NODE_ENV=production` — empty defaults to `.earflow.ru` in `config.go`. Artifacts: `artifacts/auth-e2e/`, `frontend/e2e/artifacts/auth-fullstack/`. **After `force-recreate api-gateway`:** recreate `auth-e2e-edge` too — static nginx `proxy_pass` cached stale gateway IPs → **502** on `/api/*` until edge reload (`nginx/auth-e2e-edge.conf` uses Docker DNS `127.0.0.11` since `250e256`).

Real stack: gateway + Redis + security-service + auth login + frontend + `auth-e2e-edge`. **No** seed-session, **no** `/e2e/fixture`, **no** mock.

### PEND-SEC-011 — Postgres SoT (sessions/devices/refresh/events)

**Priority:** critical  
**Status:** done (2026-06-07, VPS `ru-vmv2-mini`)

**Prod evidence:** migration 003 ✓; backfill 82 sessions ✓; `AUTH_PG_SOT_MODE=dual_write` ✓; automated verify ✓; revoke-others PC ↔ phone ✓; SQL UpsertSession paren fix (`ae79b2e`); revoke enumerates Redis+PG (`8f2a366`); MFA lookup NULL salt fix (`353bf4b`).

**Rollback:** `AUTH_PG_SOT_MODE=off` + recreate gateway/security.

### PEND-SEC-012 — Epoch revoke + Redis pub/sub

**Priority:** critical  
**Status:** done (2026-06-07, VPS `ru-vmv2-mini`)

**Done:** `RevokeEvent` on channel `earflow:auth:session:revoke:v1`; security-service publishes after successful Redis revoke; api-gateway subscriber + local tombstone; idempotent duplicate events; tests (miniredis); `scripts/verify-auth-epoch-revoke.sh`. Manual DoD: revoke A→B 401 ≤2s confirmed.

### PEND-SEC-013 — Proof Access Token (hot path)

**Priority:** high  
**Status:** **closed (2026-06-08)** — browser DoD 8/8 PASS + capacity gate PASS (`PEND-SEC-CAPACITY-001`)

**Implemented (do not re-do):**
- `POST /api/auth/proof/token` — full ECDSA exchange → HS256 JWT ~90s (`type=proof_access`, `sid`, `authDeviceId`, `sessionEpoch`, `deviceEpoch`)
- Hot-path gateway middleware: `X-Auth-Proof-Access-Token` → local JWT verify + epoch cache; **no Redis SETNX**
- Sensitive paths: logout / refresh / proof/token / device/register / sessions / password / security / 2fa / telegram/unlink → **full ECDSA + SETNX only**
- PG epoch lookup: `POST /internal/auth/v1/epochs/lookup` (prod 200 ✓)
- Epoch cache bump on revoke pub/sub (SEC-012)
- Frontend: `proofAccessToken.js` exchange + in-memory cache; nginx CORS header
- `scripts/verify-auth-proof-token.sh` — automated PASS on VPS

**Prod evidence (automated):** `493ba5a` + `5010df1`; `epochs/lookup` → 200; verify script PASS.  
**Browser DoD (e2e):** Playwright `device-proof-access-token-dod.spec.js` **PASS 8/8** on `ru-vmv2-mini` (2026-06-08, ~36s).

**Automated (infra):** `bash scripts/verify-auth-proof-token.sh`  
**Automated (browser DoD):** `bash scripts/run-auth-proof-token-browser-dod.sh` — **required to close SEC-013**

**Browser DoD (required before closed):**

| Check | Expected |
|-------|----------|
| After login | `POST /api/auth/proof/token` → 200, `expiresIn ≈ 90` |
| Hot GET e.g. `/api/profile` | `X-Auth-Proof-Access-Token` + `X-Auth-Device-Id` |
| Hot GET | **no** `X-Auth-Device-Proof*` headers |
| Sensitive (logout/refresh/revoke/sessions) | full `X-Auth-Device-Proof*`; token-only → 401 |
| Token TTL expiry | new exchange after ~90s |
| Invalid/stale token | 401; **no** infinite retry loop |
| Revoke cross-device | device B holds live token → A revokes B → B hot GET 401 ≤2s |

**Scale claims:** capacity validated on `ru-vmv2-mini` auth-e2e profile only — see `PEND-SEC-CAPACITY-001` / `reports/auth-capacity-20260608.md`. Do **not** write «готово для миллионов» / «Redis не bottleneck навсегда» / «production scale proven».

**Known risks (accepted for hot-path optimization, not closed):** token replay within TTL (~90s) if XSS/extension steals header; WS/stream still cookie-only (`PEND-SEC-005`); artist-frontend has no proof token cache.

**Commits:** `493ba5a`, `5010df1`, `c5c501d` (double-nonce fix), `ac37504` (DoD e2e fixes), capacity tooling `d726935`–`250e256`.

### PEND-SEC-CAPACITY-001 — Auth hot-path capacity report

**Priority:** high  
**Status:** done (2026-06-08, VPS `ru-vmv2-mini`, git `250e256`)

**Profile:** auth-e2e `http://127.0.0.1:18080`, 2× api-gateway, 20 sessions, hot target 500 RPS.

**Results:** hot GET `/api/profile` p95 **6.18 ms**, error rate **0.000%**; proof/token p95 **40.8 ms**; refresh p95 **34.3 ms**; revoke → 401 first observed **25 ms**.

**Report:** `reports/auth-capacity-20260608.md`; runner `scripts/run-auth-capacity.sh`; verify `scripts/verify-auth-capacity.sh`.

**Not claimed:** millions-ready / prod soak / horizontal multi-generator load — separate gate if needed.

### PEND-SEC-002 — Sessions/devices control (revoke-all + UI)

**Priority:** high  
**Status:** **closed (2026-06-10)** — `GET /api/auth/devices` + listener `AuthDevicesSection`

DoD: см. roadmap §2.

### PEND-SEC-003 — Fresh-login protection

**Priority:** high  
**Status:** **implemented (2026-06-09)** — VPS/browser e2e gate pending  

Mass revoke с сессии <24h без step-up → `FRESH_LOGIN_REQUIRED` (security-service). Step-up via `POST /api/auth/2fa/step-up` unblocks.

### PEND-SEC-004 — MFA step-up modal (UI)

**Priority:** high  
**Status:** **closed (2026-06-10)** — listener: sessions, password, telegram unlink + `StepUpModal`; no backend API for email change / account delete (out of Wave B scope)

Revoke/password/email/delete — modal при `MFA_STEP_UP_REQUIRED`, не raw error strip.

**Observed prod (2026-06):** `POST /api/auth/sessions/revoke-others` → **403** без step-up UI выглядит как поломка. **Must:** parse response body `code`; if `MFA_STEP_UP_REQUIRED` → step-up flow (reuse existing MFA verify endpoint), then retry revoke. Distinguish from `CSRF_*` / `DEVICE_PROOF_*` (client/nginx bug).

### PEND-SEC-014 — CORS/PoP nginx preflight matrix

**Priority:** critical  
**Status:** **closed (2026-06-08)** — superseded by SEC-013 browser DoD + deploy script (not open debt)

**Why it looked open:** status «not prod-green» conflicted with SEC-013 closed + capacity closed.

**Evidence for closure:**
- SEC-013 browser DoD 8/8 PASS on auth-e2e (`device-proof-access-token-dod.spec.js`, 2026-06-08) — cross-origin calls to proof/token, refresh, profile, revoke **require** working CORS on those routes; DoD would fail otherwise.
- `scripts/verify-cors-pop-preflight.sh` (`npm run verify:cors-pop`) remains **mandatory pre-deploy gate** — see `docs/AUTH_ROLLOUT_GATES.md`, `scripts/verify-prod-auth-gate.sh`. Not tracked as open PEND.

**Residual (non-blocker):** CI job for cors-pop optional; artist-portal/strmhaha hardcoded CORS audit when those surfaces gain PoP.

### PEND-SEC-016 — PoP canonicalization matrix (client ↔ gateway contract)

**Priority:** critical  
**Status:** **closed (2026-06-08)** — superseded by SEC-013 browser DoD + unit contract tests (not open debt)

**Evidence for closure:**
- FE/Go sync tests in repo: `authDeviceCrypto.test.js`, `device_proof_canonical_test.go` — profile, `Charli%20XCX`, `A%24AP%20Rocky`, unicode, query params.
- SEC-013 browser DoD check #2–3 validates hot `/api/profile` with proof access token in real browser.
- Recovery: `deviceProofRecovery.test.js` + `middlewareStackOrder.test.js` (max 1 retry).

**Residual (non-blocker, not open PEND):** full artist `%20/%24` browser matrix — manual section in `scripts/verify-prod-auth-gate.sh`; run on prod deploy. Dedicated `_resolveDeviceProofHeaders` unit test — optional follow-up.

### PEND-SEC-015 — Refresh + client PoP contract

**Priority:** critical  
**Status:** **closed (2026-06-08)** — SEC-013 browser DoD check #4

**Evidence:**
- Playwright DoD: `POST /api/auth/refresh` with full ECDSA → **204**; proof-access-token-only → **401** (`device-proof-access-token-dod.spec.js`).
- Gateway unit: `device_proof_test.go` — refresh without proof → 401 `DEVICE_PROOF_REQUIRED`.

**Residual (non-blocker):** dedicated unit test on `_resolveDeviceProofHeaders` — optional follow-up, not deploy blocker.

### PEND-SEC-005 — WS/HLS scoped tickets (device-bound stream auth)

**Priority:** critical  
**Status:** **Phase 7 prod ENFORCE closed (2026-06-10 VPS)** — stream bytes require scoped ticket; legacy cookie → 401

**Goal:** bind WS upgrade and playback bytes to epoch-aware scoped tickets; remove cookie-only sufficient auth on consume paths.

**Design:** `docs/SEC-005_WS_STREAM_TICKETS_DESIGN.md` — accepted in `DECISIONS.md` 2026-06-08.

**Implementation phases (gated):**

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Gateway `POST /api/auth/stream-ticket` mint + unit tests; `STREAM_TICKET_ENABLED=0` default | done |
| 2 | OBSERVE — mint on auth-e2e overlay; `verify-stream-ticket.sh`; structured mint logs | **done (2026-06-09 restore prod PASS)** |
| 3 | ACCEPT — direct-stream/ebap-hls dual-mode verify | **done (2026-06-09 VPS `f9da305`)** |
| 4 | Frontend mint + attach (`streamTicket.js`, opt-in flag) | **closed (2026-06-09 VPS `727be49`)** — `npm run run:sec005-phase4-staging` PASS |
| 5 | Staging ENFORCE | **closed (2026-06-09 VPS)** — `npm run run:sec005-phase5-staging` PASS |
| 6 | Prod ACCEPT (dual-mode) | **closed (2026-06-10 VPS)** — `verify:stream-ticket-phase6-prod` PASS |
| 7 | Prod ENFORCE | **closed (2026-06-10 VPS)** — `verify:stream-ticket-phase7-prod` PASS |
| 8 | WS connect tickets | **implemented (2026-06-10)** — device-sync ACCEPT + frontend mint; gate `npm run verify:stream-ticket-ws-accept` |

**VPS close report — Phase 3 ACCEPT (`ru-vmv2-mini`, 2026-06-09, git `f9da305`):**

```text
verify:stream-ticket-accept:        PASS (ticket 200, garbage 401, legacy cookie 200)
restore-prod-after-auth-e2e.sh:     exit 0
STREAM_TICKET_ACCEPT (prod):        empty (direct-stream + ebap-hls)
STREAM_TICKET_ENABLED/OBSERVE:      empty (prod norm)
verify:frontend-api-base:           PASS
verify:stream-ticket prod gate:     PASS (POST mint → 404)
EARFLOW_API_BASE_URL:               empty
COOKIE_DOMAIN:                      .earflow.ru
```

**Prior VPS close — Phase 2 OBSERVE (`0d59f54`):** restore + prod mint 404 + frontend API base guard PASS.

**After any auth-e2e / capacity run** (when **not** in Phase 6 soak):

```bash
bash scripts/restore-prod-after-auth-e2e.sh
```

**During Phase 6 soak:** use `npm run verify:sec005-prod-health` — **do not** run `restore-prod` (split-brain: frontend mint:1 + gateway mint off → 404).

**VPS close report — Phase 6 prod ACCEPT (`ru-vmv2-mini`, 2026-06-10, git `1852924`):**

```text
verify:stream-ticket-phase6-prod:   PASS
STREAM_TICKET_ENABLED (prod):       1 (api-gateway)
STREAM_TICKET_ACCEPT (prod):        1 (direct-stream + ebap-hls)
STREAM_TICKET_ENFORCE (prod):       0
bundle main.f34684ea.js:            earflow:stream-ticket-mint:1
accept-consume prod:                ticket 200, garbage 401, legacy cookie 200
verify:frontend-api-base:           PASS
```

**VPS close report — Phase 7 prod ENFORCE (`ru-vmv2-mini`, 2026-06-10):**

```text
run:sec005-phase7-prod-enforce:     PASS
verify:sec005-prod-health (phase7): PASS
enforce-consume prod:               ticket 200, legacy cookie 401 STREAM_TICKET_REQUIRED
bundle main.4a14585e.js:            mint:1
direct-stream + ebap-hls ENFORCE:   1
override symlink:                   docker-compose.stream-prod-enforce.yml
```

**Next:** VPS `git pull` + `npm run run:auth-wave-b-prod-deploy`. WS ENFORCE (legacy JWT off) — future gate. Level 3: SEC-006–009.

**Rollback Phase 7 → Phase 6:** `SEC005_PHASE7_ROLLBACK_CONFIRM=1 npm run rollback:sec005-phase7-prod`  
**Weekly health:** `npm run verify:sec005-prod-health` (expect `mode: phase7`)

**v1 scope:** listener web SPA only.

### PEND-SEC-006 — WebAuthn/passkey step-up

**Priority:** medium  
**Status:** not started  

Отдельно от PoP. DoD: roadmap §6.

### PEND-SEC-007 — New-session confirmation (deferred — no email/in-app alerts v1)

**Priority:** medium  
**Status:** deferred (2026-06-09) — **not** email/in-app alerts in current wave  

**Target:** новый sid → подтверждение через **Telegram-бота** (пользователь должен иметь привязанный TG + активировать бота). Без подтверждения — ограниченная сессия или step-up на sensitive. Ops bot (`TELEGRAM_OPS_*`) — отдельно от user-facing confirm flow.

**Not in scope now:** Wave A/B/C transport + sessions; SEC-007 после SEC-005 ENFORCE + SEC-004 password step-up.

### PEND-SEC-008 — Risk engine

**Priority:** medium  
**Status:** not started  

Scoring без auto-logout на VPN/mobile network.

### PEND-SEC-009 — XSS hardening (CSP, Trusted Types)

**Priority:** medium  
**Status:** not started  

### PEND-SEC-010 — Security audit log + metrics

**Priority:** medium  
**Status:** not started  

---

## Шаблон для новой записи

```
### PEND-<AREA>-<NUM> — Краткое описание

**Priority:** high | medium | low
**Status:** not started | in progress | ready, не сделано | blocked

Контекст в 1-3 предложения. Что нужно. Чем заблокировано (если есть).
```
