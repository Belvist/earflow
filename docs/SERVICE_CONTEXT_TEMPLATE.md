# Service CONTEXT.md — шаблон

**Зачем нужен:** каждая поддиректория сервиса в `backend/` имеет свой `CONTEXT.md` — компактную (50-120 строк, ≤ ~1000 токенов) карточку, по которой AI-агент за один read понимает что это за сервис, какие у него границы, что он публикует и что в нём НЕ нужно делать.

**Когда создавать:** при первом касании сервиса в задаче. Не нужно делать все 20+ карточек заранее — это будет шум. Создавай только когда работаешь в сервисе.

**Когда обновлять:** после изменения, затрагивающего публичный API сервиса, схему данных, dependencies, или известные caveats.

**Куда класть:** `backend/<service-name>/CONTEXT.md` (рядом с `package.json`/`go.mod`).

---

## Структура карточки (обязательная)

```markdown
# <service-name> — service context card

**Stack:** <Node 22 + Express | Go 1.22 + chi | Python + FastAPI | ...>
**Status:** production | beta | deprecated
**Owners:** <если есть>

## Назначение

Один абзац: что делает сервис, кто его потребители, какую проблему решает. Без воды.

## Public API

| Method | Path | Auth | Назначение |
|---|---|---|---|
| GET | `/health` | none | liveness |
| POST | `/foo` | user JWT | ... |

(Если есть WebSocket — отдельная подсекция с описанием frame types.)

## Owns (что хранит)

Список Redis keys / Postgres tables / MinIO buckets / NATS subjects, **которые принадлежат именно этому сервису**. Чужие keys/tables не упоминать.

```
Redis:
  earflow:user:{uid}:devices       — Set<deviceId>
  earflow:user:{uid}:active        — string deviceId, TTL DEVICE_TTL

Postgres:
  device_audit_log                 — audit trail (write-only by this service)
```

## Reads (что читает у других)

С какими сервисами интегрируется как клиент. Указать **через что** (HTTP / DB / Redis).

```
auth-service       — verifies session via JWT issuer/audience (HTTP, not direct DB)
recommendations    — N/A
postgres.users     — read-only (через SELECT, не FK)
```

## Publishes (что эмиттит)

Любые события / pub-sub / NATS / WS frames, которые этот сервис **публикует наружу**. Каждое событие — с обязательными полями.

```
Redis Pub/Sub channel: earflow:dsync:user:{uid}
Events:
  devices:active     {deviceId, activeRevision, previousActiveId, at}
  devices:update     {at}
  np:update          {state, activeRevision, at}
  ...
```

## Dependencies (инфраструктура)

```
Required:
  - Redis (cluster: main)
  - Postgres (only if writes audit log)
Optional:
  - NATS (для cross-service notification, опционально)
```

## Caveats / Gotchas

Конкретные подводные камни, на которые легко наступить. Каждый в 1-2 строки.

- При WebSocket reconnect клиент шлёт `Last-Event-Id`, сервис **должен** не плюнуть init frame повторно если revision не менялся.
- `keyActive` имеет TTL = DEVICE_TTL — если active device пропустит heartbeat, ownership сбрасывается.
- Команда `cmd:play` от non-active device триггерит `StartTransfer` (см. `INV-DS-002`).

## Recent significant changes

Ссылки на записи в `docs/DECISIONS.md`. Не дублировать содержимое.

- 2026-05-27 — Этап 1: transfer-on-play на backend, удаление frontend authority. См. `docs/DECISIONS.md`.

## Tests

```
go test ./internal/devices                  — registry + transfer FSM unit tests
go test ./internal/auth                     — ticket/jwt validation
```

## Где смотреть глубже

- Code entrypoint: `cmd/server/main.go`
- HTTP routes: `internal/httpapi/routes.go`
- Core domain: `internal/devices/registry.go`, `internal/devices/transfer_fsm.go`
- WebSocket: `internal/websocket/`
- Архитектурная карта (вся платформа): `docs/earflow-architecture-map.md`
```

---

## Что делает карточку **полезной** (а не декорацией)

1. **Объём ≤ 120 строк / ~1000 токенов.** Если больше — что-то выносится в детальный doc и линкуется.
2. **"Owns" эксклюзивно.** Если ключ упомянут в двух карточках — одна из них врёт.
3. **Caveats — это реальные грабли.** Не "сервис работает с Redis". А "ключ X имеет TTL Y, не забыть Persist при Z".
4. **Recent changes — только ссылки.** Подробности — в `DECISIONS.md`. Карточка не превращается в changelog.
5. **Tests — конкретные команды.** Чтобы AI/человек запустил без догадок.

## Anti-patterns в карточке

- ❌ "Сервис написан на лучшем стеке для микросервисов" — пустая вода.
- ❌ Маркетинговые формулировки в `Назначение`.
- ❌ Полный API spec с примерами JSON — для этого OpenAPI/proto, не markdown.
- ❌ Архитектурные диаграммы — это в общем `docs/earflow-architecture-map.md`.
- ❌ Дублирование invariants — на них **ссылаться** (`см. INV-DS-002`), не переписывать.
