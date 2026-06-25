# iOS Handoff — читать ПЕРВЫМ в новом чате

**Updated:** 2026-06-23  
**Global index:** `docs/AGENT_SESSION_HANDOFF.md`  
**Gate:** `PEND-IOS-001` **OPEN** — auth **prepared in code**, **not closed** without real iPhone evidence

**Closure checklist:** `ios-app/.project-memory/IOS_AUTH_CLOSURE_CHECKLIST.md`

---

## 0. Текущий этап

| Делать | Не делать |
|--------|-----------|
| Real iPhone auth smoke по checklist | Закрывать PEND-IOS-001 без evidence |
| Обновлять docs при изменении auth | «iOS auth готово» без iPhone |
| Simulator: `verify:ios-native` | TestFlight / social / reco до auth gate |

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
