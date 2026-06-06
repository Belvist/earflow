# Implementation Plan

## Phase 1: Exploration Tests (BEFORE Fix)

- [x] 1. Write bug condition exploration tests
  - **Property 1: Bug Condition** - Theme Switching, EQ Presets, Styling Issues
  - **CRITICAL**: These tests MUST FAIL on unfixed code - failure confirms the bugs exist
  - **DO NOT attempt to fix the tests or the code when they fail**
  - **NOTE**: These tests encode the expected behavior - they will validate the fixes when they pass after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bugs exist
  - **Scoped PBT Approach**: For deterministic bugs, scope the properties to the concrete failing cases to ensure reproducibility
  
  - [x] 1.1 Test P0: SkinPicker theme switching
    - Test that clicking a theme card in SkinPicker calls `setSkinId` with the selected theme ID
    - Simulate click on "Vinyl" theme card → assert `setSkinId("vinyl")` is called
    - Run test on UNFIXED code
    - **EXPECTED OUTCOME**: Test FAILS (confirms drag-logic or pointer-capture blocks click)
    - Document counterexamples found (e.g., "setSkinId not called when card clicked")
    - _Requirements: 2.1, 2.2_
  
  - [x] 1.2 Test P0: EqModal preset updates sliders
    - Test that selecting "Bass" preset updates slider values to [6, 5, 3, 1, 0, -1, -2, -2, -2, -2]
    - Simulate preset selection → assert `player.eqGains` contains [6, 5, 3, 1, 0, -1, -2, -2, -2, -2]
    - Run test on UNFIXED code
    - **EXPECTED OUTCOME**: Test FAILS (confirms sliders don't update visually)
    - Document counterexamples found (e.g., "player.eqGains not updated after preset selection")
    - _Requirements: 2.3_
  
  - [x] 1.3 Test P1: offline.html monochrome styling
    - Test that offline.html uses only black (#000) and white (#fff) colors
    - Load offline.html → assert no green colors (#1db954) are present
    - Run test on UNFIXED code
    - **EXPECTED OUTCOME**: Test FAILS if green color exists (confirms outdated styling)
    - Document counterexamples found (e.g., "green color #1db954 found in .btn-primary")
    - _Requirements: 2.4_
  
  - [x] 1.4 Test P1: EqModal slider thumbs are white
    - Test that EqModal slider thumbs use #ffffff, not var(--color-primary)
    - Render EqModal → assert slider thumb background is #ffffff
    - Run test on UNFIXED code
    - **EXPECTED OUTCOME**: Test FAILS (confirms thumbs use var(--color-primary))
    - Document counterexamples found (e.g., "slider thumb uses green/amber color instead of white")
    - _Requirements: 2.5, 2.6_
  
  - [x] 1.5 Test P2: EqModal render performance
    - Test that changing one slider doesn't re-render all other sliders
    - Render EqModal → change slider 0 → assert sliders 1-6 don't re-render
    - Run test on UNFIXED code
    - **EXPECTED OUTCOME**: Test FAILS (confirms all sliders re-render due to no useCallback)
    - Document counterexamples found (e.g., "all 7 sliders re-rendered when only 1 changed")
    - _Requirements: 2.7, 2.8_
  
  - [x] 1.6 Test P2: SkinPicker conditional scrollIntoView
    - Test that scrollIntoView is NOT called when card is already in viewport
    - Switch theme when card is visible → assert scrollIntoView is NOT called
    - Run test on UNFIXED code
    - **EXPECTED OUTCOME**: Test FAILS if scrollIntoView called unconditionally (confirms no viewport check)
    - Document counterexamples found (e.g., "scrollIntoView called even when card visible")
    - _Requirements: 2.9_
  
  - [x] 1.7 Test P2: EqModal single animation
    - Test that only one element animates when EqModal opens/closes
    - Open EqModal → count animated elements → assert only 1 element animates
    - Run test on UNFIXED code
    - **EXPECTED OUTCOME**: Test FAILS (confirms both overlay and content animate)
    - Document counterexamples found (e.g., "both overlay and content animate simultaneously")
    - _Requirements: 2.10_

## Phase 2: Preservation Tests (BEFORE Fix)

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Buggy Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy inputs
  - Write property-based tests capturing observed behavior patterns from Preservation Requirements
  - Property-based testing generates many test cases for stronger guarantees
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  
  - [x] 2.1 Test SkinPicker scroll preservation
    - Observe: Wheel scroll (vertical → horizontal) works on unfixed code
    - Observe: Touch-scroll works on unfixed code
    - Write property-based test: for all scroll events (wheel, touch), scroll behavior is correct
    - Verify test passes on UNFIXED code
    - _Requirements: 3.1, 3.2, 3.3_
  
  - [x] 2.2 Test EqModal functionality preservation
    - Observe: Individual slider changes work on unfixed code
    - Observe: Playback rate (Slowed/Normal/Sped) works on unfixed code
    - Observe: preservePitch toggle works on unfixed code
    - Observe: User presets (User 1-5) save to localStorage on unfixed code
    - Observe: Mobile device message displays on unfixed code
    - Write property-based tests: for all non-preset interactions, functionality is correct
    - Verify tests pass on UNFIXED code
    - _Requirements: 3.4, 3.5, 3.6, 3.7, 3.8_
  
  - [x] 2.3 Test offline.html functionality preservation
    - Observe: "Попробовать снова" button reloads page on unfixed code
    - Observe: "Открыть скачанное" button navigates to "/" on unfixed code
    - Observe: Automatic reload on network detection works on unfixed code
    - Write property-based tests: for all button clicks and network events, functionality is correct
    - Verify tests pass on UNFIXED code
    - _Requirements: 3.9, 3.10, 3.11_
  
  - [x] 2.4 Test general UI styling preservation
    - Observe: PlayPauseButton, ProgressFill, VolumeSlider use monochrome styling on unfixed code
    - Observe: PartyBadge uses green #1db954 on unfixed code
    - Write property-based tests: for all non-EqModal/offline.html elements, styling is correct
    - Verify tests pass on UNFIXED code
    - _Requirements: 3.12, 3.13_

## Phase 3: Implementation

- [x] 3. Fix P0: SkinPicker theme switching

  - [x] 3.1 Investigate and fix theme switching issue
    - Verify current SkinPicker.tsx implementation (should have simple onClick without drag interference)
    - If bug persists, investigate `user-select: none` or `cursor: grab` in styled-components
    - Remove any pointer-capture or drag-logic that blocks click events
    - Ensure `setSkinId` is called immediately on card click
    - _Bug_Condition: C1 - Click on theme card blocked by drag-logic or pointer-capture_
    - _Expected_Behavior: P1 - setSkinId called immediately on click_
    - _Preservation: SkinPicker scroll behavior (wheel, touch) unchanged_
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Theme Switching Works
    - **IMPORTANT**: Re-run the SAME test from task 1.1 - do NOT write a new test
    - The test from task 1.1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1.1
    - **EXPECTED OUTCOME**: Test PASSES (confirms theme switching works)
    - _Requirements: 2.1, 2.2_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - SkinPicker Scroll Behavior
    - **IMPORTANT**: Re-run the SAME test from task 2.1 - do NOT write a new test
    - Run preservation property test from step 2.1
    - **EXPECTED OUTCOME**: Test PASSES (confirms no regressions in scroll behavior)
    - _Requirements: 3.1, 3.2, 3.3_

- [ ] 4. Fix P0: EqModal preset updates sliders

  - [ ] 4.1 Investigate and fix preset slider update issue
    - Observed on 2026-04-18: visible preset application now works and is covered by behavioral tests, but the current 7-band EQ architecture intentionally zeroes non-rendered bands in `normalizeGains`, so this item should remain open until the plan is clarified about full 10-band preset values.
    - Investigate `player.setEqGains` implementation in PlayerContext
    - Ensure `setGains` updates `player.eqGains` synchronously
    - Add force re-render if needed (e.g., `setSelectedPreset` after `setGains`)
    - Verify that `indexMap` is correct: `[0, 1, 2, 3, 4, 7, 9]` for frequencies `[60, 170, 310, 600, 1000, 10000, 16000]`
    - Test with "Bass" preset: [6, 5, 3, 1, 0, -1, -2, -2, -2, -2]
    - _Bug_Condition: C2 - Preset selection doesn't update slider values visually_
    - _Expected_Behavior: P2 - Sliders update to reflect preset values_
    - _Preservation: EqModal functionality (individual sliders, playback rate, preservePitch, localStorage) unchanged_
    - _Requirements: 2.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [ ] 4.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - EQ Presets Update Sliders
    - **IMPORTANT**: Re-run the SAME test from task 1.2 - do NOT write a new test
    - Run bug condition exploration test from step 1.2
    - **EXPECTED OUTCOME**: Test PASSES (confirms sliders update correctly)
    - _Requirements: 2.3_

  - [ ] 4.3 Verify preservation tests still pass
    - **Property 2: Preservation** - EqModal Functionality
    - **IMPORTANT**: Re-run the SAME test from task 2.2 - do NOT write a new test
    - Run preservation property test from step 2.2
    - **EXPECTED OUTCOME**: Test PASSES (confirms no regressions in EqModal functionality)
    - _Requirements: 3.4, 3.5, 3.6, 3.7, 3.8_

- [x] 5. Fix P1: offline.html monochrome styling

  - [x] 5.1 Update offline.html to use monochrome styling
    - Verify current offline.html styling (should already use white/black)
    - If green color (#1db954) exists in radial gradient or other elements, replace with white/gray
    - Ensure `.btn-primary` uses white (#ffffff) background
    - Ensure `.dot` uses red (#ef4444) for offline indicator (acceptable accent)
    - Remove any green radial gradients
    - _Bug_Condition: C3 - offline.html uses green color instead of monochrome_
    - _Expected_Behavior: P3 - offline.html uses only black and white colors_
    - _Preservation: offline.html functionality (buttons, network detection) unchanged_
    - _Requirements: 2.4, 3.9, 3.10, 3.11_

  - [x] 5.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Monochrome Styling for offline.html
    - **IMPORTANT**: Re-run the SAME test from task 1.3 - do NOT write a new test
    - Run bug condition exploration test from step 1.3
    - **EXPECTED OUTCOME**: Test PASSES (confirms monochrome styling)
    - _Requirements: 2.4_

  - [x] 5.3 Verify preservation tests still pass
    - **Property 2: Preservation** - offline.html Functionality
    - **IMPORTANT**: Re-run the SAME test from task 2.3 - do NOT write a new test
    - Run preservation property test from step 2.3
    - **EXPECTED OUTCOME**: Test PASSES (confirms no regressions in offline.html functionality)
    - _Requirements: 3.9, 3.10, 3.11_

- [x] 6. Fix P1: EqModal slider thumbs white color

  - [x] 6.1 Update EqModal slider thumbs to use white color
    - In `EqHSlider`: Change `background: var(--color-primary, #ffffff);` → `background: #ffffff;`
    - In `EqSlider`: Change `background: var(--color-primary, #ffffff);` → `background: #ffffff;`
    - Remove fallback, use white (#ffffff) directly
    - Test on both "earflow" and "vinyl" skins to ensure white color is consistent
    - _Bug_Condition: C4 - Slider thumbs use var(--color-primary) instead of white_
    - _Expected_Behavior: P4 - Slider thumbs are white by default_
    - _Preservation: EqModal functionality unchanged_
    - _Requirements: 2.5, 2.6, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 6.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - White EQ Slider Thumbs
    - **IMPORTANT**: Re-run the SAME test from task 1.4 - do NOT write a new test
    - Run bug condition exploration test from step 1.4
    - **EXPECTED OUTCOME**: Test PASSES (confirms slider thumbs are white)
    - _Requirements: 2.5, 2.6_

  - [x] 6.3 Verify preservation tests still pass
    - **Property 2: Preservation** - EqModal Functionality
    - **IMPORTANT**: Re-run the SAME test from task 2.2 - do NOT write a new test
    - Run preservation property test from step 2.2
    - **EXPECTED OUTCOME**: Test PASSES (confirms no regressions)
    - _Requirements: 3.4, 3.5, 3.6, 3.7, 3.8_

- [x] 7. Fix P2: EqModal render performance optimization

  - [x] 7.1 Optimize EqModal event handlers with useCallback
    - Create `handleEqGainChange = useCallback((index, value) => { ... }, [player])`
    - Use in EqSlider: `onChange={(e) => handleEqGainChange(indexMap[i], parseFloat(e.target.value))}`
    - Wrap all onChange/onInput handlers in useCallback
    - _Bug_Condition: C5 - New event handlers created on every render_
    - _Expected_Behavior: P5 - Event handlers memoized with useCallback_
    - _Preservation: EqModal functionality unchanged_
    - _Requirements: 2.7, 2.8, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 7.2 Remove inline style objects from EqModal
    - Replace `style={{ opacity: player.eqEnabled ? 1 : 0.4 }}` with styled-component prop
    - Add `$disabled` prop to EqSlider styled-component
    - Use `opacity: ${p => p.$disabled ? 0.4 : 1};` in styled-component
    - _Bug_Condition: C5 - New inline style objects created on every render_
    - _Expected_Behavior: P5 - No new objects created on render_
    - _Preservation: EqModal functionality unchanged_
    - _Requirements: 2.7, 2.8, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 7.3 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - No Unnecessary Object Creation in EqModal
    - **IMPORTANT**: Re-run the SAME test from task 1.5 - do NOT write a new test
    - Run bug condition exploration test from step 1.5
    - **EXPECTED OUTCOME**: Test PASSES (confirms no unnecessary re-renders)
    - _Requirements: 2.7, 2.8_

  - [x] 7.4 Verify preservation tests still pass
    - **Property 2: Preservation** - EqModal Functionality
    - **IMPORTANT**: Re-run the SAME test from task 2.2 - do NOT write a new test
    - Run preservation property test from step 2.2
    - **EXPECTED OUTCOME**: Test PASSES (confirms no regressions)
    - _Requirements: 3.4, 3.5, 3.6, 3.7, 3.8_

- [x] 8. Fix P2: SkinPicker conditional scrollIntoView

  - [x] 8.1 Verify and optimize scrollIntoView in SkinPicker
    - Verify current implementation has viewport check: `childRect.left < parentRect.left - 1 || childRect.right > parentRect.right + 1`
    - If viewport check exists, mark as already fixed
    - If not, add getBoundingClientRect() check before scrollIntoView
    - Ensure scrollIntoView is called ONLY if card is outside viewport
    - _Bug_Condition: C6 - scrollIntoView called even when card is visible_
    - _Expected_Behavior: P6 - scrollIntoView called only if card is outside viewport_
    - _Preservation: SkinPicker scroll behavior unchanged_
    - _Requirements: 2.9, 3.1, 3.2, 3.3_

  - [x] 8.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Conditional scrollIntoView in SkinPicker
    - **IMPORTANT**: Re-run the SAME test from task 1.6 - do NOT write a new test
    - Run bug condition exploration test from step 1.6
    - **EXPECTED OUTCOME**: Test PASSES (confirms conditional scrollIntoView)
    - _Requirements: 2.9_

  - [x] 8.3 Verify preservation tests still pass
    - **Property 2: Preservation** - SkinPicker Scroll Behavior
    - **IMPORTANT**: Re-run the SAME test from task 2.1 - do NOT write a new test
    - Run preservation property test from step 2.1
    - **EXPECTED OUTCOME**: Test PASSES (confirms no regressions)
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 9. Fix P2: EqModal single animation

  - [x] 9.1 Simplify framer-motion animation in EqModal
    - Choose Option A: Animate only overlay (opacity), remove animation from content
    - OR Option B: Animate only content (scale/y), make overlay instant
    - Recommended: Option A (simpler, less jarring)
    - Update AnimatePresence to animate only one element
    - Remove framer-motion props from the other element
    - _Bug_Condition: C7 - Both overlay and content animate simultaneously_
    - _Expected_Behavior: P7 - Only one element animates_
    - _Preservation: EqModal functionality unchanged_
    - _Requirements: 2.10, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 9.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Single Animation in EqModal
    - **IMPORTANT**: Re-run the SAME test from task 1.7 - do NOT write a new test
    - Run bug condition exploration test from step 1.7
    - **EXPECTED OUTCOME**: Test PASSES (confirms single animation)
    - _Requirements: 2.10_

  - [x] 9.3 Verify preservation tests still pass
    - **Property 2: Preservation** - EqModal Functionality
    - **IMPORTANT**: Re-run the SAME test from task 2.2 - do NOT write a new test
    - Run preservation property test from step 2.2
    - **EXPECTED OUTCOME**: Test PASSES (confirms no regressions)
    - _Requirements: 3.4, 3.5, 3.6, 3.7, 3.8_

## Phase 4: Final Validation

- [x] 10. Checkpoint - Ensure all tests pass
  - Run all bug condition exploration tests (tasks 1.1-1.7) → all should PASS
  - Run all preservation property tests (tasks 2.1-2.4) → all should PASS
  - Verify no regressions in SkinPicker, EqModal, offline.html functionality
  - Test on multiple skins (earflow, vinyl) to ensure consistency
  - Test on desktop and mobile devices
  - Ask the user if questions arise or if manual testing is needed
