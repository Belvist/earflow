# iOS Agent Workflow — обязательный порядок

**Источник:** `universal_project_agent_pack/` + Earflow `INV-*`  
**Область:** `ios-app/` только  
**Статус:** binding для любого AI-агента в этом репозитории

---

## Перед любой задачей в `ios-app/`

0. **`docs/AGENT_SESSION_HANDOFF.md`** — глобальная память между чатами
1. **`ios-app/.project-memory/HANDOFF.md`** — iOS снимок (**первым** для ios-app)
2. **`universal_project_agent_pack/.ai/INDEX.md`** — универсальные + Earflow правила.
2. **`universal_project_agent_pack/.ai/AGENT_RULES.md`** — DoD, запреты, скиллы.
3. **`ios-app/.project-memory/CURRENT_STATE.md`** — что уже сделано / что нет.
4. **`docs/ARCHITECTURE_INVARIANTS.md`** — grep `INV-ARCH`, `INV-SEC`, `INV-DS`, `INV-FE`.
5. **`docs/DECISIONS.md`** — grep `ios`, `native`, `iOS`.
6. **`docs/PENDING.md`** — `PEND-IOS-001` и связанные записи.
7. **`docs/IOS_APP.md`** + **`ios-app/CONTEXT.md`** — архитектура модуля.
8. **`ios-app/.project-memory/BACKEND_FRONTEND_CONTRACT.md`** — контракт экрана, который трогаешь.

### KLM (если MCP подключён)

`klm_project_status` → `klm_get_project_memory` → `klm_analyze_impact` → `klm_verify_plan` → код → `klm_verify_code` → `klm_analyze_task` (durable facts only).

---

## Жёсткие запреты (iOS)

| Запрет | Инвариант |
|--------|-----------|
| Прямой Postgres/Redis/MinIO/internal URLs | gateway-only |
| `/api/ios/*` bypass | нет параллельного API |
| JWT/токены в UserDefaults/localStorage | Keychain + httpOnly cookies |
| Proof access token на диске | memory only |
| Бизнес-правила (права, статусы, лайки) только в SwiftUI | `INV-ARCH-002` |
| Optimistic Device Sync ownership | `INV-DS-001..006` |
| Второй AVPlayer / второй play path | `PlaybackActor` единственный owner |
| TODO/FIXME в коде | только `docs/PENDING.md` + `TASKS.md` |
| «Готово» без build evidence | `engineering-verification` |

---

## Definition of Done (iOS feature)

Функция **не готова**, пока нет:

1. **Domain** — DTO совпадает с gateway (не выдуманный JSON).
2. **State machine** — UI отражает `AuthState` / `PlaybackState` / loading-empty-error.
3. **Service** — вызов только через `GatewayClient` / actor service.
4. **Thin UI** — View + ViewModel; без дублирования backend rules.
5. **Errors** — маппинг `GatewayError`, без stack/SQL пользователю.
6. **Logs** — `EarflowLog` + redaction; без секретов.
7. **Tests** — unit для crypto/state/validators; test plan для UI smoke.
8. **Memory** — обновлены `HANDOFF.md`, `CURRENT_STATE.md`, `CHANGELOG.md`, при архитектуре — `docs/DECISIONS.md`.
9. **Verify** — `xcodebuild` PASS; `npm run verify:ios-native` когда доступен Simulator.

**prepared ≠ closed** для `PEND-IOS-001` до полного gate в `docs/PENDING.md`.

---

## После каждого значимого изменения

| Тип | Обновить |
|-----|----------|
| Новый экран/API | `BACKEND_FRONTEND_CONTRACT.md`, `API_CONTRACTS.md` |
| Новая state machine | `STATE_MACHINES.md` |
| Архитектурное решение | `docs/DECISIONS.md` (prepend) |
| Новый gap | `docs/PENDING.md` или `TASKS.md` |
| Изменение owns/caveats | `ios-app/CONTEXT.md` |
| Фаза закрыта/открыта | `HANDOFF.md`, `CURRENT_STATE.md`, `CHANGELOG.md` |

---

## Скиллы по задаче

| Задача | Skill |
|--------|-------|
| «Готово» / prod / фаза | `engineering-verification` |
| Auth, cookies, PoP | `earflow-security-audit` |
| HLS / stream session | `earflow-streaming` |
| Device Sync WS | `earflow-device-sync` |
| Architecture audit | `earflow-architecture-review` |
| Player sheet (будущее) | `earflow-player-sheet` → `earflow-player-verification` |

---

## Честность пользователю

Если в diff временный компромисс (упрощённый player, WKWebView Telegram, нет offline):

- **Норма** — что сделано правильно.
- **Техдолг** — что временно + ссылка на `PEND-*` / `TASKS.md`.
- **Как проверить** — Xcode, Simulator, журнал отладки, конкретные API.
