# Earflow — архитектура pointer-жестов

**Назначение:** единый источник правды для любого swipe/drag/scroll-handoff во frontend. Читать **до** добавления нового жеста.

**Инварианты:** `INV-FE-003`, `INV-FE-004`, `INV-GESTURE-010`..`012` в `docs/ARCHITECTURE_INVARIANTS.md`.

**Правило для AI:** `.cursor/rules/earflow-gesture-architecture.mdc`

---

## Принципы (не обсуждаются на уровне «быстрого фикса»)

1. **Один слот arbiter на один `pointerId`** — пальцы не конкурируют в глобальном singleton.
2. **Один session на UI-домен** — mini-bar: sheet Y + track swipe → `useMiniPlayerGestureSession` (`session` + handlers).
3. **Один распознаватель на surface** — `usePointerGestureMachine` или arbiter-aware hook; не Framer `drag` + не голый `touchstart`.
4. **`touch-action` на drag-элементе** — иначе браузер убьёт жест `pointercancel` (INV-FE-004).
5. **Recover — только авария** — tab hide, unmount, диагностика; не штатный путь после каждого свайпа.

---

## Слои

```
Pointer event
    → GestureArbiter (Map<pointerId, owner>) + gestureDelegates policy
    → usePointerGestureMachine | usePointerSeek | usePointerDragScroll | …
    → Domain session (mini, modal dismiss, …)
    → Physics / React state (sheetDragY, motion preview, …)
```

| Слой | Ответственность | Запрещено |
|------|-----------------|-----------|
| Arbiter | Кто владеет `pointerId` до `pointerup` | Глобальный один owner на все пальцы |
| Gesture machine | intent lock, capture, commit/cancel | Прямая мутация sheet Y без coordinator |
| Session | Единый API (`session` + handlers) | Родитель вызывает sheet + gestures раздельно |
| Surface CSS | `touch-action`, `data-gesture-*` | `touch-action: none` на scrollable parent |

---

## Surfaces (`gestureContracts.js`)

Приоритет сравнивается **только внутри одного `pointerId`**. Между пальцами приоритет не применяется.

Mini-domain surfaces: `PLAYER_SHEET`, `MINI_TRACK_SWIPE` — `exclusive` с `pointer-down` в зоне `data-mini-gesture-zone`.

---

## Добавление нового жеста (чеклист)

1. Добавить `GESTURE_SURFACE` + `GESTURE_PRIORITY` в `gestureContracts.js`.
2. Реализовать через `usePointerGestureMachine` (или расширить arbiter-aware hook).
3. `tryClaim` / `release` с тем же `pointerId` на всём цикле.
4. Задать `touch-action` на элементе, который ловит pointer.
5. E2E: real touch (`e2e/helpers/touch.js`), не mouse.
6. Не дублировать ownership в локальном `useRef` без arbiter.

---

## Delegate graph (`gestureDelegates.js`)

Политика `evaluateGestureClaim({ active, next })` — единственное место для priority / exclusive / mini transfer. Arbiter только хранит `Map<pointerId, owner>`.

---

## Mini player (session) — Spotify-style direction lock

| Жест | Правило | Результат |
|------|---------|-----------|
| Tap | travel < slop | `sheet.open()` |
| Swipe ↑ (dominant Y, dy<0) | `classifyMiniBarSheetIntent` | sheet expand / drag |
| Swipe ← / → (dominant X) | `MINI_TRACK_SWIPE` | next / prev track |
| Swipe ↓ на mini | ignore (null) | не отдаём page scroll |

Constants: `IOS_GESTURE.miniDirectionLockPx`, `miniHorizontalDominance`, `miniVerticalDominance`.

- **Entry:** `useMiniPlayerGestureSession` → `session` (sheet API) + `miniGestureHandlers` + `recoverGestures` (emergency).
- **Sheet physics:** внутри session, не из `App` / `index` напрямую.
- **Build hint:** `data-mini-bar-ui` на shell для prod/e2e gate.

---

## Bottom sheet (generic)

- **Entry:** `useSheetDragArbitration` — двигает `y` через pointer machine, **без** Framer `drag` / `dragControls`.
- Handle + content: одни handlers, handle без `data-sheet-no-drag` на wrap.

---

## Ownership matrix

Полная таблица зон / приоритетов / e2e: **`docs/GESTURE_OWNERSHIP_MATRIX.md`**.

## Album (full player)

Один hook: `useModalAlbumGestures` — `COVER_STACK` priority 570, intent lock:

- **H** → next/prev (`shouldCommitHorizontalSwipe`)
- **V down** → `onSheetDragStart/Move/Settle` (sheet owner)

Не дублировать `useModalAlbumTrackSwipe` + header dismiss на той же обложке.

## Sheet phases

`CLOSED → DRAGGING → SNAPPING → OPEN` (и обратно через DRAGGING → SNAPPING → CLOSED). См. `INV-SHEET-011`, `playerSheetPhase.js`.

---

*Обновлено: 2026-06-04 — SNAPPING, unified album gestures, ownership matrix. PEND-GESTURE-001/002 closed (BottomSheet arbiter-native; queue audited in matrix).*
