---
name: earflow-player-verification
description: >-
  Hard verification of Earflow mobile mini-player sheet gestures and Now Playing
  accent backdrop. Use after any change to MobilePlayerBar, MobilePlayerModal,
  useMiniPlayerPan, PlayerBackdrop, playerSheetPhysics, listenerCoverUrl,
  useCoverAccentColor, or when the user asks to verify swipes/backdrop end-to-end.
---

# Earflow — Player sheet + backdrop verification

Reference: **`docs/MOBILE_PLAYER_SHEET_DESIGN.md`**, `.cursor/rules/earflow-player-sheet.mdc`, skill `earflow-player-sheet`, `docs/DECISIONS.md` (grep `useMiniPlayerPan`, `player sheet`, `backdrop`).

## When to run (mandatory)

- After editing files in the chain below
- Before telling the user "готово" for swipe or backdrop fixes
- When user reports: stuck sheet, freeze ~50%, fast open+close break, wrong background color, mini-bar dead, error boundary on expand

## Ownership chain (read in order)

| Step | File | Must be true |
|------|------|----------------|
| 1 | `utils/playerSheetPhysics.js` | pure math only; no React |
| 2 | `usePlayerSheetState.js` | sole owner; `beginExpandPan`, `beginSheetDrag`, `applySheetDragDelta`, `applySheetDragStep`, `settleDrag` stops snap |
| 3 | `useMiniPlayerPan.js` | document pointerdown + window move/up; calls sheet API only; settle on pointerup |
| 4 | `useMiniPlayerGestureSession.js` | wires sheet + pan; no legacy gesture stack |
| 5 | `MobilePlayerBar/index.js` | wires `onSheetDragStart/Move/Settle`; no React pointer handlers on shell |
| 6 | `MobilePlayerModal.js` | `useOwnedSheetDrag`; **no** `animate(yMotion)`; `draggingFromMini` disables dismiss |
| 7 | `utils/listenerCoverUrl.js` | `toListenerSameOriginCoverUrl` for accent |
| 8 | `PlayerBackdrop.js` | `AccentFill` + `DarkenOverlay` only |

## Red flags (stop and fix — INV-SHEET-*)

- Legacy files: `useMiniPlayerGestureMachine`, `useMiniPlayerGestures`, `useMiniPlayerGestureCaptureRouting`
- `onPointerDown` on `MiniPlayerShell`
- `settleDrag` mid active expand pan
- `animate(yMotion`, `animateDismissClose`, `animateDismissBack` in modal
- `!sheetFullyOpen) return true` in dismiss guard
- `settleDrag` no-op while snap runs (must `stopSnapAnimation` first)
- `applyDragOffset` / `setSheetPosition` / `playerSheetController`
- `blurredBackdropCache`, `blurCoverBackdrop`, `usePlayerBackdropPhase`
- Framer `animate={{ y:` on modal overlay with owned `sheetDragY`

## Automated gate (run all; do not skip)

From repo root:

```bash
npm run verify:player-mobile
npm run validate:ai
```

**Pass criteria:** architecture test + unit + e2e gestures; validate:ai 0 errors; legacy mini gesture files absent.

## Manual prod checklist (report to user)

1. Deploy **frontend image** (not hot-reload only on phone).
2. Check `data-mini-bar-ui` build hint on mini-bar (e.g. `2026-06-v38-mini-player-pan-rewrite`).
3. Slow swipe up over discover rail → full expand, **no freeze at ~50%**.
4. Fast swipe up → immediate pull down → closes cleanly (no wrap/tangle).
5. Full open → accent from cover + darken (no CSS blur).
6. No React error boundary on expand.
7. DevTools Network: `GET …/covers/<file>.jpg` → **200** on listener origin.

## Verification report template (paste in reply)

```markdown
### Verification
- Architecture guard: PASS / FAIL
- Unit: …/… PASS
- E2E gestures: …/… PASS
- validate:ai: PASS / FAIL
- Chain audit: [physics | state | pan | modal | backdrop] OK / issue: …
- Build hint: …
- Manual prod: not run / PASS / FAIL (…)
```
