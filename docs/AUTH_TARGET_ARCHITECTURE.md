# Earflow — целевая архитектура авторизации (Telegram-principles, web + native, scale-ready)

**Status:** accepted (2026-06-04)  
**Audience:** AI-агенты, backend/frontend/security инженеры  
**Связано:** `docs/SECURITY_ROADMAP.md`, `INV-SEC-010`, `docs/DECISIONS.md`

**Честно:** Telegram **нельзя скопировать 1:1**. У Telegram свой протокол MTProto (не HTTP+cookies). Мы перенимаем **принципы**, не бинарный протокол.

---

## 1. Как Telegram устроен (публичная документация, не «инсайды»)

Источники: [MTProto description](https://core.telegram.org/mtproto/description), [User Authorization API](https://core.telegram.org/api/auth), [account.getAuthorizations](https://core.telegram.org/method/account.getAuthorizations), [account.resetAuthorization](https://core.telegram.org/method/account.resetAuthorization), [auth.resetAuthorizations](https://core.telegram.org/method/auth.resetAuthorizations), [QR login](https://core.telegram.org/api/qr-login), [Passkeys blog Dec 2025](https://telegram.org/blog/passkeys-and-gift-offers).

| Принцип | Что это значит простыми словами |
|---------|----------------------------------|
| **Не «cookie = аккаунт»** | У клиента есть криптографический **authorization key** (DH на устройстве). Запрос без правильного ключа/сессии протокола — не «просто ответ с данными». |
| **Несколько устройств** | Один user — несколько авторизаций (ключей/сессий). Они живут параллельно. |
| **Список сессий** | `account.getAuthorizations`: device, platform, IP, country, created, last active, `current`. |
| **Revoke одной** | `account.resetAuthorization` по hash сессии. |
| **Revoke всех других** | `auth.resetAuthorizations` — все кроме текущей. |
| **Fresh session lockout** | `FRESH_RESET_AUTHORISATION_FORBIDDEN` (406): сессия **моложе ~24 часов** не может выкинуть другие. |
| **Подтверждение нового входа** | `updateNewAuthorization` на других устройствах; confirm/deny через API. |
| **2FA** | `SESSION_PASSWORD_NEEDED` → SRP password flow. |
| **Passkeys (с ~Dec 2025)** | Вход/step-up через passkey + PIN/биометрия (отдельно от MTProto key). |
| **QR-login** | Короткоживущий token (~30s); **доверенная** сессия принимает через `auth.acceptLoginToken`. |
| **Replay на уровне протокола** | msg_id, session id, server salt — не Redis SETNX на каждый HTTP. |

**Почему «скрипт с украденными данными» у Telegram не равен входу:** нужен живой auth key / корректное состояние MTProto-сессии, не только строка из DevTools.

---

## 2. Earflow сегодня — факт по репозиторию (Go gateway)

### Есть

| Что | Где / как |
|-----|-----------|
| Gateway — единая точка | `go-api-gateway`, `SessionAuthMiddleware` → `DeviceProofMiddleware` |
| Cookies | `mp_sid`, `mp_csrf` (httpOnly), JWT **не** в localStorage |
| Сессия в Redis | `mp:sess:{sid}` |
| PoP (device-bound) | `POST /api/auth/device/register`, `X-Auth-Device-*`, ECDSA P-256, IndexedDB key |
| Nonce anti-replay | Redis `auth:pop_nonce:{authDeviceId}:{nonce}`, TTL 120s, SETNX **на каждый proof-запрос** |
| Unified revoke | `RevokeSessionFull` — mp:sess, auth:*, device bindings |
| Multi-device login | Новый login **не** evict старые sid |
| Go-тесты | cookie-only → 401, refresh без proof, replay, revoked device |
| Sessions UI (partial) | Profile → Настройки → Сессии |
| Sessions API | GET list, POST revoke one, POST revoke-others |
| security-service | Декорация сессий (UA, IP mask, labels) |

### Нет (факт)

| Что | Статус |
|-----|--------|
| E2e на **живом** gateway (без mock) | ❌ |
| `POST /api/auth/sessions/revoke-all` | ❌ |
| `GET /api/auth/devices` + revoke по authDeviceId | ❌ |
| Fresh-login 24h lockout (`FRESH_LOGIN_*`) | ❌ |
| Login confirmation на старых устройствах | ❌ |
| MFA step-up **modal** (не raw error) | ❌ |
| WebAuthn/passkey | ❌ |
| QR login через доверенную сессию | ❌ |
| WS/stream PoP — **доказано** e2e | ❌ (device-sync ws-ticket есть, контракт PoP+cookie-only не закрыт) |
| Login alerts (email/in-app) | ❌ |
| Risk engine | ❌ |
| Security audit log + метрики prod-ready | ❌ |
| Postgres как source of truth для sessions/devices | ❌ (сейчас Redis-first) |
| Proof Access Token (масштабируемый hot path) | ❌ |
| Native iOS/Android auth SDK (общий контракт) | ❌ |

### Главный архитектурный риск под нагрузкой (честно)

**Сейчас:** каждый authenticated API-запрос с PoP → ECDSA verify + **Redis SETNX nonce**.

При большом RPS это:

- write-load на Redis;
- рост ключей `auth:pop_nonce:*` (TTL 120s);
- latency на hot path.

**Для MVP / тысяч пользователей — ок.**  
**Для миллионов одновременных запросов — нужна **Фаза E (Proof Access Token)**, но **только после** Postgres SoT (Фаза C) и epoch revoke (Фаза D). Иначе token будет ссылаться на `sessionEpoch`/`deviceEpoch`, которых ещё нет в durable-модели.

PoP-модель **не выбрасываем** — меняем **что проверяем на каждом запросе**.

---

## 3. Сравнение: Telegram-principle → Earflow

| Telegram-like | Earflow сейчас | Earflow цель |
|---------------|----------------|--------------|
| Device-bound auth | PoP authDeviceId ✅ | + native Keychain/Keystore |
| Cookie transplant бесполезен | PoP в prod ✅ (unit) | + live e2e ✅ |
| Active sessions list | Partial UI ✅ | + revoke-all, alerts |
| Revoke one / others | ✅ | + revoke-all |
| Fresh session cannot mass-revoke | ❌ | ✅ 24h rule |
| New login notify others | ❌ | ✅ |
| Passkeys | ❌ | ✅ |
| Step-up on sensitive | API partial, UI ❌ | ✅ modal + token |
| QR via trusted session | ❌ | optional later |
| Protocol-level replay | MTProto | Redis nonce → **proof token** on hot path |
| Script ≠ full access | PoP blocks cookie-only | + CSRF + rate limit + no sensitive without step-up |

---

## 4. Целевая модель Earflow (web + native, один Auth Core)

```text
                    ┌─────────────────────────────────┐
                    │         Auth Core (Go)          │
                    │  login · refresh · revoke ·     │
                    │  device register · step-up ·    │
                    │  proof token · audit events     │
                    └───────────────┬─────────────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          ▼                         ▼                         ▼
   Web browser              iOS / Android app           Desktop (future)
   mp_sid + CSRF            refresh + device key          same contract
   IndexedDB PoP key        Secure Enclave / Keystore
   WebAuthn                 passkey / biometrics
          │                         │                         │
          └─────────────────────────┴─────────────────────────┘
                                    │
                                    ▼
                         go-api-gateway (ONLY choke point)
                         verify session + proof/token
                         NO upstream trust of X-User-Id from internet
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
              PostgreSQL                      Redis (cache only)
              sessions, devices,              session cache, rate limits,
              refresh, webauthn,              proof tickets, WS tickets,
              security_events (SoT)           revoke pub/sub, risk counters
```

### Правила масштабирования (обязательны)

1. **Postgres** — истина для sessions/devices/refresh/events. Не SELECT на каждый API-запрос.
2. **Redis** — кэш, rate limits, короткие tickets, revoke fan-out. Не SoT.
3. **Gateway** — локальная проверка short-lived **Proof Access Token** на hot path.
4. **Per-request ECDSA + Redis nonce** — только для: login, device register, refresh, **sensitive actions**.
5. **Revoke** — Postgres `session_epoch`/`device_epoch` bump + Redis pub/sub → все gateway replicas invalidates cache **< 1–2s**.
6. **Upstream services** — доверяют user только от gateway (mTLS / service mesh / internal network).

### Native app (заранее, чтобы не переписывать)

Тот же контракт, другой storage:

| Web | Native |
|-----|--------|
| IndexedDB private key | Keychain / Android Keystore |
| mp_sid httpOnly cookie | refresh token rotation + secure storage |
| CSRF cookie | app attestation optional (later) |
| WebAuthn | platform passkey |
| Proof headers | same canonical string + headers OR proof token |

**Один Auth Core API**, клиенты — thin.

---

## 5. Масштабируемый PoP (Фаза E — **только после** Postgres SoT + epoch revoke)

> **Жёсткое правило:** Proof Access Token **запрещён** до Фазы C (Postgres SoT) и Фазы D (sessionEpoch/deviceEpoch + revoke pub/sub). Token claims (`sessionEpoch`, `deviceEpoch`) должны жить в durable-модели, иначе «оптимизация» упрётся в Redis-first revoke-хаос.

### Сейчас (MVP)

```text
every API → verify ECDSA → Redis SETNX nonce → handler
```

### Цель

```text
login / register device / refresh / sensitive:
  → full ECDSA verify + optional nonce

normal API (95%+ traffic):
  → verify short-lived Proof Access Token (JWT/PASETO, 30–120s)
  → check sid + authDeviceId + sessionEpoch in local/cache
  → NO Redis write per request
```

**Proof Access Token claims (минимум):** `sub`, `sid`, `authDeviceId`, `sessionEpoch`, `deviceEpoch`, `exp`, `scope`, `riskLevel`, `cnf` (key fingerprint).

**Revoke:** epoch++ → все старые tokens мертвы ≤ TTL.

**Sensitive actions** (всегда strict):

- revoke all / others (если не fresh-blocked)
- password / email change
- delete account
- payouts
- artist/admin write

---

## 6. «Скрипт вставил данные — сервер ответил»

Что закрыто **сейчас:**

- Только `mp_sid` + `mp_csrf` без private key → **401** (если PoP enforced).

Что **не** закрыто полностью:

- **XSS на том же origin** — вредный JS может подписывать запросы **из текущего** браузера (PoP не спасает). Нужен CSP / Trusted Types (Фаза L).
- **curl с украденными cookies + украденным key material** — если атакующий вытащил и cookies, и IndexedDB — PoP не поможет. Нужны короткие sessions, alerts, risk.
- **Upstream без gateway** — если сервис принимает `X-User-Id` с интернета — дыра. Policy: только internal gateway.
- **Dev bypass env** — `ALLOW_COOKIE_AUTH_WITHOUT_PROOF=1` — только local, CI блокирует prod.

Telegram-style «не отдаст просто так» = **нет валидного device-bound proof/token + нет step-up на опасное**.

---

## 7. Инструкция AI-агенту — порядок работ (обязателен)

**Не переписывать PoP с нуля.** Довести контур.

### Канонический порядок (2026-06-04, принят)

```text
 1. Auth invariants + CI prod-bypass guard
 2. Live e2e без mock
 3. Postgres SoT (sessions/devices/refresh/security_events)
 4. Epoch revoke + Redis pub/sub invalidation
 5. Proof Access Token (hot path)          ← ТОЛЬКО после 3–4
 6. WS/stream tickets
 7. Fresh-login protection (<24h)
 8. MFA step-up modal
 9. WebAuthn/passkeys
10. Login alerts · risk · audit · XSS · k6 load
```

**Ближайшая задача:** пункты **1 → 2 → 3 → 4**, затем **5**.

---

### Фаза A — Auth invariants + CI

- [ ] `INV-SEC-*` дополнить: no prod bypass, upstream no trust, epoch revoke.
- [ ] CI: fail if prod config has cookie-only bypass flags.
- [ ] Route audit: protected `/api/*` без proof/token → 401.

**DoD:** `npm run validate:ai` + CI gate.

### Фаза B — Full-stack e2e (PEND-SEC-001) — **done (2026-06-05 VPS)**

- [x] Compose overlay: `docker-compose.auth-e2e.yml` + edge nginx (`COOKIE_DOMAIN=host`).
- [x] Playwright spec: `device-proof-fullstack.spec.js` (real login, no seed/mock).
- [x] Runbook: `docs/AUTH_FULLSTACK_E2E_RUNBOOK.md`; CI: `auth-fullstack-e2e.yml` (optional re-run).
- [x] Executed on VPS `ru-vmv2-mini` — `run-auth-fullstack-e2e.sh` PASS.

**DoD:** met — no `popGatewayMock.js`, no `/e2e/*` in prod path.

### Фаза C — Postgres SoT (sessions/devices/events)

- [ ] Таблицы: `auth_sessions`, `auth_devices`, `refresh_tokens`, `security_events` (см. schema в SECURITY_ROADMAP companion).
- [ ] Redis = cache + pub/sub revoke.
- [ ] Миграция: dual-write Redis+PG → read PG cache Redis → Redis optional.

**DoD:** revoke пишет PG first; dual-write migration path documented.

### Фаза D — Epoch revoke + Redis pub/sub

- [ ] Поля `session_epoch`, `device_epoch` в Postgres (`auth_sessions`, `auth_devices`).
- [ ] `RevokeSessionFull` bump epoch в PG + invalidate Redis cache.
- [ ] Redis pub/sub (или NATS): событие revoke → все gateway replicas invalidates local cache **< 1–2s**.
- [ ] Contract test: revoke на replica A → request на replica B fails ≤ TTL proof token.

**DoD:** epoch в PG — source of truth; gateway не полагается только на Redis key delete.

### Фаза E — Proof Access Token (scale) — **BLOCKED until C + D**

- [ ] `POST /api/auth/proof/token` — exchange full proof → short token (claims include epoch from PG).
- [ ] Middleware: hot path token verify (local, **no Redis SETNX** per GET).
- [ ] Sensitive path: full proof + step-up.
- [ ] Benchmark: before/after Redis ops at 1k/10k/50k rps.

**DoD:** capacity report в `reports/`; nonce SETNX не на каждом обычном API-запросе.

### Фаза F — WS / Stream

- [ ] `POST /api/auth/ws-ticket` with proof → one-time ticket.
- [ ] Stream scoped token; contract tests cookie-only fails.

### Фаза G — Sessions + Devices UI/API (дополнить partial)

- [ ] `POST /api/auth/sessions/revoke-all`.
- [ ] Optional: `/api/auth/devices/*`.
- [ ] UI: revoke all, location, risk badge.

**DoD:** все revoke → `RevokeSessionFull`.

### Фаза H — Fresh-login protection (Telegram `FRESH_RESET_*`)

- [ ] Rule: session age < 24h → `revoke-others` / `revoke-all` → `FRESH_LOGIN_REQUIRED` or step-up.
- [ ] Tests + UI message (не generic error).

### Фаза I — MFA step-up modal

- [ ] On `MFA_STEP_UP_REQUIRED`: modal → TOTP → retry action.
- [ ] Short-lived step-up token scoped to action.

### Фаза J — WebAuthn / passkeys

- [ ] register/verify/step-up endpoints.
- [ ] Sensitive actions: TOTP **or** passkey.

### Фаза K — Login alerts

- [ ] `security_events` + email + in-app «новый вход» + «это не я».

### Фаза L — Risk engine

- [ ] Score signals; reactions log → notify → step-up → revoke.
- [ ] **No** auto-logout on IP change alone.

### Фаза M — XSS hardening

- [ ] CSP report-only → enforce; Trusted Types; audit dangerouslySetInnerHTML.

### Фаза N — Capacity / load (k6)

- [ ] k6: gateway replicas, Redis memory, revoke propagation p99.
- [ ] Document: max RPS per replica, when to shard Redis.

---

## 8. Критерий «готово для миллионов» (review checklist)

Агент **не** пишет «готово», пока reviewer не может ответить «да» на все:

1. Live e2e cookie transplant fails?
2. Postgres SoT + Redis cache (not Redis SoT)?
3. Hot path без Redis write per request?
4. Revoke propagates < 2s all gateways?
5. Fresh session cannot mass-revoke?
6. WS/stream cookie-only fails (tests)?
7. Sensitive needs step-up?
8. k6 report for target RPS exists?
9. Native contract documented (same Auth Core)?
10. Prod bypass flags impossible in CI/CD?

---

## 9. Что отправить агенту одной строкой

```text
Читай docs/AUTH_TARGET_ARCHITECTURE.md + docs/SECURITY_ROADMAP.md.
PoP MVP не ломать. Порядок: A(invariants) → B(live e2e) → C(Postgres SoT) → D(epoch revoke) → E(proof token) → F(WS/stream) → …
Proof Access Token ЗАПРЕЩЁН до C+D. Не claim "готово" без checklist §8.
```
