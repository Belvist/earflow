---
name: earflow-architecture-review
description: >-
  Senior code review and system design audit for Earflow services. Checks
  INV-* invariants, DECISIONS.md, thin-client vs smart-frontend, single
  ownership paths, security, and operational readiness. Use when the user
  asks for architecture review, service audit, compliance check, "умный фронт",
  backend authority, or full-stack correctness of a microservice and its
  integrations.
---

# Earflow Architecture & Code Review

Роль: **ревьюер + инженер-проектировщик**. Не чинить код без запроса — сначала отчёт с приоритетами.

## Обязательный контекст (порядок)

1. `docs/ARCHITECTURE_INVARIANTS.md` — нарушение `INV-*` = блокер или явное обсуждение.
2. `docs/DECISIONS.md` — `grep` по ключевым словам задачи; `Status: accepted` обязателен.
3. `docs/PENDING.md` — известные дыры.
4. `backend/<service>/CONTEXT.md` — если есть; иначе отметить gap.
5. `.cursor/rules/earflow-ui-client-prefs.mdc` — при UI prefs / escape hatch.
6. KLM (если MCP доступен): `klm_project_status` → `klm_get_project_memory` → для плана `klm_analyze_impact` + `klm_verify_plan`.

Скилы по домену: `earflow-streaming`, `earflow-device-sync`, `earflow-security-audit`, `earflow-verify-delivery`.

## Принцип «фронт не умный»

| Должно быть на backend/worker | Допустимо на frontend (тонкий клиент) |
|-------------------------------|----------------------------------------|
| Транскод, loudness, waveform peaks, variant keys | `canPlayType` / codec probe для выбора из **списка с сервера** |
| Auth, CSRF, stream session, quality_variants в DB | User preference (`low`/`high`/`auto`) + bandwidth estimator → pick из server list |
| Device Sync state, playlist rules, entitlements | Локальный scrub preview, UI prefs store (`INV-FE-006`) |
| Idempotency, job status, retries policy | Кэш GET waveform в memory (не второй pipeline decode) |

**Красные флаги «умного фронта»:** `OfflineAudioContext`, полный fetch трека для анализа, дублирование transcode/EBAP логики, optimistic ownership (`INV-DS-*`), `apply*ToDom` для prefs (`INV-FE-007`), второй control path (`INV-ARCH-001`).

## Чеклист по слоям

### Worker / async job

- [ ] Claim: `FOR UPDATE SKIP LOCKED`, статусы `pending` → `claimed` → `processing` → `done`/`failed`
- [ ] `pg_notify` + poll fallback; гонки claim безопасны
- [ ] Startup: застрявшие `claimed`/`processing` → `pending`; **failed** — явная политика (retry или ручной)
- [ ] Graceful shutdown: in-flight jobs, tmp cleanup (`TRANSCODE_WORK_DIR`)
- [ ] Concurrency: отдельные очереди не делят один слот без документации
- [ ] MinIO keys: без path traversal; bucket prefix нормализован
- [ ] SQL только параметризованный; секреты только env

### API / gateway

- [ ] Маршруты в `gateway.yaml`; `require_user` / `class: stream|unsafe`
- [ ] Service routes: `requireService(['api-gateway'])`
- [ ] Клиент не получает raw MinIO URL в prod

### Frontend

- [ ] Данные с API; fallback только декоративный (hash placeholder), не decode
- [ ] Playback: `DirectSession` + qualities из session payload
- [ ] Нет JWT в localStorage

### Ops

- [ ] `/health` + `/metrics`; runbook в `docs/monitoring-telegram-alerts-runbook.md`
- [ ] Docker: read_only, tmpfs, resource limits

## Формат отчёта (обязательный)

```markdown
# Audit: <service or flow>

## Executive summary
1–3 предложения: штатно / риски / блокеры.

## Соответствие инвариантам
| ID | Статус | Комментарий |

## Разделение ответственности (backend vs frontend)
- **Backend owns:** …
- **Frontend (thin):** …
- **Нарушения / риски:** …

## Findings
### Critical — …
### High — …
### Medium — …
### Low — …

## Рекомендации (приоритет)
1. …

## Как проверить
- Команды / метрики / SQL / UI шаги

## Архитектура (честно) — если был escape hatch или техдолг
- **Норма:** …
- **Техдолг:** … → PEND-*
- **Проверка prod:** …
```

Серьёзность: **Critical** = security/data loss/wrong authority; **High** = stuck jobs, prod outage risk; **Medium** = scale/ops debt; **Low** = docs/style.

## После правок (если агент менял код)

1. `npm run validate:ai` (architecture-sensitive)
2. Доменные тесты (`node --test` в сервисе, `verify:player-mobile` для sheet)
3. `klm_verify_code` + при решении `klm_analyze_task` (durable facts only)
4. `pnpm index:codebase -- --root "<repo>"` при merge

## Definition of done ревью

- [ ] Grep DECISIONS по теме
- [ ] Прослежен полный flow (upload → worker → DB → stream API → frontend)
- [ ] Явно сказано, что на фронте — только presentation/ABR, не business pipeline
- [ ] Findings с файлами и строками где возможно
- [ ] Пользователю: norm / debt / verify если затронуты escape hatch или UI prefs
