# Earflow — Gesture ownership matrix (player + home)

**Назначение:** единая таблица «кто владеет pointer» для конфликтующих зон. Обновлять при новом surface.

**Инварианты:** `INV-FE-003`, `INV-SHEET-*`, `INV-GESTURE-010..012` в `docs/ARCHITECTURE_INVARIANTS.md`.

---

## Priority (один `pointerId`)

| Surface | Priority | Exclusive mini? |
|---------|----------|-----------------|
| SEEK | 700 | defer in mini zone |
| PLAYER_SHEET (mini pan) | 600 | yes (`pointer-down`) |
| MODAL_DISMISS (header) | 550 | — |
| COVER_STACK (album / hero) | 440 (+20 album = 570) | defer in mini zone |
| PLAYLIST_RAIL | 420 | defer in mini zone |
| BOTTOM_SHEET | 400 | — |

Между **разными** `pointerId` приоритет не применяется.

---

## Matrix

| Zone | Owner | Directions | Defer / fail | E2E |
|------|-------|------------|--------------|-----|
| **Mini-bar** (`data-mini-gesture-zone`) | `useMiniPlayerPan` → `PLAYER_SHEET` | ↑ expand, ←→ track, tap open | Игнор ↓; не стартует при `isSheetModalVisible` (кроме interrupt snap) | `gestures.spec.js`, `homepage-gestures.spec.js`, `player-gestures-contract.spec.js` |
| **Full player album** (`player-album-section`) | `useModalAlbumGestures` → `COVER_STACK` | ←→ track, ↓ dismiss | Intent lock H vs V; disabled при lyrics / `draggingFromMini` | `player-gestures-contract.spec.js` |
| **Full player header** | `MODAL_DISMISS` machine | ↓ dismiss | Queue scroll `scrollTop>0` blocks; lyrics/menu gates | `modal-surfaces.spec.js` |
| **Progress / seek** (`#mobile-progress-bar`, hero waveform) | `usePointerSeek` → `SEEK` | horizontal scrub | `shouldDeferToMiniPlayerGesture` | `gestures.freeze-regression.spec.js` (battery) |
| **Hero cover** (home mobile/desktop) | `COVER_STACK` in `MusicPlayer` | ←→ (product-specific) | defer mini zone | `homepage-gestures.spec.js`, live gestures §7 |
| **Playlist rail** | `usePointerDragScroll` | horizontal scroll | defer mini zone | `homepage-gestures.spec.js` |
| **Lyrics panel** | native scroll (`touch-action: auto`) | vertical scroll | dismiss blocked (product); no album H swipe | `modal-surfaces.spec.js` |
| **Queue panel** | scroll area + handle gesture | scroll / handle expand | dismiss only `scrollTop===0` | `modal-surfaces.spec.js`, PEND-GESTURE-002 audit |
| **Generic BottomSheet** | `useSheetDragArbitration` | ↓ drag / snap | no Framer `drag` | device sheet in `modal-surfaces.spec.js` |

---

## Sheet phase × pointer-events

| Phase | Modal | Mini `pointer-events` | Album gestures | Controls mount |
|-------|-------|----------------------|----------------|----------------|
| CLOSED | hidden | auto | — | — |
| DRAGGING (mini) | visible | auto (capture) | off (`draggingFromMini`) | no |
| DRAGGING (modal) | visible | none | on | no |
| SNAPPING | visible (`holdModal` if close) | none | on (interrupt snap) | no |
| OPEN | visible | none | on | yes |

---

## E2E minimum (`npm run verify:player-mobile`)

See `frontend/e2e/player-gestures-contract.spec.js` for contract tests added 2026-06-04.

---

*Обновлено: 2026-06-04 — SNAPPING phase, unified `useModalAlbumGestures`, chrome mount gate.*
