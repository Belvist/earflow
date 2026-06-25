# iPhone Auth Smoke — инструкция (PEND-IOS-001)

**Цель:** собрать evidence для закрытия `PEND-IOS-001`.  
**Статус gate:** OPEN до скриншотов + PASS по чеклисту.  
**Связанный чеклист:** `IOS_AUTH_CLOSURE_CHECKLIST.md`

---

## 0. Предусловия (один раз)

- Mac с Xcode 15+
- iPhone с iOS 17+, кабель или Wi‑Fi debugging
- Apple ID в Xcode → **Signing & Capabilities** (Team выбран, bundle `ru.earflow.listener`)
- Интернет на iPhone (без VPN, если он ломает `api.earflow.ru`)

```bash
cd /Users/earflow/Downloads/music-platform/ios-app
xcodegen generate   # если меняли project.yml или первый запуск
open Earflow.xcodeproj
```

---

## 1. Открыть проект в Xcode

| Параметр | Значение |
|----------|----------|
| **Файл** | `ios-app/Earflow.xcodeproj` (не `.xcworkspace` — его нет) |
| **Scheme** | **Earflow** |
| **Target** | **Earflow** (приложение, не EarflowTests) |
| **Device** | Ваш **реальный iPhone** (не Simulator) |

**Environment variables (Run):**

1. **Product → Scheme → Edit Scheme…**
2. Слева **Run** → вкладка **Arguments**
3. **Environment Variables:**
   - `EARFLOW_API_BASE_URL` **не должно быть** в списке (после `xcodegen generate` prod по умолчанию).
   - Если переменная осталась от старой схемы — **снять галочку** или удалить строку.
   - Других `EARFLOW_*` override не добавлять

> Auth Gate (`Auth Gate (dev)`) доступен только в **Debug** сборке с Xcode (⌘R). Release/TestFlight — отдельный gate, не для этого smoke.

---

## 2. Prod Gateway — как убедиться

При **выключенном** `EARFLOW_API_BASE_URL` приложение использует prod:

| Параметр | Ожидание |
|----------|----------|
| Gateway base URL | `https://api.earflow.ru` |
| Origin (заголовок) | `https://earflow.ru` |
| Streaming (HLS) | `https://strmhaha.earflow.ru` |

**Где проверить в UI:**

1. Вкладка **Аккаунт** → **Настройки** → секция **О приложении** → поле **API** = `api.earflow.ru`
2. **Auth Gate** → **Gateway reachable** = `yes`

**Красные флаги:**

- API = `127.0.0.1` / `localhost` / `18080` → `EARFLOW_API_BASE_URL` всё ещё включён
- Gateway reachable = `no` → сеть/DNS/VPN

---

## 3. Запуск на iPhone

1. **Product → Clean Build Folder** (⇧⌘K)
2. Выбрать **iPhone** в toolbar (не Simulator)
3. **Product → Run** (⌘R)
4. На iPhone: **Доверять** разработчику (Настройки → Основные → VPN и управление устройством), если первый запуск

**Первое, что увидите:** главный экран **guest** (вкладка «Главная»). Это норма.

---

## 4. Native login smoke

```text
open app (guest shell)
→ вкладка «Аккаунт»
→ «Войти» (или действие, требующее login)
→ native email/password login (prod-аккаунт)
→ Аккаунт → «Настройки» → «Auth Gate (dev)»
→ «Обновить диагностику»
→ «Запустить session verify»
```

**Ожидаемо после успешного login:**

| Поле Auth Gate | Ожидание |
|----------------|----------|
| Gateway reachable | yes |
| Auth endpoint reachable | yes |
| mp_sid cookie | yes |
| mp_csrf cookie | yes (часто yes) |
| Auth state | `authenticated` (или `degraded` только при слабой сети + есть profile id) |
| Profile from /api/profile | yes |
| Profile user id (gateway) | ваш user id (число) |
| Post-login verify → Profile OK | yes |
| Post-login verify → Refresh OK | yes |

**Не считать PASS:** только cookies без profile; `auth_failed_unknown` при известном backend code.

---

## 5. Restart smoke

```text
kill app (свайп вверх из app switcher)
→ reopen Earflow
→ подождать bootstrap (~2–5 с)
→ Аккаунт → Настройки → Auth Gate (dev)
→ «Обновить диагностику»
→ «Запустить session verify»
```

**Ожидаемо:**

| Поле | Ожидание |
|------|----------|
| Auth state | `authenticated` **или** `degraded` |
| Profile user id | тот же user id (не `—`) |
| Profile from /api/profile | yes (или degraded с кэшем — см. чеклист) |

**FAIL:** сразу `unauthenticated` / guest без явного logout; вылет на login sheet после каждой пересборки.

---

## 6. Logout smoke

```text
Настройки → «Выйти»
  (или Auth Gate → «Выйти»)
→ Auth Gate снова
→ попробовать защищённое действие (Play / Аккаунт без login)
```

**Ожидаемо:**

| Проверка | Ожидание |
|----------|----------|
| Auth state | `unauthenticated` |
| mp_sid cookie | no |
| Profile user id | `—` |
| UI | guest shell, login sheet по защищённому действию |

---

## 7. Negative smoke (опционально, но желательно)

**Неверный пароль:**

```text
logout / guest
→ login с неверным паролем
→ Auth Gate → Last auth attempt
```

**Ожидаемо:**

- Backend code: `INVALID_CREDENTIALS` (или другой **стабильный** code из backend)
- Category: `backend:INVALID_CREDENTIALS`, не `auth_failed_unknown:401`
- Provenance: `backendContract` или `backendMessageOnly` — не `clientDiagnostic`

**MFA-аккаунт (если есть):** после login — MFA step-up UI, не «неверный пароль».

---

## 8. Что прислать (evidence)

Минимум **4 скриншота** (можно в один тред):

1. **Auth Gate после login** — видны Reachability, cookies, Auth state, Profile user id, Post-login verify
2. **Auth Gate после restart** — тот же экран после kill/reopen
3. **Auth Gate после logout** — `unauthenticated`, mp_sid = no
4. При **FAIL** — скрин **Backend code / Provenance / Category** + HTTP status

Дополнительно (текстом):

```bash
cd /Users/earflow/Downloads/music-platform
npm run verify:ios-native
```

Вставить **хвост вывода** (PASS/FAIL gate report). Пароли в лог не копировать.

**Логи с iPhone:**

- **Настройки → Журнал отладки → Экспорт** (redacted `EarflowLog`)
- Или Xcode console — **без** значений cookies, tokens, password
- OK: `[auth] bootstrap authenticated userId=…`, `[auth] pipeline ok …`

**Не присылать:** значения `mp_sid`/`mp_csrf`, proof token, пароль, полный cookie dump.

---

## 9. После ваших скриншотов — как закрывают gate (не делать сами)

Только когда все пункты `IOS_AUTH_CLOSURE_CHECKLIST.md` = PASS с evidence:

1. Отметить чеклист (дата + скриншоты)
2. **Тогда** перевести `PEND-IOS-001` → CLOSED в `docs/PENDING.md`
3. Добавить в `docs/DECISIONS.md`: **iPhone auth smoke PASS** (дата, устройство, краткий итог)
4. Запись в `ios-app/.project-memory/CHANGELOG.md`
5. Обновить `CURRENT_STATE.md` / `HANDOFF.md` — gate closed

До evidence — **PEND-IOS-001 остаётся OPEN**. Новые docs по этому пункту не пишем.

---

## Быстрая навигация в приложении

```text
Auth Gate:  Аккаунт → Настройки → Auth Gate (dev)
Logout:     Аккаунт → Настройки → Выйти
Login:      Аккаунт → Войти  (или sheet при Play/действии)
API host:   Аккаунт → Настройки → О приложении → API
```
