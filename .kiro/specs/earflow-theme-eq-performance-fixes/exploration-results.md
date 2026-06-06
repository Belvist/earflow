# Bug Condition Exploration Test Results

## Summary

Ran bug condition exploration tests on **unfixed code** to confirm which bugs exist.

**Date**: 2026-04-17
**Test File**: `frontend/src/__tests__/bugfix-exploration.test.js`
**Total Tests**: 12 tests across 7 bug categories

## Results

### ✅ CONFIRMED BUGS (Tests FAILED as expected)

#### 1. **P1 Bug - EqModal slider thumbs use var(--color-primary)** ✅ CONFIRMED
- **Test**: Task 1.4 - "should use #ffffff for slider thumbs, not var(--color-primary)"
- **Status**: ❌ FAILED (confirms bug exists)
- **Finding**: Slider thumbs use `var(--color-primary)` instead of white `#ffffff`
- **Impact**: Thumbs are green on earflow skin, amber on vinyl skin (violates monochrome design)
- **Requirements**: 2.5, 2.6

#### 2. **P2 Bug - EqModal inline handlers without useCallback** ✅ CONFIRMED
- **Test**: Task 1.5 - "should use useCallback for onChange and onInput handlers"
- **Status**: ❌ FAILED (confirms bug exists)
- **Finding**: onChange/onInput handlers are inline without useCallback
- **Impact**: All sliders re-render when one slider changes (performance issue)
- **Requirements**: 2.7, 2.8

#### 3. **P2 Bug - EqModal inline style objects** ✅ CONFIRMED
- **Test**: Task 1.5 - "should not have inline style objects that recreate on every render"
- **Status**: ❌ FAILED (confirms bug exists)
- **Finding**: Inline `style={{ opacity: player.eqEnabled ? 1 : 0.4 }}` recreates on every render
- **Impact**: Unnecessary re-renders and object creation (performance issue)
- **Requirements**: 2.7, 2.8

#### 4. **P2 Bug - EqModal double animation** ✅ CONFIRMED
- **Test**: Task 1.7 - "should animate only one element (overlay OR content, not both)"
- **Status**: ❌ FAILED (confirms bug exists)
- **Finding**: Both EqModalOverlay AND EqModalContent have framer-motion animation props
- **Impact**: Double animation causes lag on weak devices (performance issue)
- **Requirements**: 2.10

### ❌ NO BUG FOUND (Tests PASSED - bugs don't exist or already fixed)

#### 1. **P0 - SkinPicker theme switching** ❌ NO BUG
- **Test**: Task 1.1 - "should have simple onClick handler without drag interference"
- **Status**: ✅ PASSED
- **Finding**: No drag-logic, pointer-capture, or moved flag found in SkinPicker.tsx
- **Conclusion**: Current implementation uses simple onClick without interference
- **Note**: If theme switching still doesn't work, the bug is elsewhere (not in drag-logic)

#### 2. **P0 - EqModal preset updates sliders** ⚠️ IMPLEMENTATION EXISTS
- **Test**: Task 1.2 - "should call setGains or player.setEqGains when preset is selected"
- **Status**: ✅ PASSED
- **Finding**: setGains function exists and calls player.setEqGains
- **Conclusion**: Implementation exists, but may not work correctly at runtime
- **Note**: Need runtime testing to confirm if sliders actually update visually

#### 3. **P1 - offline.html monochrome styling** ❌ NO BUG
- **Test**: Task 1.3 - "should not contain green color #1db954 in offline.html"
- **Status**: ✅ PASSED
- **Finding**: No green colors (#1db954) or green radial gradients found
- **Conclusion**: offline.html already uses monochrome styling (black + white)

#### 4. **P2 - SkinPicker conditional scrollIntoView** ❌ NO BUG
- **Test**: Task 1.6 - "should check viewport before calling scrollIntoView"
- **Status**: ✅ PASSED
- **Finding**: Viewport check (getBoundingClientRect, outOfView) exists before scrollIntoView
- **Conclusion**: scrollIntoView is already conditional (already optimized)

## Counterexamples Found

### Bug 1: EqModal slider thumbs use var(--color-primary)
```javascript
// Found in EqModal.js
background: var(--color-primary, #ffffff);
```
**Counterexample**: Slider thumbs use `var(--color-primary)` which resolves to green (#1db954) on earflow skin.

### Bug 2: EqModal inline handlers without useCallback
```javascript
// Found in EqModal.js
onChange={(e) => {
  player.ensureAudioActivated?.();
  player.onEqGainChange(indexMap[i], Number.parseFloat(e.target.value));
}}
```
**Counterexample**: Inline arrow function recreated on every render, causing all sliders to re-render.

### Bug 3: EqModal inline style objects
```javascript
// Found in EqModal.js
style={{ opacity: player.eqEnabled ? 1 : 0.4 }}
```
**Counterexample**: Inline style object recreated on every render.

### Bug 4: EqModal double animation
```javascript
// Found in EqModal.js
<EqModalOverlay
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  exit={{ opacity: 0 }}
>
  <EqModalContent
    initial={{ scale: 0.9, opacity: 0, y: 20 }}
    animate={{ scale: 1, opacity: 1, y: 0 }}
    exit={{ scale: 0.9, opacity: 0, y: 20 }}
  >
```
**Counterexample**: Both overlay and content have animation props, causing double animation.

## Recommendations

### Priority 1: Fix Confirmed Bugs
1. **Fix P1 Bug**: Replace `var(--color-primary)` with `#ffffff` in EqModal slider thumbs
2. **Fix P2 Bugs**: 
   - Wrap onChange/onInput handlers in useCallback
   - Remove inline style objects (use styled-component props)
   - Animate only one element (overlay OR content, not both)

### Priority 2: Investigate Unconfirmed Bugs
1. **P0 - SkinPicker theme switching**: If bug still exists, investigate:
   - CSS issues (user-select: none, cursor: grab)
   - Event propagation issues
   - React state update issues
2. **P0 - EqModal preset updates**: Need runtime testing to confirm if sliders update visually

### Priority 3: Skip Already-Fixed Issues
1. **P1 - offline.html**: Already uses monochrome styling (no fix needed)
2. **P2 - SkinPicker scrollIntoView**: Already has conditional logic (no fix needed)

## Next Steps

1. ✅ **Phase 1 Complete**: Bug condition exploration tests written and run
2. ⏭️ **Phase 2**: Write preservation property tests (BEFORE implementing fix)
3. ⏭️ **Phase 3**: Implement fixes for confirmed bugs
4. ⏭️ **Phase 4**: Verify all tests pass after fixes

## Test Execution Command

```bash
cd frontend
npm test -- --testPathPattern=bugfix-exploration --no-coverage --watchAll=false
```

## Test Results Summary

- **Total Tests**: 12
- **Failed (Bugs Confirmed)**: 4
- **Passed (No Bug Found)**: 8
- **Bugs Confirmed**: P1 (1), P2 (3)
- **Bugs Not Found**: P0 (2), P1 (1), P2 (1)
