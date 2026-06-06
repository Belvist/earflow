# Mobile Player Sheet — эталон проектирования (Earflow)

**Назначение:** единый источник правды **до** правок кода. Агент и разработчик **не угадывают** архитектуру — читают этот документ, затем `INV-SHEET-*`, затем код.

**Связанные файлы:**

| Тип | Путь |
|-----|------|
| Инварианты | `docs/ARCHITECTURE_INVARIANTS.md` → `INV-SHEET-001..010` |
| Cursor rule | `.cursor/rules/earflow-player-sheet.mdc` |
| Decision log | `docs/DECISIONS.md` → grep `player sheet` |
| Skill (агент) | `.cursor/skills/earflow-player-sheet/SKILL.md` |
| Verify skill | `.cursor/skills/earflow-player-verification/SKILL.md` |
| Gates | `npm run verify:player-mobile`, `npm run validate:ai` |

---

## 1. Почему нельзя «собирать на глаз»

Earflow — **web SPA**, не UIKit. Но UX mini-bar + full player = **bottom sheet + accessory bar**. Ошибка «против всех» — когда:

- два драйвера одной оси Y (Framer `animate y` + `sheetDragY`);
- mini-bar читает scroll страницы, хотя `touch-action: none`;
- dismiss и open — разные аниматоры;
- жесты подборки и sheet конкурируют без слоёв.

Индустрия давно решила это **разделением слоёв и одним motion value**. Мы не изобретаем — **сверяемся с нормой**, адаптируем под React/PWA.

### Внешние эталоны (читать при сомнениях)

| Источник | Что взять |
|----------|-----------|
| [Apple UISheetPresentationController](https://developer.apple.com/documentation/uikit/uisheetpresentationcontroller) | detents, presentation controller = отдельный слой, один pan |
| [WWDC21 — Customize sheets](https://developer.apple.com/videos/play/wwdc2021/10063/) | sheet ≠ content scroll; dimming отдельно |
| [react-modal-sheet](https://github.com/SpaceBlocks/react-modal-sheet) | один `y`, `Sheet.Scroller` + scroll handoff (`draggableAt`) |
| [react-spring-bottom-sheet](https://www.npmjs.com/package/react-spring-bottom-sheet) | body scroll lock, blocking mode, portal |
| [gorhom/react-native-bottom-sheet](https://github.com/gorhom/react-native-bottom-sheet) | portal на root, snap points, scroll-to-drag handoff |

---

## 2. Целевая архитектура (3 слоя, 0 конкуренции)

```
┌──────────────────────────────────────────────┐
│  L3 PlayerChrome (portal / fixed, z-max)      │
│    MiniBar accessory  │  FullPlayerSheet      │
│    touch-action:none  │  one sheetDragY       │
└──────────────────────────────────────────────┘
┌──────────────────────────────────────────────┐
│  L2 Page chrome (nav, header)               │
└──────────────────────────────────────────────┘
┌──────────────────────────────────────────────┐
│  L1 Content (scroll, playlist rails)          │
│    native / pan-x scroll — NEVER drives sheet Y │
└──────────────────────────────────────────────┘
```

**Правило:** L1 **никогда** не пишет в `sheetDragY`. L3 **никогда** не читает `window.scrollY` для классификации жеста mini-bar.

---

## 3. Earflow — текущая реализация (карта файлов)

```
playerSheetPhysics.js          pure math (snap, rubberBand, progress)
playerSheetPhase.js            CLOSED | DRAGGING | OPEN (+ dragSource mini|modal)
PlayerChrome/                  L3 portal → #ef-player-chrome-root
sheetScrollHandoff.js          queue/sheet scrollTop gate for dismiss
usePlayerSheetState.js         OWNER: sheetDragY, sheetProgress, phase, springs
useMiniPlayerPan.js            mini pointer → sheet API only (document down + window move/up)
useMiniPlayerGestureSession.js wires sheet + pan (single session export)
MobilePlayerBar/index.js       wires modal + mini; build hint data-mini-bar-ui
MobilePlayerModal.js           reads sheetDragY; dismiss → onSheetDrag*
PlayerBackdrop.js              accent + darken (no blur)
gestureIntent.js               classifyMiniBarSheetIntent (mini ignores page scroll)
GestureArbiterProvider.js      global pointer owner (осторожно с leaks)
```

### Публичный API owner (не дублировать)

| API | Назначение |
|-----|------------|
| `open()` | tap → instant `finishOpen()` |
| `beginExpandPan()` | mini vertical expand — anchor at closed Y |
| `beginSheetDrag()` | interrupt snap; anchor Y = current |
| `applySheetDragDelta(dy)` | `rubberBand(anchor + dy)` (modal dismiss) |
| `applySheetDragStep(stepDy)` | incremental move during expand pan |
| `settleDrag(vy, travelY)` | snap open/closed; **only on pointerup**; **always** `stopSnapAnimation` first |
| `cancel()` / `finishClosed()` | close button, hard close |
| `stopSnapAnimation()` | перед любым ручным drag |

**Запрещено снаружи:** `sheetDragY.set`, `setSheetPosition`, `animate(yMotion, …)` в modal при owned sheet.

---

## 4. Инварианты и **зачем** каждый gate

| ID | Правило | Почему ломается без него | Как ловим |
|----|---------|--------------------------|-----------|
| INV-SHEET-001 | Один `sheetDragY` → `style.y` | зависание ~90%, dual spring | architecture test, validate:ai |
| INV-SHEET-002 | OPEN только via owner | modal «открыт», y mid-air | e2e 5b partial swipe |
| INV-SHEET-003 | Modal без Framer animate y | конфликт tap vs swipe | grep `animate(yMotion` |
| INV-SHEET-004 | Chrome из `sheetProgress` | overlay отстаёт от пальца | visual / manual |
| INV-SHEET-005 | `beginSheetDrag` stops snap + anchor | fast open + close «завивает» | manual + e2e |
| INV-SHEET-006 | Dismiss → sheet API | второй аниматор dismiss | architecture test |
| INV-SHEET-007 | Mini не отдаёт жест page scroll | после scroll подборки swipe мёртв | unit `classifyMiniBarSheetIntent`, homepage e2e |
| INV-SHEET-008 | Portal L3 + pointer-events + scroll handoff | ghost mini hits; dismiss vs queue scroll | architecture test, `modal-surfaces` e2e |
| INV-SHEET-010 | Один `useMiniPlayerPan`; legacy stack удалён | freeze 50%, TDZ, layered patches | architecture test, validate:ai legacy scan |

### Почему проверять **до** «готово»

| Gate | Что доказывает | Без него |
|------|----------------|----------|
| `playerSheetArchitecture.test.js` | запрещённые паттерны не вернулись | регресс через месяц |
| `verify:player-mobile` (unit+e2e) | жесты на playground + scroll | «на телефоне сломалось» |
| `validate:ai` | rule files + INV-SHEET scans | агент снова добавит `animate(yMotion)` |
| `homepage-gestures.spec.js` | real homepage + rail scroll | playground green, prod red |
| build hint `data-mini-bar-ui` | prod получил новый bundle | Ctrl+F5 миф |

---

## 5. Жесты — контракты (не смешивать)

### Mini-bar (accessory)

- **Entry:** `useMiniPlayerPan` via `useMiniPlayerGestureSession` — **не** React `onPointer*` на shell, **не** gesture machine stack.
- Capture: `document` `pointerdown` (rail steal) + `window` `pointermove/up` until release.
- Surface: `GESTURE_SURFACE.PLAYER_SHEET` (expand) / horizontal track swipe on same session.
- Intent: **`classifyMiniBarSheetIntent`** (не page scroll metrics).
- CSS: `touch-action: none` на shell.
- Expand: `beginExpandPan` → `applySheetDragStep` per move → `settleDrag` **only on pointerup**.
- Visible sheet / DRAGGING: **`beginSheetDrag`**, не `cancel()`.

### Full player dismiss

- Только `onSheetDragStart` → `beginSheetDrag`
- `onSheetDragMove` → `applySheetDragDelta`
- `onSheetDragSettle` → `settleDrag`
- Работает **с mid-snap**, не только `sheetFullyOpen`

### Scroll handoff внутри modal

По [react-modal-sheet Sheet.Scroller](https://github.com/SpaceBlocks/react-modal-sheet):

- `scrollTop > 0` → vertical drag **скроллит** контент, sheet не dismiss
- `scrollTop === 0` → swipe down **закрывает** sheet

Earflow: `sheetScrollHandoff.js` + `[data-queue-scrollarea]`; e2e `modal-surfaces.spec.js` (queue scroll handoff). Lyrics mode: dismiss **полностью** заблокирован (`showLyrics`) — отдельный продуктовый gate, не scroll handoff.

---

## 6. Известные gaps (честно — не притворяться Apple-level)

| Gap | Норма | Статус Earflow (2026-06-03) |
|-----|-------|------------------------------|
| Portal на app root | gorhom / react-modal-sheet | **Закрыто** — `PlayerChrome` + playground |
| Ghost mini pointer mid-open | `pointer-events: none` при modal | **Закрыто** — INV-SHEET-008 |
| Scroll handoff в queue | Sheet.Scroller | **Закрыто** — `sheetScrollHandoff` + e2e |
| SNAPPING phase | отделить finger-up от spring | **Закрыто** — `PLAYER_SHEET_PHASE.SNAPPING` (`INV-SHEET-011`) |
| Один player chrome | один компонент | **Открыто** — `GlobalPlayerBar` (desktop) + `PlayerChrome` (mobile); осознанный split |
| Detents API | iOS detents | **Открыто** — snap via physics, не UI API |
| Lyrics scroll + dismiss | handoff at scrollTop 0 | **Открыто** — full dismiss block while lyrics open |
| Framer BottomSheet handle | arbiter-native drag | **Закрыто** — `useSheetDragArbitration` (`INV-GESTURE-012`) |

Новые фичи **не добавляют** второй путь — сначала закрывают gap из таблицы или PEND в `docs/PENDING.md`.

---

## 7. Workflow агента (обязательный порядок)

```
1. Прочитать этот файл (MOBILE_PLAYER_SHEET_DESIGN.md)
2. grep docs/DECISIONS.md по "player sheet" | "mini bar" | "useMiniPlayerPan"
3. Прочитать INV-SHEET-* (особенно INV-SHEET-010) в ARCHITECTURE_INVARIANTS.md
4. klm_verify_plan (если MCP доступен) — план не добавляет 2-й Y driver / 2-й mini pan path
5. Изменения только в owner chain — при баге свайпа: rewrite, не 3-й guard
6. npm run verify:player-mobile && npm run validate:ai
7. При UX-изменении: bump data-mini-bar-ui
8. Пользователю: deploy frontend image + build hint (не «обнови страницу»)
```

Skill: `.cursor/skills/earflow-player-sheet/SKILL.md`

---

## 8. Anti-patterns (история боли — не повторять)

| Anti-pattern | Симптом | Правильно |
|--------------|---------|-----------|
| Framer `animate={{ y: 0 }}` + `sheetDragY` | stuck 90% | только `sheetDragY` |
| `classifyMiniPlayerOpenIntent` на mini-bar | swipe мёртв после scroll | `classifyMiniBarSheetIntent` |
| `sheet.cancel()` on pointerdown mini | всё ломается после подборки | `beginSheetDrag` |
| `settleDrag` ignore if snap running | зависание при fast gestures | `stopSnapAnimation` first |
| Blur backdrop canvas | perf + cache hell | accent + darken |
| Patches без architecture test | регресс каждый спринт | `playerSheetArchitecture.test.js` |
| Layered mini gesture stack | freeze 50%, TDZ, shame patches | один `useMiniPlayerPan` (INV-SHEET-010) |
| `settleDrag` mid active expand pan | sheet stops at ~50% | settle **only on pointerup** |

---

## 9. E2E сценарии (минимум перед merge)

Playground (`e2e/gestures.spec.js`):

- tap open, swipe open, partial swipe settle (5b)
- swipe over carousel under mini
- after page scroll: tap + swipe
- close + immediate reopen

Real homepage (`e2e/homepage-gestures.spec.js`):

- scroll page + mini swipe
- **horizontal playlist rail scroll + mini swipe** (подборка)

---

## 10. Definition of done

- [ ] Нет второго Y-аниматора
- [ ] Mini gestures не используют page scroll metrics
- [ ] `verify:player-mobile` PASS
- [ ] `validate:ai` PASS
- [ ] Architecture test PASS
- [ ] DECISIONS запись если менялся контракт/API
- [ ] Пользователю: norm / debt / verify (если escape hatch)

---

*Последнее обновление: 2026-06-04 — SNAPPING phase, `useModalAlbumGestures` (H+V), controls mount gate. Matrix: `docs/GESTURE_OWNERSHIP_MATRIX.md`.*
