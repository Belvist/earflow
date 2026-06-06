# Earflow — Security Roadmap (финальная цель)

**Status:** accepted (2026-06-04)  
**Связано:** `INV-SEC-010`, `docs/DECISIONS.md` (PoP + RevokeSessionFull), `reports/SECURITY.md`, **`docs/AUTH_TARGET_ARCHITECTURE.md`** (Telegram-principles, web+native, scale, agent phases A–M)

PoP-модель **не переделываем**. Задача — довести вокруг неё эксплуатационный security-контур до уровня крупных consumer-сервисов (Telegram / Apple-grade operational security).

---

## Финальная цель (одной фразой)

> Пользователь может **долго и стабильно** быть залогинен на нескольких устройствах, но **украденные cookies не дают вход**, **подозрительное новое устройство не может выкинуть владельца**, а **критичные действия требуют step-up подтверждения**.

---

## Принято (не трогаем без причины)

| Блок | Статус |
|------|--------|
| Phase 0 `RevokeSessionFull` | ✅ Закрыта |
| Phase 1 PoP (MVP) | ✅ Закрыта |
| Cookie transplant в prod → `401 DEVICE_PROOF_REQUIRED` | ✅ По contract (при enforced PoP, без bypass env) |
| Active sessions UI (Phase 2 partial) | ✅ Сделано |
| `POST /api/auth/sessions/revoke` | ✅ |
| `POST /api/auth/sessions/revoke-others` | ✅ |
| Multi-device (параллельные sid + authDeviceId) | ✅ |

**Терминология UI:** «**Это устройство**» = текущая сессия (`current: true`). **Не** «главное устройство» — permanent primary device в Redis нет.

**Session vs AuthDevice:**

| | Session (`sid`) | AuthDevice (`authDeviceId`) |
|--|-----------------|----------------------------|
| Что | login-сессия / cookie | PoP-ключ браузера |
| UI сейчас | `/api/auth/sessions` | Только через register + middleware |
| Revoke | `RevokeSessionFull(sid)` | Сносится вместе с sid |

Любой revoke **обязан** идти через `RevokeSessionFull` (`mp:sess`, `auth:*`, refresh, device bindings, индексы).

---

## Приоритет работ (строго по порядку)

> **Жёсткое правило:** Proof Access Token — **только после** Postgres SoT + epoch revoke (п. 3–4). См. `docs/AUTH_TARGET_ARCHITECTURE.md` §7.

1. Auth invariants + CI prod-bypass guard — **PEND-SEC-000** ✅ (2026-06-04)  
2. Full-stack e2e без mock — **PEND-SEC-001** ✅ (2026-06-05 VPS; **001a** harness ✅)  
3. Postgres SoT (`auth_sessions`, `auth_devices`, `refresh_tokens`, `security_events`)  
4. Epoch revoke + Redis pub/sub invalidation (`sessionEpoch` / `deviceEpoch`)  
5. Proof Access Token (hot path, no Redis SETNX per GET) — **blocked until 3–4**  
6. WS/stream proof/ticket  
7. Fresh-login protection (<24h mass revoke)  
8. MFA step-up modal  
9. WebAuthn/passkey  
10. Login alerts · risk engine · CSP/XSS · audit log · k6 load  

---

## 1. Full-stack e2e без mock — **PEND-SEC-001** ✅ (2026-06-05)

### 1a. Live gateway PoP harness — **PEND-SEC-001a** ✅ (2026-06-04)

**Реализация:** `pop-e2e-harness` (`//go:build pop_e2e_harness`, отдельный binary) + miniredis + реальный auth middleware + `npm run test:e2e:pop-live`.

**Это gateway-level integration e2e**, не full-stack production path.

**Покрыто:**

1. Context A: seed → device register → IndexedDB → `/api/profile` **200**  
2. Context B: cookies only → **401** `DEVICE_PROOF_REQUIRED`  
3. Context A после B → **200**  
4. Refresh без proof → **401**  
5. `/e2e/*` **не** в prod gateway binary (build tag + CI guard tests)

### 1b. Full-stack production path — **validated 2026-06-05**

**Status:** closed on VPS `ru-vmv2-mini` (`run-auth-fullstack-e2e.sh` PASS).

Runbook: **`docs/AUTH_FULLSTACK_E2E_RUNBOOK.md`**

**Gate learned:** overlay `COOKIE_DOMAIN=host` (empty + production → `.earflow.ru` cookies invisible on `127.0.0.1`).

**Acceptance met:** real login cookies → device register → profile 200; cookie-only context 401 `DEVICE_PROOF_REQUIRED`; refresh 401.

---

## 2. Security Sessions / Devices control — **PEND-SEC-002**

### Sessions (минимум, частично сделано)

| Method | Path | Статус |
|--------|------|--------|
| GET | `/api/auth/sessions` | ✅ |
| POST | `/api/auth/sessions/revoke` | ✅ |
| POST | `/api/auth/sessions/revoke-others` | ✅ |
| POST | `/api/auth/sessions/revoke-all` | ❌ |

### Auth-device layer (опционально, после sessions)

| Method | Path | Статус |
|--------|------|--------|
| GET | `/api/auth/devices` | ❌ |
| POST | `/api/auth/devices/{authDeviceId}/revoke` | ❌ |
| POST | `/api/auth/devices/revoke-others` | ❌ |
| POST | `/api/auth/devices/revoke-all` | ❌ |

### UI (довести)

- «Это устройство»  
- Список активных сеансов  
- Браузер/ОС, дата входа, последняя активность, IP/локация  
- Завершить сеанс / все другие / **все** (включая текущую)

---

## 3. Fresh-login protection — **PEND-SEC-003**

Новое устройство **не** может сразу `revoke all` / `revoke others` без подтверждения.

**Правило (пример):** сессия моложе 24h → mass revoke требует step-up или запрещён.

**API codes:** `FRESH_LOGIN_REQUIRED` и/или `MFA_STEP_UP_REQUIRED`.

**DoD:** новое устройство пользуется аккаунтом, но не выкидывает старые без cooldown/step-up.

---

## 4. MFA step-up modal — **PEND-SEC-004**

При `MFA_STEP_UP_REQUIRED` UI **не** показывает только ошибку.

**Flow:** действие → API step-up required → modal TOTP/код → retry → success.

**Минимум для:** revoke all, revoke others, смена пароля/email, удаление аккаунта, выплаты, artist/admin write.

---

## 5. WebSocket и stream — **PEND-SEC-005**

Отдельные поверхности **не** cookie-only.

**WebSocket:**

- `/ws/*` не авторизуется только cookie  
- Short-lived ticket через POST **с proof**, или proof в первом frame  
- Ticket одноразовый/короткоживущий  

**Stream:**

- `/api/stream/*` с proof headers **или** scoped stream token  
- Без `mp_sid` + proof — нет приватного доступа  

**DoD:** WS/stream cookie-only не работают; contract/e2e подтверждают.

---

## 6. WebAuthn / Passkey step-up — **PEND-SEC-006**

PoP ≠ Apple-level. Passkey — **отдельный** слой для sensitive actions (не ослабляет PoP).

**Минимум:** register/remove passkey, challenge, verify, step-up token после verify.

**Sensitive:** email, password, delete account, payouts, revoke all, admin/artist write.

---

## 7. Login alerts — **PEND-SEC-007**

Событие «новый вход» → email + in-app (+ позже Telegram/push).

**Содержимое:** браузер/ОС, IP/локация, время, «Это не я», «Завершить сеанс».

**DoD:** новый sid/authDeviceId → событие в Security log → быстрый revoke.

---

## 8. Risk engine — **PEND-SEC-008**

**Без** тупого auto-logout при смене IP/VPN.

**Сигналы:** новая страна/ASN, impossible travel, новый UA, proof invalid/replay, refresh reuse, login brute.

**Реакции:** log → notify → step-up → revoke session (по severity).

---

## 9. XSS hardening — **PEND-SEC-009**

PoP не спасает от XSS на том же origin.

**Нужно:** strict CSP, убрать `unsafe-inline`, Trusted Types, audit `dangerouslySetInnerHTML`, sanitizer, dependency audit, SRI, security headers.

**DoD:** CSP report-only → enforce; нет непроверенного HTML; линты/тесты.

---

## 10. Observability / audit log — **PEND-SEC-010**

**События:** login fail/success, device register, proof required/invalid/replay, session revoke, password/email change, step-up, WebAuthn, risk events.

**Метрики (пример):** `device_proof_required_total`, `device_proof_invalid_total`, `device_proof_replay_total`, `session_revoke_total`, `fresh_login_block_total`, `mfa_stepup_required_total`, `webauthn_success_total`, `webauthn_fail_total`.

**DoD:** расследование угона сессии и атак по proof/replay из логов и метрик.

---

## Финальный критерий «готово как у крупных»

Все пункты выполнены:

1. Cookie transplant на **живом** стеке не работает  
2. Пользователь видит все активные сессии  
3. Revoke one / others / all  
4. Fresh-login protection на mass revoke  
5. Критичные действия → MFA/WebAuthn step-up  
6. WS/stream без cookie-only bypass  
7. Login alerts  
8. Risk engine  
9. CSP/Trusted Types/XSS  
10. Audit log + метрики  
11. Multi-device стабилен (не вылетает без причины)  
12. Revoke только через `RevokeSessionFull`  
13. Prod без cookie-only fallback  

---

## Архитектура (reference, не менять)

```
Login → mp_sid + mp_csrf
     → IndexedDB private key
     → POST /api/auth/device/register (authDeviceId + publicKey)
     → Redis: auth:device + sid binding

API request:
  mp_sid + X-Auth-Device-* + nonce
  → SessionAuth → DeviceProof → handler

Cookie-only (нет key):
  → 401 DEVICE_PROOF_REQUIRED

Multi-device:
  userId → sid A + device A
         → sid B + device B
         → sid C + device C  (не evict друг друга)

Revoke session:
  POST /api/auth/sessions/revoke
  → RevokeSessionFull(sid)
```
