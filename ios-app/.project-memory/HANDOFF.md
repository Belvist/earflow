# iOS Handoff — читать ПЕРВЫМ в новом чате

**Updated:** 2026-06-26  
**Global index:** `docs/AGENT_SESSION_HANDOFF.md`  
**Gate:** `PEND-IOS-005` **OPEN** — playback **prepared in code**, **not closed** without real iPhone smoke

**Playback smoke:** `ios-app/.project-memory/IPHONE_PLAYBACK_SMOKE_INSTRUCTIONS.md`  
**Auth closure checklist:** `ios-app/.project-memory/IOS_AUTH_CLOSURE_CHECKLIST.md`

---

## 0. Текущий этап

| Делать | Не делать |
|--------|-----------|
| Real iPhone **playback** smoke по `IPHONE_PLAYBACK_SMOKE_INSTRUCTIONS.md` | Закрывать `PEND-IOS-005` без device evidence |
| `verify:ios-native` перед device run | Новые UI-фичи до PASS playback gate |
| Обновлять docs при изменении playback/auth | «background audio готово» по unit-тестам |

**Оценка:** до P0-фикса — broken lifecycle на device; после 2026-06-25 P0 + **2026-06-26 background activation fix** (`setActive` в `.background`, не только `.active`) — **prepared, needs device evidence**.

**UX:** guest-first shell; login — sheet.

---

## 1. Модуль

```text
SwiftUI → AuthActor / Services → GatewayClient → https://api.earflow.ru
```

- Keychain: device P-256 key only
- Cookies: `mp_sid`, `mp_csrf` (jar)
- Proof access token: **RAM only**

---

## 2. Auth — реализовано (не путать с «закрыто»)

| Поверхность | API |
|-------------|-----|
| Native form | `POST /api/auth/email/login` |
| Web sheet | `ASWebAuthenticationSession` + PKCE → `completeNativeWebLogin(code:codeVerifier:)` (см. `INV-SEC-018`, PEND-IOS-002) |
| Bootstrap | device + profile + refresh (`degraded` on transient) |
| Profile SoT | `GET /api/profile` |
| Refresh | `POST /api/auth/refresh` |
| MFA | `POST /api/auth/2fa/step-up` |

---

## 3. Что НЕ подтверждено на iPhone

- Login E2E (native / web)
- Profile после login
- Restart → bootstrap / revalidate
- Logout → guest
- MFA step-up на устройстве

---

## 4. Исправления (НЕ откатывать)

- 401 login не чистит Keychain (`skipAuth`)
- `Origin` + `X-Earflow-Client: ios-native`
- Refresh без storm; bounded 401 retry
- `degraded` ≠ logout на пустяках
- Logout → `playback.stop()` + ticket cache clear

---

## 5. Verify

```bash
npm run verify:monorepo-integrity
npm run verify:ios-native
```

iPhone: **Настройки → Auth Gate (dev)** — полный чеклист в `IOS_AUTH_CLOSURE_CHECKLIST.md`.

---

## 6. Gate status

| Gate | Status |
|------|--------|
| Simulator build+test | PASS in repo (re-run `verify:ios-native`) |
| Real iPhone auth E2E | **OPEN** |
| PEND-IOS-001 | **OPEN** |
