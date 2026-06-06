# Earflow Theme/EQ/Performance Bugfix Design

## Overview

Этот багфикс устраняет критические функциональные баги, проблемы дизайна и производительности в Earflow плеере. Основные проблемы:

- **P0 (Функциональные баги)**: Темы не переключаются в SkinPicker из-за конфликта drag-логики с click-событиями; пресеты эквалайзера не обновляют ползунки визуально
- **P1 (Дизайн/стилистика)**: offline.html использует зелёный цвет вместо монохромной стилистики; ползунки эквалайзера используют `var(--color-primary)` вместо белого цвета
- **P2 (Производительность)**: EqModal создаёт новые объекты при каждом render; SkinPicker вызывает scrollIntoView при каждом переключении; framer-motion создаёт двойную анимацию

Стратегия исправления: устранить конфликт drag/click в SkinPicker, исправить обновление состояния в EqModal, привести стилистику к монохромной гамме, оптимизировать рендеринг через useCallback/useMemo и условный scrollIntoView.

## Glossary

- **Bug_Condition (C)**: Условие, при котором проявляется баг
  - **C1**: Клик на карточку темы в SkinPicker (drag-логика блокирует setSkinId)
  - **C2**: Выбор пресета эквалайзера (ползунки не обновляются визуально)
  - **C3**: Отображение offline.html (зелёный цвет вместо монохромного)
  - **C4**: Отображение ползунков эквалайзера (используют var(--color-primary) вместо белого)
  - **C5**: Рендеринг EqModal (создаются новые объекты при каждом render)
  - **C6**: Переключение темы в SkinPicker (scrollIntoView вызывается всегда)
  - **C7**: Открытие/закрытие EqModal (двойная анимация overlay + content)
- **Property (P)**: Желаемое поведение при выполнении Bug_Condition
  - **P1**: Клик на карточку темы должен переключать тему немедленно
  - **P2**: Выбор пресета должен обновлять ползунки визуально
  - **P3**: offline.html должен использовать монохромную стилистику (чёрный + белый)
  - **P4**: Ползунки эквалайзера должны быть белыми по умолчанию
  - **P5**: EqModal не должен создавать новые объекты при каждом render
  - **P6**: scrollIntoView должен вызываться только если карточка за пределами viewport
  - **P7**: framer-motion должен анимировать только один элемент
- **Preservation**: Существующее поведение, которое должно остаться неизменным
  - Scroll колесом мыши в SkinPicker (вертикальный → горизонтальный)
  - Touch-scroll в SkinPicker
  - Функциональность эквалайзера (сохранение в localStorage, playbackRate, preservePitch)
  - Функциональность offline.html (кнопки "Попробовать снова", "Открыть скачанное")
  - Монохромная стилистика других элементов интерфейса
- **SkinPicker**: Компонент горизонтальной snap-карусели тем в `frontend/src/skins/SkinPicker.tsx`
- **EqModal**: Модальное окно эквалайзера в `frontend/src/components/EqModal.js`
- **offline.html**: Offline-страница в `frontend/public/offline.html`
- **drag-логика**: Механизм определения drag vs click через moved флаг и DRAG_THRESHOLD_PX
- **pointer-capture**: API браузера для захвата pointer-событий (setPointerCapture)
- **user-select: none**: CSS-свойство, блокирующее выделение текста (может блокировать click)
- **framer-motion**: Библиотека анимаций React (AnimatePresence, motion.div)

## Bug Details

### Bug Condition

Баги проявляются в трёх категориях: функциональные (P0), дизайн/стилистика (P1), производительность (P2).

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type UserInteraction | RenderEvent | DisplayEvent
  OUTPUT: boolean
  
  RETURN (
    // P0: Функциональные баги
    (input.type == 'click' AND input.target == 'SkinCard' AND NOT themeChanged) OR
    (input.type == 'click' AND input.target == 'PresetChip' AND NOT slidersUpdated) OR
    
    // P1: Дизайн/стилистика
    (input.type == 'display' AND input.page == 'offline.html' AND colorScheme == 'green') OR
    (input.type == 'display' AND input.element == 'EqSlider thumb' AND color == 'var(--color-primary)') OR
    
    // P2: Производительность
    (input.type == 'render' AND input.component == 'EqModal' AND newObjectsCreated) OR
    (input.type == 'themeSwitch' AND scrollIntoViewCalled AND cardInViewport) OR
    (input.type == 'modalToggle' AND animatedElements > 1)
  )
END FUNCTION
```

### Examples

**P0 — Функциональные баги:**

- **Пример 1.1**: Пользователь кликает на карточку темы "Vinyl" в SkinPicker → тема не переключается, потому что любое pointer-move между down и up (даже на 1px) устанавливает `moved=true`, что приводит к раннему выходу из `handleCardClick` без вызова `setSkinId`
  - **Ожидается**: Тема переключается на "Vinyl" немедленно
  - **Фактически**: Тема остаётся прежней, `setSkinId` не вызывается

- **Пример 1.2**: Пользователь кликает на карточку темы "Earflow" на desktop → клик не регистрируется из-за `user-select: none; cursor: grab` + pointer-capture, которые перехватывают событие click
  - **Ожидается**: Тема переключается на "Earflow"
  - **Фактически**: Клик не регистрируется, событие перехватывается drag-логикой

- **Пример 1.3**: Пользователь выбирает пресет "Bass" в эквалайзере → ползунки не двигаются визуально, хотя `setGains([6, 5, 3, 1, 0, -1, -2, -2, -2, -2])` вызывается
  - **Ожидается**: Ползунки обновляются, отражая значения [6, 5, 3, 1, 0, -1, -2, -2, -2, -2]
  - **Фактически**: Ползунки остаются на прежних позициях, `player.eqGains` не обновляется или ползунок читает старое значение

**P1 — Дизайн/стилистика:**

- **Пример 1.4**: Пользователь видит offline.html → страница отображается с зелёным цветом (#1db954) и green radial gradient
  - **Ожидается**: Страница в монохромной стилистике (чёрный + белый)
  - **Фактически**: Зелёный цвет нарушает брендбук

- **Пример 1.5**: Пользователь открывает эквалайзер на скине "Earflow" → ползунки (thumbs) зелёные
  - **Ожидается**: Ползунки белые (#ffffff)
  - **Фактически**: Ползунки используют `var(--color-primary)` = #1db954

**P2 — Производительность:**

- **Пример 1.6**: Пользователь двигает ползунок эквалайзера → все 7 ползунков пересоздаются при каждом onChange, потому что обработчики не обёрнуты в useCallback
  - **Ожидается**: Пересоздаётся только изменённый ползунок
  - **Фактически**: Все ползунки пересоздаются, что вызывает лаг на слабых устройствах

- **Пример 1.7**: Пользователь переключает тему с "Earflow" на "Vinyl" → scrollIntoView вызывается, хотя карточка "Vinyl" уже в viewport
  - **Ожидается**: scrollIntoView не вызывается, если карточка видна
  - **Фактически**: scrollIntoView вызывается всегда, создавая ненужную анимацию

**Edge cases:**

- **Edge case 1**: Пользователь кликает на карточку темы с минимальным движением мыши (1-2px) → баг проявляется, потому что DRAG_THRESHOLD_PX=4 слишком чувствителен
- **Edge case 2**: Пользователь выбирает пользовательский пресет "User 1" → ползунки должны обновиться, если пресет сохранён в localStorage
- **Edge case 3**: Пользователь открывает эквалайзер на мобильном устройстве → ползунки не отображаются (сообщение "Эквалайзер недоступен на мобильных устройствах"), но стилистика должна быть корректной

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Scroll колесом мыши в SkinPicker должен продолжать конвертировать вертикальный scroll в горизонтальный (без Shift)
- Touch-scroll в SkinPicker должен продолжать работать корректно через нативный horizontal overflow
- Активная карточка темы должна продолжать показывать галочку (FaCheck) и активный стиль
- Эквалайзер на мобильных устройствах должен продолжать показывать сообщение "Эквалайзер недоступен на мобильных устройствах"
- Значения эквалайзера должны продолжать сохраняться в `player.eqGains`
- Пользовательские пресеты (User 1-5) должны продолжать сохраняться в localStorage
- Скорость воспроизведения (Slowed/Normal/Sped) должна продолжать применяться корректно
- Переключатель "Сохранять тон" (preservePitch) должен продолжать работать
- Кнопка "Попробовать снова" на offline.html должна продолжать перезагружать страницу при наличии сети
- Кнопка "Открыть скачанное" на offline.html должна продолжать переходить на "/"
- Автоматическая перезагрузка offline.html при обнаружении сети должна продолжать работать
- Монохромная стилистика других элементов интерфейса (PlayPauseButton, ProgressFill, VolumeSlider) должна оставаться неизменной
- PartyBadge должен продолжать использовать зелёный цвет #1db954 как декоративный элемент (исключение из монохромной стилистики)

**Scope:**
Все входные данные, которые НЕ связаны с багами (клик на карточку темы, выбор пресета эквалайзера, отображение offline.html, отображение ползунков эквалайзера, рендеринг EqModal, переключение темы, открытие/закрытие модального окна), должны быть полностью не затронуты этим исправлением. Это включает:
- Взаимодействие с другими элементами интерфейса (кнопки воспроизведения, громкость, прогресс-бар)
- Функциональность плеера (воспроизведение, пауза, переключение треков)
- Сохранение настроек в localStorage (пользовательские пресеты, выбранная тема)

## Hypothesized Root Cause

На основе анализа кода и описания багов, наиболее вероятные причины:

1. **SkinPicker: Конфликт drag-логики с click-событиями**
   - В текущей версии SkinPicker.tsx отсутствует drag-логика (нет pointer-capture, нет moved флага)
   - Однако в bugfix.md упоминается, что "любое pointer-move между down и up триггерит moved=true"
   - **Гипотеза**: В предыдущей версии была реализована drag-логика, которая блокировала click-события
   - **Альтернативная гипотеза**: Проблема может быть в `user-select: none; cursor: grab`, которые перехватывают click на desktop

2. **EqModal: Пресеты не обновляют player.eqGains**
   - Функция `setGains` вызывает `player.setEqGains(next)` или `player.onEqGainChange?.(i, next[i])`
   - Ползунки читают значения из `player.eqGains[indexMap[i]]`
   - **Гипотеза**: `player.setEqGains` не обновляет `player.eqGains` синхронно, или React не перерендеривает ползунки после обновления
   - **Альтернативная гипотеза**: `indexMap` может быть некорректным, или `normalizeGains` обнуляет некоторые значения (строка `out[5] = 0; out[6] = 0; out[8] = 0;`)

3. **offline.html: Зелёный цвет в стилях**
   - В текущей версии offline.html используется белый цвет для кнопки `.btn-primary` (`background: #ffffff; color: #000000;`)
   - Красный цвет для индикатора офлайн-режима (`.dot { background: #ef4444; }`)
   - **Гипотеза**: В bugfix.md ошибочно указано, что используется зелёный цвет, или это устаревшая информация
   - **Альтернативная гипотеза**: Зелёный цвет может быть в другой части offline.html (например, в radial gradient), которая не видна в текущем коде

4. **EqModal: Ползунки используют var(--color-primary)**
   - В EqSlider и EqHSlider используется `background: var(--color-primary, #ffffff);`
   - Fallback #ffffff применяется только если `--color-primary` не определён
   - **Гипотеза**: CSS-переменная `--color-primary` определена глобально (в скинах), поэтому fallback не срабатывает
   - **Решение**: Заменить `var(--color-primary, #ffffff)` на `#ffffff` напрямую

5. **EqModal: Новые объекты при каждом render**
   - Inline-объект `style={{ opacity: player.eqEnabled ? 1 : 0.4 }}` создаётся при каждом render
   - Обработчики `onChange` и `onInput` не обёрнуты в useCallback
   - **Гипотеза**: Каждый render EqModal пересоздаёт все обработчики, что приводит к пересозданию всех ползунков
   - **Решение**: Обернуть обработчики в useCallback, вынести inline-стили в константы или styled-components

6. **SkinPicker: scrollIntoView вызывается всегда**
   - В useEffect нет проверки, находится ли карточка в viewport
   - **Гипотеза**: scrollIntoView вызывается при каждом изменении `skinId`, даже если карточка уже видна
   - **Решение**: Добавить проверку `getBoundingClientRect()` перед вызовом scrollIntoView (уже реализовано в текущей версии!)

7. **framer-motion: Двойная анимация**
   - EqModalOverlay и EqModalContent оба анимируются через framer-motion
   - **Гипотеза**: Одновременная анимация двух элементов создаёт лаг на слабых устройствах
   - **Решение**: Анимировать только один элемент (либо overlay с opacity, либо content с scale/y)

## Correctness Properties

Property 1: Bug Condition - Theme Switching Works

_For any_ user interaction where a theme card is clicked in SkinPicker, the fixed code SHALL immediately call `setSkinId` with the selected theme ID, causing the theme to switch visually without being blocked by drag-logic or pointer-capture.

**Validates: Requirements 2.1, 2.2**

Property 2: Bug Condition - EQ Presets Update Sliders

_For any_ user interaction where an EQ preset (Flat/Bass/Treble/Vocal/Earflow/User) is selected, the fixed code SHALL update `player.eqGains` with the preset values AND trigger a re-render of all EQ sliders to reflect the new positions visually.

**Validates: Requirements 2.3**

Property 3: Bug Condition - Monochrome Styling for offline.html

_For any_ display of offline.html page, the fixed code SHALL use only black (#000) and white (#fff) colors, removing any green (#1db954) or green radial gradients, to maintain the monochrome brand style.

**Validates: Requirements 2.4**

Property 4: Bug Condition - White EQ Slider Thumbs

_For any_ display of EQ sliders in EqModal, the fixed code SHALL render slider thumbs with white color (#ffffff) instead of `var(--color-primary)`, matching the VolumeSlider style in the player.

**Validates: Requirements 2.5, 2.6**

Property 5: Bug Condition - No Unnecessary Object Creation in EqModal

_For any_ render of EqModal component, the fixed code SHALL NOT create new inline style objects or new event handler functions, using useCallback/useMemo to prevent unnecessary re-renders of child components.

**Validates: Requirements 2.7, 2.8**

Property 6: Bug Condition - Conditional scrollIntoView in SkinPicker

_For any_ theme switch in SkinPicker, the fixed code SHALL call scrollIntoView ONLY if the target card is outside the viewport, preventing unnecessary scroll animations when the card is already visible.

**Validates: Requirements 2.9**

Property 7: Bug Condition - Single Animation in EqModal

_For any_ opening or closing of EqModal, the fixed code SHALL animate only one element (either overlay OR content, not both), reducing animation overhead and preventing lag on weak devices.

**Validates: Requirements 2.10**

Property 8: Preservation - SkinPicker Scroll Behavior

_For any_ user interaction with SkinPicker that does NOT involve clicking a theme card (wheel scroll, touch scroll, keyboard navigation), the fixed code SHALL produce exactly the same behavior as the original code, preserving vertical-to-horizontal wheel conversion, touch-scroll, and active card styling.

**Validates: Requirements 3.1, 3.2, 3.3**

Property 9: Preservation - EqModal Functionality

_For any_ user interaction with EqModal that does NOT involve selecting a preset (changing individual sliders, toggling EQ on/off, changing playback rate, toggling preservePitch, saving user presets), the fixed code SHALL produce exactly the same behavior as the original code, preserving localStorage persistence, mobile device message, and all existing functionality.

**Validates: Requirements 3.4, 3.5, 3.6, 3.7, 3.8**

Property 10: Preservation - offline.html Functionality

_For any_ user interaction with offline.html that does NOT involve visual styling (clicking "Попробовать снова", clicking "Открыть скачанное", automatic reload on network detection), the fixed code SHALL produce exactly the same behavior as the original code, preserving all button functionality and network detection logic.

**Validates: Requirements 3.9, 3.10, 3.11**

Property 11: Preservation - General UI Styling

_For any_ display of UI elements that are NOT EqModal sliders or offline.html (PlayPauseButton, ProgressFill, VolumeSlider, PartyBadge), the fixed code SHALL produce exactly the same styling as the original code, preserving monochrome styling for most elements and green accent for PartyBadge.

**Validates: Requirements 3.12, 3.13**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `frontend/src/skins/SkinPicker.tsx`

**Function**: `SkinPicker` component

**Specific Changes**:
1. **Verify drag-logic absence**: Confirm that current version has no drag-logic (no pointer-capture, no moved flag)
   - Current code already uses simple `onClick` handler without drag interference
   - If bug still exists, investigate `user-select: none` or `cursor: grab` in styled-components

2. **Verify scrollIntoView optimization**: Confirm that current version already has viewport check
   - Current code already has `outOfView` check: `childRect.left < parentRect.left - 1 || childRect.right > parentRect.right + 1`
   - This should prevent unnecessary scrollIntoView calls

3. **No changes needed**: Current SkinPicker.tsx implementation appears correct
   - Simple onClick handler without drag interference
   - Conditional scrollIntoView with viewport check
   - If bug persists, investigate parent component or CSS issues

---

**File**: `frontend/src/components/EqModal.js`

**Function**: `EqModal` component

**Specific Changes**:
1. **Fix preset application**: Ensure `setGains` updates `player.eqGains` synchronously
   - Investigate `player.setEqGains` implementation in PlayerContext
   - Add force re-render if needed (e.g., `setSelectedPreset` after `setGains`)
   - Verify that `indexMap` is correct: `[0, 1, 2, 3, 4, 7, 9]` for frequencies `[60, 170, 310, 600, 1000, 10000, 16000]`

2. **Replace var(--color-primary) with #ffffff**: Change slider thumb colors to white
   - In `EqHSlider`: `background: var(--color-primary, #ffffff);` → `background: #ffffff;`
   - In `EqSlider`: `background: var(--color-primary, #ffffff);` → `background: #ffffff;`
   - Remove fallback, use white directly

3. **Optimize event handlers with useCallback**: Wrap onChange/onInput handlers
   - Create `handleEqGainChange = useCallback((index, value) => { ... }, [player])`
   - Use in EqSlider: `onChange={(e) => handleEqGainChange(indexMap[i], parseFloat(e.target.value))}`

4. **Remove inline style objects**: Replace `style={{ opacity: player.eqEnabled ? 1 : 0.4 }}` with styled-component prop
   - Add `$disabled` prop to EqSlider styled-component
   - Use `opacity: ${p => p.$disabled ? 0.4 : 1};` in styled-component

5. **Simplify framer-motion animation**: Animate only overlay OR content, not both
   - Option A: Animate only overlay (opacity), remove animation from content
   - Option B: Animate only content (scale/y), make overlay instant
   - Recommended: Option A (simpler, less jarring)

---

**File**: `frontend/public/offline.html`

**Function**: N/A (static HTML)

**Specific Changes**:
1. **Verify monochrome styling**: Check if green color exists in current version
   - Current `.btn-primary` uses white (#ffffff), not green
   - Current `.dot` uses red (#ef4444) for offline indicator
   - If green exists in radial gradient or other elements, replace with white/gray

2. **No changes needed**: Current offline.html appears to use monochrome styling
   - If bug report is outdated, mark as resolved
   - If green color exists elsewhere, replace with `rgba(255, 255, 255, 0.04)` or similar

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bugs on unfixed code, then verify the fixes work correctly and preserve existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bugs BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that simulate user interactions for each bug category (P0, P1, P2) and assert expected behavior. Run these tests on the UNFIXED code to observe failures and understand the root causes.

**Test Cases**:
1. **SkinPicker Theme Switch Test**: Simulate clicking on a theme card and assert `setSkinId` is called (will fail on unfixed code if drag-logic blocks click)
2. **EqModal Preset Test**: Simulate selecting "Bass" preset and assert slider values update to [6, 5, 3, 1, 0, -1, -2, -2, -2, -2] (will fail on unfixed code if sliders don't update)
3. **offline.html Styling Test**: Load offline.html and assert no green colors (#1db954) are present (will fail on unfixed code if green exists)
4. **EqModal Slider Color Test**: Render EqModal and assert slider thumbs use #ffffff, not var(--color-primary) (will fail on unfixed code)
5. **EqModal Render Performance Test**: Render EqModal, change one slider, assert other sliders don't re-render (will fail on unfixed code if handlers not memoized)
6. **SkinPicker scrollIntoView Test**: Switch theme when card is in viewport, assert scrollIntoView is NOT called (will fail on unfixed code if no viewport check)
7. **EqModal Animation Test**: Open EqModal, count animated elements, assert only 1 element animates (will fail on unfixed code if both overlay and content animate)

**Expected Counterexamples**:
- SkinPicker: `setSkinId` not called when card is clicked (drag-logic interference)
- EqModal: Slider values don't update after preset selection (state update issue)
- offline.html: Green color (#1db954) present in styling (outdated design)
- EqModal: Slider thumbs use green/amber color instead of white (var(--color-primary) issue)
- EqModal: All sliders re-render when one slider changes (no useCallback)
- SkinPicker: scrollIntoView called even when card is visible (no viewport check)
- EqModal: Both overlay and content animate simultaneously (double animation)

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedCode(input)
  ASSERT expectedBehavior(result)
END FOR
```

**Specific Tests:**
- **P0 Tests**: Click theme card → assert theme switches; select preset → assert sliders update
- **P1 Tests**: Load offline.html → assert monochrome styling; render EqModal → assert white slider thumbs
- **P2 Tests**: Render EqModal → assert no new objects created; switch theme → assert conditional scrollIntoView; open modal → assert single animation

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalCode(input) = fixedCode(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for non-bug interactions, then write property-based tests capturing that behavior.

**Test Cases**:
1. **SkinPicker Scroll Preservation**: Observe that wheel scroll (vertical → horizontal) works on unfixed code, then write test to verify this continues after fix
2. **SkinPicker Touch Preservation**: Observe that touch-scroll works on unfixed code, then write test to verify this continues after fix
3. **EqModal Functionality Preservation**: Observe that individual slider changes, playback rate, preservePitch, localStorage persistence work on unfixed code, then write tests to verify these continue after fix
4. **offline.html Functionality Preservation**: Observe that "Попробовать снова" and "Открыть скачанное" buttons work on unfixed code, then write tests to verify these continue after fix
5. **General UI Styling Preservation**: Observe that PlayPauseButton, ProgressFill, VolumeSlider, PartyBadge styling is correct on unfixed code, then write tests to verify these continue after fix

### Unit Tests

- Test SkinPicker theme switching with click events
- Test EqModal preset selection and slider updates
- Test offline.html button functionality ("Попробовать снова", "Открыть скачанное")
- Test EqModal slider color rendering (white vs var(--color-primary))
- Test edge cases (minimal mouse movement in SkinPicker, user presets in EqModal, network detection in offline.html)

### Property-Based Tests

- Generate random theme selections and verify setSkinId is called correctly
- Generate random EQ preset selections and verify slider values update correctly
- Generate random EqModal renders and verify no unnecessary re-renders occur
- Test that all non-buggy inputs (wheel scroll, touch scroll, individual slider changes) continue to work across many scenarios

### Integration Tests

- Test full theme switching flow (click card → theme changes → scrollIntoView if needed)
- Test full EQ preset flow (select preset → sliders update → save to localStorage)
- Test full offline.html flow (load page → click buttons → network detection)
- Test that visual styling is consistent across all components after fix
