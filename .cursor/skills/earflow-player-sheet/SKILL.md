---
name: earflow-player-sheet
description: >-
  Design and implement Earflow mobile mini-bar + full player sheet correctly —
  three-layer architecture, single sheetDragY owner, useMiniPlayerPan gesture isolation,
  INV-SHEET-*. Use BEFORE any change to MobilePlayerBar, MobilePlayerModal,
  usePlayerSheetState, useMiniPlayerPan, playerSheetPhysics, or when user asks
  how to build Spotify-like player gestures without competing with page scroll.
---

# Earflow — Mobile player sheet (design + implement)

**Read first:** `docs/MOBILE_PLAYER_SHEET_DESIGN.md` (полный эталон + ссылки Apple/react-modal-sheet).

**Rules:** `.cursor/rules/earflow-player-sheet.mdc`, `INV-SHEET-001..010`.

**Verify after:** skill `earflow-player-verification` → `npm run verify:player-mobile` + `npm run validate:ai`.

---

## When to use this skill

- New feature on mini-bar, full player, swipe open/close, dismiss
- Bug: stuck sheet, dead swipe after scroll/rail, fast open+close, ghost mini, freeze ~50%
- User asks: «как правильно», «как у Spotify», «почему конкурирует»
- **Before** writing code — not after prod failure

---

## Stop-and-rewrite (mandatory for swipe bugs)

If mini-bar expand/track swipe misbehaves:

1. Read `docs/MOBILE_PLAYER_SHEET_DESIGN.md` §2, §5
2. grep `docs/DECISIONS.md` → `useMiniPlayerPan`
3. Fix **owner chain only** — do **not** reintroduce gesture machine, capture routing, or React shell pointer handlers
4. «Minimal diff» is **wrong** if it adds a 2nd control path (`INV-SHEET-010`, `INV-ARCH-001`)

---

## Industry norm (do not reinvent)

Three layers, zero Y competition:

```
L1 Content (page scroll, playlist rails) — never sheetDragY
L2 Chrome (nav)
L3 PlayerChrome (mini + full sheet) — one sheetDragY owner
```

References:

- Apple [UISheetPresentationController](https://developer.apple.com/documentation/uikit/uisheetpresentationcontroller)
- [react-modal-sheet](https://github.com/SpaceBlocks/react-modal-sheet) — one `y`, Sheet.Scroller scroll handoff
- [gorhom bottom sheet](https://github.com/gorhom/react-native-bottom-sheet) — portal + snap points

Earflow maps this to web via `usePlayerSheetState` + `useMiniPlayerPan` + `classifyMiniBarSheetIntent`.

---

## Mandatory read order (before code)

1. `docs/MOBILE_PLAYER_SHEET_DESIGN.md`
2. `docs/ARCHITECTURE_INVARIANTS.md` → `INV-SHEET-*` (especially `INV-SHEET-010`)
3. `grep` `docs/DECISIONS.md` → `player sheet`, `mini bar`, `useMiniPlayerPan`
4. `.cursor/rules/earflow-player-sheet.mdc`
5. Owner chain files (below)

If KLM available: `klm_verify_plan` — plan must not add 2nd Y driver, 2nd mini pan path, or page-scroll on mini-bar.

---

## Owner chain (single path)

| # | File | Responsibility |
|---|------|----------------|
| 1 | `utils/playerSheetPhysics.js` | Pure math only |
| 2 | `usePlayerSheetState.js` | **Only** writer of phase + sheetDragY + snap |
| 3 | `useMiniPlayerPan.js` | Document down + window move/up → sheet API |
| 4 | `useMiniPlayerGestureSession.js` | Wires sheet + pan for MobilePlayerBar |
| 5 | `MobilePlayerBar/index.js` | Wire `onSheetDragStart/Move/Settle`; no shell pointer handlers |
| 6 | `MobilePlayerModal.js` | Read sheetDragY; no `animate(yMotion)` |
| 7 | `gestureIntent.js` | `classifyMiniBarSheetIntent` for mini expand |
| 8 | `playerSheetPhase.js` | Phase constants + INV comments |

**Deleted (never restore):** `useMiniPlayerGestureMachine`, `useMiniPlayerGestures`, `useMiniPlayerGestureCoordinator`, `useMiniPlayerGestureCaptureRouting`.

---

## Public sheet API (only touch via these)

```
open() | beginExpandPan() | beginSheetDrag() | applySheetDragDelta(dy) | applySheetDragStep(stepDy)
settleDrag(vy, travelY) | cancel() | finishClosed() | stopSnapAnimation()
```

Never from modal/pan: `sheetDragY.set`, `animate(yMotion)`, `setSheetPosition`.

Expand pan: `beginExpandPan` → `applySheetDragStep` per move → `settleDrag` **only on pointerup**.

---

## Design checklist (pre-implementation)

Answer **yes/no** before coding:

- [ ] Is there exactly **one** Y driver for the modal overlay?
- [ ] Is there exactly **one** mini pan controller (`useMiniPlayerPan`)?
- [ ] Does mini-bar use **`classifyMiniBarSheetIntent`** (not page scroll metrics)?
- [ ] Does dismiss route through **`onSheetDrag*`** callbacks?
- [ ] Does `beginSheetDrag` **stop snap** before new drag?
- [ ] Does `settleDrag` **stop snap** (not no-op while spring runs)?
- [ ] Is expand settle **only on pointerup** (not mid-drag on dy>=0)?
- [ ] Will change need **build hint** bump on `data-mini-bar-ui`?

Any **no** → stop, fix design in plan, do not patch symptoms.

---

## Implementation rules

1. **Remove before add** — second animator or second pan path = delete first
2. **No TODO in code** — gaps → `docs/PENDING.md`
3. **Match patterns** in `useMiniPlayerPan.js` / `usePlayerSheetState.js`
4. Scroll inside modal: follow react-modal-sheet handoff (`scrollTop === 0` → dismiss)

---

## Verification (mandatory before "готово")

```bash
npm run verify:player-mobile
npm run validate:ai
```

Optional real homepage:

```bash
cd frontend && npm run test:e2e -- e2e/homepage-gestures.spec.js
```

Report to user:

- Architecture norm vs known gaps (portal, dual bars — see design doc §6)
- Build hint value (`data-mini-bar-ui`, e.g. `2026-06-v38-mini-player-pan-rewrite`)
- Deploy frontend image — not Ctrl+F5 alone

Use template from `earflow-player-verification` skill.

---

## Red flags — stop immediately

- Any legacy mini gesture file returns
- `onPointerDown` on `MiniPlayerShell`
- `settleDrag` mid active expand pan
- `animate(yMotion` / `animateDismissClose` in modal
- `classifyMiniPlayerOpenIntent` in MINI_PLAYER_OPEN profile
- `!sheetFullyOpen) return true` in dismiss guard
- `sheet.cancel()` on mini pointerdown when modal visible
- `applyDragOffset` without anchor
- Blur backdrop stack reintroduced
- New `playerSheetController` or `setSheetPosition`

---

## Recording changes

| Change | Update |
|--------|--------|
| API/ownership | `docs/DECISIONS.md` (prepend) |
| New invariant | `docs/ARCHITECTURE_INVARIANTS.md` |
| Known gap | `docs/PENDING.md` |
| Contract change | bump `data-mini-bar-ui` |

KLM: `klm_analyze_task` with INV-SHEET facts after significant work.

---

## Honest ceiling (tell user when relevant)

Earflow web/PWA ≠ native UIKit. Realistic target: stable sheet + isolated mini gestures via single pan controller. Full parity (hero morph, detents UX, iOS Safari edge cases) needs device QA — see `docs/MOBILE_PLAYER_SHEET_DESIGN.md` §6.
