# Bugfix Requirements Document

## Introduction

Этот багфикс устраняет критические функциональные баги, проблемы дизайна и производительности в Earflow плеере. Баги затрагивают переключение тем (SkinPicker), работу эквалайзера (EqModal), стилистику offline-страницы и производительность рендеринга. Приоритеты: P0 (функциональные баги) → P1 (дизайн/стилистика) → P2 (производительность).

## Bug Analysis

### Current Behavior (Defect)

#### P0 — Функциональные баги

**1.1 Темы не переключаются визуально (SkinPicker)**

1.1 WHEN пользователь кликает на карточку темы в SkinPicker THEN визуальное переключение темы не происходит из-за того, что любое pointer-move между down и up триггерит moved=true (DRAG_THRESHOLD_PX=4), что приводит к раннему выходу из handleCardClick без вызова setSkinId

1.2 WHEN пользователь кликает на карточку темы на desktop THEN клик не регистрируется из-за user-select: none; cursor: grab + pointer-capture, которые перехватывают событие click

**1.2 Пресеты EQ не двигают ползунки (EqModal)**

1.3 WHEN пользователь выбирает пресет эквалайзера (Flat/Bass/Treble/Vocal/Earflow) THEN ползунки не обновляются визуально, потому что setGains([0,0,...]) не доходит до player.eqGains или ползунок читает старое значение из player.eqGains

#### P1 — Дизайн/стилистика

**1.3 offline.html использует зелёный цвет**

1.4 WHEN пользователь видит offline.html страницу THEN страница отображается с зелёным цветом (#1db954 + green radial gradient), что противоречит монохромной стилистике сервиса (чёрный + белый)

**1.4 EqModal thumbs используют var(--color-primary)**

1.5 WHEN пользователь открывает эквалайзер на скине earflow THEN ползунки (thumbs) отображаются зелёными

1.6 WHEN пользователь открывает эквалайзер на скине vinyl THEN ползунки (thumbs) отображаются янтарными

1.7 WHEN ползунки должны быть белыми по умолчанию (как VolumeSlider в плеере) THEN они используют var(--color-primary), что нарушает брендбук

#### P2 — Производительность

**1.5 EqModal создаёт новые объекты при каждом render**

1.8 WHEN EqModal рендерится THEN при каждом render создаётся новый inline-объект style для каждого EqSlider

1.9 WHEN EqModal рендерится THEN обработчики onChange/onInput создаются без useCallback, что приводит к пересозданию всех EqSlider при drag'е одного слайдера

**1.6 SkinPicker scrollIntoView дёргает при каждом переключении**

1.10 WHEN пользователь переключает тему THEN scrollIntoView вызывается внутри useEffect при каждом переключении, даже если карточка уже в viewport

**1.7 framer-motion двойная анимация**

1.11 WHEN EqModal открывается/закрывается THEN framer-motion анимирует одновременно EqModalOverlay + EqModalContent, что создаёт двойную анимацию и лаг на слабых устройствах

---

### Expected Behavior (Correct)

#### P0 — Функциональные баги

**2.1 Темы переключаются визуально (SkinPicker)**

2.1 WHEN пользователь кликает на карточку темы в SkinPicker THEN визуальное переключение темы SHALL происходить немедленно, setSkinId SHALL вызываться без условий, связанных с drag-логикой

2.2 WHEN пользователь кликает на карточку темы на desktop THEN клик SHALL регистрироваться корректно без перехвата pointer-capture или user-select: none

**2.2 Пресеты EQ двигают ползунки (EqModal)**

2.3 WHEN пользователь выбирает пресет эквалайзера (Flat/Bass/Treble/Vocal/Earflow) THEN ползунки SHALL обновляться визуально, отражая значения из пресета, player.eqGains SHALL содержать актуальные значения

#### P1 — Дизайн/стилистика

**2.3 offline.html использует чёрно-белую гамму**

2.4 WHEN пользователь видит offline.html страницу THEN страница SHALL отображаться в монохромной стилистике (чёрный + белый), без зелёного цвета (#1db954) и green radial gradient

**2.4 EqModal thumbs белые по умолчанию**

2.5 WHEN пользователь открывает эквалайзер на любом скине THEN ползунки (thumbs) SHALL быть белыми по умолчанию, как VolumeSlider в плеере

2.6 WHEN ползунки используют цвет THEN они SHALL использовать #ffffff вместо var(--color-primary)

#### P2 — Производительность

**2.5 EqModal не создаёт новые объекты при каждом render**

2.7 WHEN EqModal рендерится THEN inline-объекты style SHALL быть минимизированы или вынесены в константы

2.8 WHEN EqModal рендерится THEN обработчики onChange/onInput SHALL быть обёрнуты в useCallback для предотвращения пересоздания

**2.6 SkinPicker scrollIntoView вызывается только при необходимости**

2.9 WHEN пользователь переключает тему THEN scrollIntoView SHALL вызываться только если карточка за пределами viewport

**2.7 framer-motion одиночная анимация**

2.10 WHEN EqModal открывается/закрывается THEN framer-motion SHALL анимировать только один элемент (либо overlay, либо content), чтобы избежать двойной анимации и лага

---

### Unchanged Behavior (Regression Prevention)

**3.1 SkinPicker функциональность**

3.1 WHEN пользователь скроллит карусель тем колесом мыши THEN вертикальный scroll SHALL CONTINUE TO конвертироваться в горизонтальный scroll (без Shift)

3.2 WHEN пользователь скроллит карусель тем на touch-устройстве THEN нативный horizontal overflow SHALL CONTINUE TO работать корректно

3.3 WHEN активная карточка темы отображается THEN она SHALL CONTINUE TO показывать галочку (FaCheck) и активный стиль

**3.2 EqModal функциональность**

3.4 WHEN пользователь открывает эквалайзер на мобильном устройстве THEN сообщение "Эквалайзер недоступен на мобильных устройствах" SHALL CONTINUE TO отображаться

3.5 WHEN пользователь изменяет ползунки эквалайзера THEN значения SHALL CONTINUE TO сохраняться в player.eqGains

3.6 WHEN пользователь выбирает пользовательский пресет (User 1-5) THEN пресет SHALL CONTINUE TO сохраняться в localStorage

3.7 WHEN пользователь изменяет скорость воспроизведения (Slowed/Normal/Sped) THEN playbackRate SHALL CONTINUE TO применяться корректно

3.8 WHEN пользователь переключает "Сохранять тон" THEN preservePitch SHALL CONTINUE TO работать корректно

**3.3 offline.html функциональность**

3.9 WHEN пользователь нажимает "Попробовать снова" на offline.html THEN страница SHALL CONTINUE TO перезагружаться при наличии сети

3.10 WHEN пользователь нажимает "Открыть скачанное" на offline.html THEN переход на "/" SHALL CONTINUE TO работать

3.11 WHEN браузер обнаруживает подключение к сети THEN страница SHALL CONTINUE TO автоматически перезагружаться

**3.4 Общая стилистика**

3.12 WHEN пользователь взаимодействует с другими элементами интерфейса (PlayPauseButton, ProgressFill, VolumeSlider) THEN их стилистика SHALL CONTINUE TO оставаться монохромной (белый на чёрном)

3.13 WHEN пользователь видит PartyBadge THEN зелёный цвет #1db954 SHALL CONTINUE TO использоваться как декоративный элемент (это исключение из монохромной стилистики)
