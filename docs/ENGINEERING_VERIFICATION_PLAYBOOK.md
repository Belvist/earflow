# Engineering Verification Playbook

**Назначение:** единая инструкция «как работают сильные инженеры» — до, во время и после любой задачи.  
**Универсальна:** применима к Earflow и к другим проектам (адаптация — §10).  
**Скил для агентов:** `.cursor/skills/engineering-verification/SKILL.md`

---

## 0. Главное правило

> **Prepared ≠ closed.** Код смержен, тесты в CI зелёные, скрипт PASS — это **не** доказательство, что фаза закрыта или prod безопасен.

Закрытие фазы / claim «готово» требует **уровня доказательств**, соответствующего риску (§2).

---

## 1. Лестница доказательств (Evidence Ladder)

| Уровень | Что доказывает | Закрывает фазу? | Типичная ошибка |
|---------|----------------|-----------------|-----------------|
| L0 — Intent | Поняли задачу, прочитали контекст | Нет | Сразу код без DECISIONS/PENDING |
| L1 — Code | Реализация в репо | **Нет** | «Смержил → готово» |
| L2 — Unit | Логика модуля изолированно | Частично | Mock всего стека |
| L3 — Integration | Сервис + DB/Redis/queue | Частично | Только happy path |
| L4 — Infra script | `verify-*.sh`, compose gate | **Нет** для security/UX | curl PASS = closed |
| L5 — Browser / real client | Заголовки, cookies, TTL, revoke в браузере | **Да** (для client-facing security) | Только backend e2e |
| L6 — Staging / VPS profile | Реальный compose, pinned SHA | **Да** (для ops rollout) | Локальный docker ≠ prod |
| L7 — Prod smoke + restore | После деплоя + откат overlay | **Да** (для prod claim) | Забыли restore после e2e |
| L8 — Capacity / soak | Измеренный RPS/latency | Нужен для scale claims | «Готово для миллионов» без цифр |

**Правило выбора минимального уровня:**

| Тип изменения | Минимум до «done» |
|---------------|-------------------|
| Косметика UI, copy | L1 + L2 + manual smoke |
| Новый API endpoint | L2 + L3 + authz review |
| Auth / security / cookies | L5 + L6 + restore discipline |
| Streaming / bytes path | L5 + L6 + playback smoke |
| Миграция БД | L3 + rollback script + staging |
| Feature flag rollout | L6 + prod-off gate + on gate + restore |
| Perf / scale claim | L8 + written report |

---

## 2. Фазы работы (универсальный цикл)

### Фаза A — Understand (до кода)

```text
[ ] Прочитать task / ticket — сформулировать «что считается успехом»
[ ] Grep DECISIONS / ADR по ключевым словам — accepted = binding
[ ] Прочитать PENDING / known gaps — не дублировать техдолг
[ ] Прочитать INV-* / architecture rules по области
[ ] Найти эталонный паттерн в соседнем коде (не изобретать)
[ ] Один владелец состояния? (нет второго control path)
[ ] Impact: какие сервисы, env flags, nginx, frontend, mobile?
[ ] План + verify steps — ДО правок (для non-trivial)
```

**Stop:** если нужен 3-й guard/useEffect/ref в одном модуле для того же бага → rewrite, не патч.

### Фаза B — Implement (минимальный diff)

```text
[ ] Удалить старое > добавить новое (где возможно)
[ ] Параметризованный SQL; server-side auth на каждый protected route
[ ] Секреты только env; не в git / логи
[ ] Feature flags default-off для risky behavior
[ ] Нет TODO в коде — gap → PENDING.md
[ ] Тесты только на реальное поведение (не тривиальные assert true)
```

### Фаза C — Verify (обязательно до ответа пользователю)

См. §3–§6 и доменные скилы.

### Фаза D — Record (часть Definition of Done)

| Изменение | Запись |
|-----------|--------|
| Архитектура / API / ownership | `DECISIONS.md` сверху |
| Новый известный gap | `PENDING.md` |
| Закрыт gap | Удалить из PENDING + DECISIONS |
| Регресс предотвращён | `INV-*` в invariants |
| Сервис touched | `backend/<svc>/CONTEXT.md` |

### Фаза E — Restore (после любого test overlay)

```text
Если поднимали e2e/staging overlay с другими env:
[ ] Запустить restore-скрипт проекта
[ ] Проверить prod flags (feature off, API base, cookie domain)
[ ] Прогнать prod gate scripts
[ ] Только потом — «фаза closed»
```

---

## 3. Универсальные чеклисты по типу задачи

### 3.1 Bugfix

```text
[ ] Воспроизведение задокументировано (шаги / URL / env)
[ ] Root cause найден (не симптом)
[ ] Fix минимальный — не рефакторинг «заодно»
[ ] Regression test или e2e если баг был user-visible
[ ] Соседние инварианты не сломаны (grep + smoke)
[ ] Честно: что НЕ проверял
```

### 3.2 New feature

```text
[ ] API contract: request/response/errors documented
[ ] Authz: кто может вызвать; IDOR проверен
[ ] Empty / error / loading states в UI
[ ] Backward compatibility или явная миграция
[ ] Feature flag или staged rollout если риск
[ ] Manual DoD table (шаг → ожидание)
```

### 3.3 Security-sensitive

```text
[ ] Threat model в 3 строках: asset, attacker, vector
[ ] Server never trusts client for authz
[ ] CSRF на state-changing cookie auth
[ ] No secrets in responses/logs
[ ] Token/cookie TTL и revoke path
[ ] Browser DoD если client headers matter (L5)
[ ] Prod default-off для новых mint/enforce paths
[ ] Log audit: нет ticket body / JWT / password в логах
```

### 3.4 Database migration

```text
[ ] Up migration idempotent где возможно
[ ] Down / rollback documented
[ ] Backfill script + dry-run mode
[ ] Staging apply + row counts
[ ] App compatible with old and new schema during rollout (if needed)
[ ] No long table locks without plan
```

### 3.5 Ops / deploy

```text
[ ] Single pinned git SHA across affected images
[ ] Health checks pass
[ ] Smoke script PASS
[ ] Rollback steps written (previous image tag / flag off)
[ ] After test overlay → restore prod (§2E)
[ ] Monitoring/alerts не сломаны
```

### 3.6 Refactor

```text
[ ] Поведение не меняется (или явно в scope)
[ ] Все существующие тесты green
[ ] Нет нового второго control path
[ ] Diff reviewable (< ~400 LOC или split PR)
```

---

## 4. Security audit (короткий, всегда)

При любом touch auth, gateway, upload, nginx, cookies:

| Vector | Проверить |
|--------|-----------|
| Injection | Parameterized queries; no concat user input |
| XSS | Escape output; CSP plan; no innerHTML with user data |
| CSRF | Cookie session + CSRF token on mutations |
| IDOR | Server checks ownership, not client id alone |
| Auth bypass | Spoofed headers stripped; service routes gated |
| Secrets | .env only; CI log masking |
| SSRF | URL fetch allowlist |
| Replay | Nonce/TTL/epoch for sensitive ops |
| Log leakage | grep logs for token/password/ticket body |

---

## 5. Шаблон отчёта агенту / в PR

```markdown
## Verification summary

| Gate | Result | Evidence |
|------|--------|----------|
| Unit | pass/fail | command + N/N |
| Integration | pass/fail/skip | … |
| E2E / browser | pass/fail/skip | … |
| Prod/staging script | pass/fail/skip | … |
| Manual smoke | done/partial/skip | bullets |

## Status (honest)

- **Prepared:** code merged / script exists
- **Validated:** tested on staging/e2e profile
- **Closed:** prod restore PASS + required evidence level met

## Architecture (честно) — если escape hatch / flag / техдолг

- **Норма:** …
- **Техдолг:** … → PEND-*
- **Как проверить prod:** URL, script, deploy artifact — не «обнови страницу»

## Not verified

- …

## Rollback

- …
```

---

## 6. Красные флаги — стоп

| Флаг | Действие |
|------|----------|
| «Готово» без команд / скриншотов / exit code | Не закрывать |
| Второй parallel path для того же state | Убрать старый (`INV-ARCH-001`) |
| `apply*ToDom` / override CSS для одного pref | Forbidden без PEND |
| e2e overlay без restore | Prod в опасном состоянии |
| Scale language без capacity report | Запретить формулировку |
| 3-й patch в одном модуле | Rewrite proposal |
| TODO в коде | → PENDING.md |
| Claim closed на script-only для security UX | Нужен browser DoD |

---

## 7. Earflow — доменные gate scripts

Базовый минимум перед «done» на любом PR:

```bash
npm run validate:ai
```

По области (добавлять к базовому):

| Область | Команды | Скил |
|---------|---------|------|
| Listener UI delivery | `frontend` build, unit, homepage e2e | `earflow-verify-delivery` |
| Mobile player sheet | `npm run verify:player-mobile` | `earflow-player-sheet`, `earflow-player-verification` |
| Auth / PoP / proof token | `npm run verify:prod-auth-gate`, browser DoD | `docs/AUTH_ROLLOUT_GATES.md` |
| Stream tickets SEC-005 | `npm run verify:stream-ticket` + restore | `docs/SEC-005_WS_STREAM_TICKETS_DESIGN.md` |
| After auth-e2e/capacity | `bash scripts/restore-prod-after-auth-e2e.sh` | обязательно |
| Architecture review | — | `earflow-architecture-review` |
| Security touch nginx/gateway | — | `earflow-security-audit` |
| Streaming | — | `earflow-streaming` |
| Device Sync | — | `earflow-device-sync` |

**Prod restore после e2e (обязательно):**

```bash
cd /opt/music-platform
bash scripts/restore-prod-after-auth-e2e.sh
# включает verify:frontend-api-base + verify:stream-ticket
```

---

## 8. Адаптация playbook к новому проекту

1. **Создать** `docs/DECISIONS.md`, `docs/PENDING.md`, `docs/ARCHITECTURE_INVARIANTS.md` (можно минимальные).
2. **Определить** Evidence Ladder: какие L4/L5/L6 gates нужны для вашего стека.
3. **Добавить** `scripts/verify-*.sh` для prod-critical invariants (API base, flags, health).
4. **Добавить** `scripts/restore-*` если есть test overlays с другими env.
5. **Скопировать** `.cursor/skills/engineering-verification/` в новый репо.
6. **Заполнить** §7-analog таблицу доменными скриптами проекта.
7. **Правило агента:** «prepared ≠ closed» в `AGENTS.md` или `.cursor/rules/`.

Минимальный набор для greenfield:

```text
validate:ai (или lint + test script)
verify:prod-health.sh
DECISIONS + PENDING discipline
engineering-verification skill
```

---

## 9. Definition of Done (универсальный)

Задача **closed** только если:

- [ ] Evidence level из §1 достигнут для типа задачи
- [ ] Автоматические gates прогнаны (exit 0 или documented skip с причиной)
- [ ] Manual DoD выполнен или явно «not verified» в отчёте
- [ ] Документация обновлена (§2D) если architecture-sensitive
- [ ] После test overlay — restore prod (§2E) если применимо
- [ ] Пользователю сообщены: норма / техдолг / как проверить (если escape hatch)
- [ ] Нет ложных scale/security claims

---

## 10. Связанные документы (Earflow)

| Документ | Когда читать |
|----------|--------------|
| `AGENTS.md` | Всегда |
| `docs/AUTH_ROLLOUT_GATES.md` | Auth phases |
| `docs/ARCHITECTURE_INVARIANTS.md` | Перед любым non-trivial change |
| `docs/DECISIONS.md` | Grep по теме |
| `docs/PENDING.md` | Known gaps |
| `.cursor/skills/engineering-verification/SKILL.md` | Агент: verify workflow |
