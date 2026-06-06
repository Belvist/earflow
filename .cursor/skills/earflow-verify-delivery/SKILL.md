---
name: earflow-verify-delivery
description: >-
  End-to-end verification checklist for Earflow frontend/UI delivery (build,
  tests, e2e, architecture invariants, regression matrix). Use when the user asks
  to verify work, audit a diff, confirm nothing is broken, or before claiming
  "done" on home desktop, player sheet, mood radar, or lazy-route changes.
---

# Earflow — verify delivery (hard gate)

Run this **before** telling the user a UI task is complete. Do not skip steps because a prior step passed once.

## 1. Automated (run all; fix failures)

From repo root:

```bash
cd frontend && npm run build
cd frontend && npm run test:unit:ci
cd frontend && npx playwright test e2e/homepage-health.spec.js e2e/homepage-gestures.spec.js --reporter=line
cd .. && npm run validate:ai
```

PowerShell: use `;` instead of `&&` if needed.

**Pass criteria:** build exit 0, all unit tests green, e2e 5/5 (or document known flakes), validate:ai 0 errors.

Optional full e2e: `cd frontend && npx playwright test --reporter=line` (only when task touched gestures/player globally).

## 2. Diff audit (grep — must match intent)

| Area | Grep / check |
|------|----------------|
| Desktop player open | `PlayerSheetContext`, `fallbackSheetProgress`, `openInstantly` in `GlobalPlayerBar` + `MobilePlayerModal` |
| Hero cover click | `coverDraggedRef`, `queueMicrotask` + `handleHeroCoverOpen` — swipe must NOT open sheet |
| Playlist clicks | `PlaylistOverlay` has `pointer-events: none`; `PlayButton` has `pointer-events: auto` |
| Home surface | `HOME_SURFACE_RGBA` / `rgb(20, 20, 20)` on hero + `MusicPlayer` desktop bg |
| For you row | `portraitCoverBox`, `flex: 0 0 136px` (matches playlist card widths) |
| Lazy routes | `lazyWithRetry` in `App.js`; `index.js` chunk regex `Loading chunk [\w.-]+ failed` |
| Mood radar empty | `BROWSE_MOODS`, empty hint copy, `?mood=` handling |

## 3. Architecture (Earflow)

Read if touching UI prefs / escape hatches: `.cursor/rules/earflow-ui-client-prefs.mdc`, `INV-ARCH-001`.

In the **same reply** to the user include when relevant:

- **Норма** — what is correct
- **Техдолг** — temporary gaps (`docs/PENDING.md`)
- **Как проверить** — local URL, deploy, not only Ctrl+F5

## 4. Manual smoke (desktop ≥768px + mobile)

| Action | Expected |
|--------|----------|
| `/` tabs Для тебя / Нравится | Queue source changes; tab highlight updates |
| `/` Новинки / Жанры | Navigate without red ChunkLoadError overlay |
| Hero cover click (desktop) | Full player opens; **no** ErrorBoundary screen |
| Hero cover swipe | Track changes; player does **not** open |
| «Для вас» row card click | Track plays |
| Playlist rail card click | Navigates or plays; hover play button works |
| `/mood-radar` | Mood grid visible (personal or browse fallback); click loads tracks |
| Global bar cover click | Full player opens (desktop) |

## 5. Report template (paste to user)

```markdown
## Verification
- Build: pass/fail
- Unit: N/N
- E2E homepage: N/N
- validate:ai: pass/fail
- Manual: [what you checked]

## Issues found
- [file] — [problem] — [fix status]

## Honest limits
- [what was NOT verified, e.g. prod iPhone PWA cache]
```

## 6. Red flags — stop and fix

- `useSpring(null)` / `useTransform(null)` on optional motion props → use `useMotionValue` fallback
- Invisible `opacity: 0` overlay without `pointer-events: none` on clickable cards
- Second control path for same UI pref (see `INV-ARCH-001`)
- Claiming "done" with only build, no e2e after gesture/routing changes

## Script

`frontend/scripts/verify-delivery.ps1` — runs steps in §1 (Windows).
