# Earflow — инструкции для AI-агентов

Персональная музыкальная платформа (Earflow): React SPA, 20+ микросервисов (Node.js + Go), стриминг, ML-рекомендации, Artist Portal.

## Документация (priority-loaded context)

Документы упорядочены по приоритету загрузки в контекст AI. Не читай нижние уровни без необходимости — экономь токены.

### Уровень 0 — обязательно перед любым изменением (~3000 токенов суммарно)

| Тема | Файл |
|------|------|
| Архитектурные инварианты (жёсткие правила, `INV-*`) | `docs/ARCHITECTURE_INVARIANTS.md` |
| Pointer gestures (arbiter, delegates, sessions) | `docs/GESTURE_ARCHITECTURE.md` + `.cursor/rules/earflow-gesture-architecture.mdc` + `INV-GESTURE-010..012` |
| Decision log (история решений + что НЕ повторять) | `docs/DECISIONS.md` ← **через grep по теме** |
| Pending / known gaps | `docs/PENDING.md` |
| **Security roadmap (финальная цель после PoP)** | **`docs/SECURITY_ROADMAP.md`** |
| **Auth target architecture (Telegram-principles, scale, native)** | **`docs/AUTH_TARGET_ARCHITECTURE.md`** |
| Escape hatches + UI prefs + честность агенту | `.cursor/rules/earflow-ui-client-prefs.mdc` + `INV-ARCH-001`, `INV-FE-006..008` |
| Mobile player sheet (open/close/dismiss) | `.cursor/rules/earflow-player-sheet.mdc` + `INV-SHEET-001..007` + **`docs/MOBILE_PLAYER_SHEET_DESIGN.md`** |

### Уровень 1 — при работе в конкретном сервисе

| Тема | Файл |
|------|------|
| Service context cards | `backend/<service>/CONTEXT.md` (шаблон: `docs/SERVICE_CONTEXT_TEMPLATE.md`) |
| Decisions по сервису | `docs/DECISIONS.md` ← grep по имени сервиса |

### Уровень 2 — детальные референсы (по запросу)

| Тема | Файл |
|------|------|
| Архитектура (полная карта) | `docs/earflow-architecture-map.md` |
| Карта сервисов | `reports/SERVICE_MAP.md` |
| Безопасность | `reports/SECURITY.md` |
| Runbook | `reports/RUNBOOK.md` |
| Быстрый старт | `reports/README.md` |

**Slash workflow:** `/load-context` запускает стандартный flow загрузки (см. `.windsurf/workflows/load-context.md`).

## Домены

- `earflow.ru` — listener SPA
- `auth.earflow.ru` — авторизация
- `api.earflow.ru` — API, WebSocket, HLS
- `artists.earflow.ru` — Artist Portal
- `strmhaha.earflow.ru` — direct audio origin

## Стек

- **Frontend:** React 18, styled-components, framer-motion, hls.js, CRACO (`frontend/`, `artist-frontend/`)
- **Gateway:** Go 1.22+ (`backend/go-api-gateway/`), маршруты в `gateway.yaml` / `gateway.artist.yaml`
- **Backend:** Node.js 22+ (Express), PostgreSQL + pgvector, Redis (main + auth), MinIO, Meilisearch, NATS
- **Infra:** Docker Compose, Nginx, k8s (`k8s/`), monitoring

## Роли агента

Выбирай роль по задаче. Не смешивай ответственность без необходимости.

### 1. Frontend Engineer

**Когда:** UI/UX, плеер, PWA, Device Sync UI, Party, React-компоненты.

**Область:** `frontend/src/`, `artist-frontend/src/`

**Правила:**
- Контексты: `PlayerContext`, `DeviceSyncContext`, `useAuth`
- API через `api/client.js`, CSRF — через gateway cookies
- Стили: styled-components рядом с компонентом (`.styles.js`)
- Не хранить JWT в localStorage; auth — httpOnly cookies
- Жесты: `docs/GESTURE_ARCHITECTURE.md` — per-pointer arbiter, `gestureDelegates`, domain session; mini-bar только `useMiniPlayerGestureSession`; BottomSheet без Framer drag; не добавлять competing `touchstart`/Framer `drag`
- **Client UI prefs** (mini bar variant, play/pause style): `utils/*` + `useSyncExternalStore` — см. `.cursor/rules/earflow-ui-client-prefs.mdc`, `INV-FE-006..008`. Перед escape hatch (`apply*ToDom`, override CSS) — **сказать пользователю**, что это техдолг, и записать PEND/DECISIONS.
- **Mobile player sheet:** **`docs/MOBILE_PLAYER_SHEET_DESIGN.md`** + skill `earflow-player-sheet`; owner `usePlayerSheetState`; `INV-SHEET-001..007`. После правок — `verify:player-mobile` + `validate:ai`.

### 2. Backend Engineer (Node)

**Когда:** бизнес-логика сервисов, SQL, очереди, upload, recommendations, playlist.

**Область:** `backend/*-service/`, `backend/*-worker/`

**Правила:**
- Параметризованные SQL; без конкатенации user input
- Service-to-service: `X-Service-Token`, JWT audience/issuer из `.env`
- Health endpoints, graceful shutdown
- Миграции: `backend/00-create-tables.sql` и сервисные скрипты

### 3. Gateway Engineer (Go)

**Когда:** новые API-маршруты, auth middleware, CSRF, rate limits, stream cookies.

**Область:** `backend/go-api-gateway/`

**Правила:**
- Маршруты только через `gateway.yaml` / `gateway.artist.yaml`
- Policy classes: `public`, `unsafe`, `stream` — не ослаблять без аудита
- Тесты: `internal/auth/*_test.go`, `internal/proxy/*_test.go`
- Не пробрасывать spoofed headers (`X-User-Id` только из session middleware)

### 4. Streaming Engineer

**Когда:** direct stream, EBAP HLS, transcode, MinIO media, iOS playback.

**Область:** `direct-stream-service`, `ebap-hls-*`, `transcode-worker`, `upload-service`

**Скил:** `.cursor/skills/earflow-streaming/`

### 5. Security Engineer

**Когда:** auth, MFA, cookies, CSRF, upload validation, nginx CSP/CORS.

**Область:** `auth-service`, `security-service`, `nginx/`, gateway auth

**Скил:** `.cursor/skills/earflow-security-audit/`

**Запрещено без явного запроса:** отключать CSRF, ослаблять rate limits, коммитить `.env` с секретами.

### 6. DevOps / SRE

**Когда:** Docker, деплой, бэкапы, scaling, мониторинг, CI.

**Область:** `docker-compose*.yml`, `scripts/`, `k8s/`, `monitoring/`

**Скил:** `.cursor/skills/earflow-ops/`

**Команды:** `./scripts/platform-control.sh health`, `./scripts/backup-postgres.sh`

## Общие принципы (все роли)

1. **Минимальный diff** — только то, что просят; без рефакторинга «заодно».
2. **Существующие паттерны** — читай соседний код перед правками.
3. **Без заглушек** — рабочая логика, не `TODO` / `console.log` вместо реализации.
4. **Секреты** — только `.env`, никогда в git.
5. **Тесты** — добавляй только если просят или покрывают реальное поведение.
6. **Коммиты** — только по явной просьбе пользователя.

## AI Discipline — поведенческие правила

(на основе уроков от архитектурных регрессов — см. `docs/DECISIONS.md` запись "Frontend authority в DeviceSync")

1. **Stop-and-rewrite trigger.** Если для исправления бага требуется 3-й guard / useEffect / ref подряд в одном модуле — **стоп**, предложи rewrite вместо очередной заплатки. Костыли копятся быстрее чем кажется. **Mobile player sheet / mini-bar swipes:** при freeze, rail steal, mid-drag settle, «свайп мёртв после scroll» — **не патчить** legacy stack; читать `docs/MOBILE_PLAYER_SHEET_DESIGN.md`, затем править **owner chain** (`usePlayerSheetState` + `useMiniPlayerPan`). «Минимальный diff» **не оправдан**, если diff добавляет 2-й control path (`INV-SHEET-010`, `INV-ARCH-001`).
2. **Удалять > добавлять.** Любое изменение сначала пытается УБРАТЬ существующий код. Чисто положительный diff (только добавления) — red flag, должна быть веская причина.
3. **TODO/FIXME в коде запрещены.** Все известные неполноты — в `docs/PENDING.md`, не в комментариях.
4. **Single source of truth.** Если для одного логического объекта появляются два хранилища (backend + frontend local state) — это провал архитектуры, обсудить с человеком.
5. **Не создавать новые `.md` в корне или случайных местах.** Документация только в `docs/`, `reports/`, или `<service>/CONTEXT.md`.
6. **Перед "оптимистичными" апдейтами на frontend** — проверь инварианты `INV-DS-*`, `INV-FE-*` (frontend authority в этих областях запрещён).
7. **Перед началом задачи** — `grep` по `docs/DECISIONS.md` по ключевым словам. Если решение уже принято и `Status: accepted` — оно обязательно к учёту.
8. **Gesture ownership.** Новый swipe/drag: зарегистрировать surface в `gestureContracts.js`, пройти arbiter (`INV-GESTURE-011`). Не singleton owner, не локальный listener без `tryClaim`. **Mini-bar expand/track swipe:** только `useMiniPlayerPan` (`INV-SHEET-010`) — не `useMiniPlayerGestureMachine`, не capture routing, не React `onPointer*` на shell. См. `.cursor/rules/earflow-gesture-architecture.mdc`, `.cursor/rules/earflow-player-sheet.mdc`.
9. **Архитектурная честность (весь проект).** Не копить параллельные пути для одного поведения (`INV-ARCH-001`). Для UI prefs / mini bar / play style — external store (`INV-FE-006`). Любой escape hatch (imperative DOM, override CSS, dual slots, лишний polling) — только с `PENDING` + в **том же ответе** пользователю: норма / техдолг / как проверить prod (`INV-FE-007`, `INV-FE-008`). Правило: `.cursor/rules/earflow-ui-client-prefs.mdc`.
10. **KLM:** при escape hatch / UI pref — записать invariants в project memory (`klm_analyze_task`), см. `.cursor/rules/klm-auto-memory.mdc`.

## AI Context Recording — что обновлять после изменений

| Тип изменения | Что обновить |
|---|---|
| Архитектурное (API, schema, ownership, контракт между сервисами) | новая запись **сверху** в `docs/DECISIONS.md` |
| Регресс предотвращён | новый `INV-*` в `docs/ARCHITECTURE_INVARIANTS.md` с конкретным "красным флагом" |
| Закрытие PEND-записи | удалить из `docs/PENDING.md`, упомянуть в `DECISIONS.md` |
| Изменение публичного API / owns / caveats сервиса | соответствующий `backend/<service>/CONTEXT.md` |
| Новый сервис | создать `backend/<service>/CONTEXT.md` по шаблону `docs/SERVICE_CONTEXT_TEMPLATE.md` |
| Обнаружена известная неполнота | новая PEND-запись в `docs/PENDING.md` |

Это **часть definition of done** для архитектурной задачи. Без записи следующая сессия AI повторит ошибку.

## Скилы проекта

| Скил | Назначение |
|------|------------|
| `earflow-streaming` | Direct stream, HLS, transcode, MinIO |
| `earflow-device-sync` | Device Sync API, stress-тесты, UI sync |
| `earflow-gateway-routing` | Новые маршруты в Go gateway |
| `earflow-security-audit` | Чеклист безопасности перед merge |
| `earflow-ops` | Docker, health, backup, scale |
| `earflow-verify-delivery` | Hard gate before "done": build, unit, e2e homepage, validate:ai, smoke matrix |
| `earflow-player-sheet` | **Design + implement** mobile sheet — read `docs/MOBILE_PLAYER_SHEET_DESIGN.md` **before** code |
| `earflow-player-verification` | Hard verify after touch — gates + prod checklist |

## Типичные потоки

```
Listener play:  Browser → Nginx → api-gateway → direct-stream / ebap-hls → MinIO
Auth:           Browser → gateway → auth-service → Redis (auth)
Upload:         Artist → gateway → upload-service → MinIO → track-processor
Recommendations: gateway → recommendations-service → Postgres + pgvector
Device Sync:    gateway → device-sync-service → Redis/NATS
```

## Локальный запуск

```bash
cp .env.example .env   # заполнить секреты
docker compose up -d
docker compose ps
```

Node 22+ для фронта: `cd frontend && npm start` (порт 3004).
