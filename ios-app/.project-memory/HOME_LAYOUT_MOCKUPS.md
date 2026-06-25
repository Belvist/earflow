# Home layout — варианты для ревью

**Дата:** 2026-06-23  
**Контекст:** feedback — «Для вас» слишком крупно, нет отступов между подборками, плейлисты не раскрываются, контент уходит под нижнюю навигацию, списки треков не унифицированы.

**Реализовано сейчас — вариант A (базовый).** Ниже B и C — альтернативы; если понравится — переключим.

---

## Вариант A — «Компакт + ритм» (текущий код)

| Элемент | Значение |
|---------|----------|
| «Для вас» | max **5** треков, обложка **44px**, `EarflowTrackRow` style `.queue` |
| Между секциями / рельсами | **28px** (`homeRailSpacing`) |
| Нижний inset скролла | nav **48** + mini **60** + gap **8** + extra **16** → `ShellChromeMetrics` |
| Плейлист-карточка | tap → **`/playlist/:id`** (отдельная страница), без play на карточке |
| Списки | единый `EarflowTrackRow` (queue / playlist) |

```
┌─────────────────────────┐
│ Earflow          [tabs] │
├─────────────────────────┤
│ ┌──── Hero 4:5 ────┐    │
│ └──────────────────┘    │
│                         │  ← 28px
│ Для вас                 │
│ ▢ track ×5 (compact)    │
│                         │  ← 28px
│ Настроения…             │
│                         │  ← 28px
│ Подборка 1  →→→         │
│                         │  ← 28px
│ Подборка 2  →→→         │
│                         │
│ [safe scroll padding]     │
├─────────────────────────┤
│ ▬ mini player           │
│ ⌂  👥  🔍  👤           │
└─────────────────────────┘
```

**Xcode Preview:** `HomeLayoutMockupVariantA` в `HomeLayoutMockups.swift`.

---

## Вариант B — «Плотнее, hero меньше»

Идея: больше контента на первом экране без скролла.

| Изменение | Значение |
|-----------|----------|
| Hero | ширина **88%** экрана, radius **14** |
| «Для вас» | **3** трека + ссылка «Ещё» → sheet очереди |
| Рельсы | карточки **102px**, spacing **10px** |
| Секции | **20px** вместо 28px |

Плюс: быстрее видны подборки. Минус: hero слабее как focal point.

**Preview:** `HomeLayoutMockupVariantB`.

---

## Вариант C — «Карточка очереди»

Идея: «Для вас» как одна карточка с фоном `#141414`, внутри список без разделителей.

| Изменение | Значение |
|-----------|----------|
| «Для вас» | `RoundedRectangle` padding 12, **6** треков |
| Рельсы | чередование playlist / track rail с **разделителем** 1px opacity 0.06 (не stroke border — fill line) |
| Popular artists | перенос **под** все рельсы |

Плюс: визуально отделяет очередь от каталога. Минус: +1 визуальный слой.

**Preview:** `HomeLayoutMockupVariantC`.

---

## Как выбрать

1. Открой в Xcode: `Earflow/Features/Home/HomeLayoutMockups.swift` → Canvas → три preview.
2. Напиши: **A / B / C** или комбинацию (например «A + hero из B»).

## Файлы реализации (вариант A)

- `EarflowTheme.swift` — `homeRailSpacing`, `trackRowCoverWidth`, `homeQueueMaxTracks`
- `ShellChromeMetrics.swift` + `MainShellView` environment
- `EarflowTrackRow.swift` — единый row + `HomeSectionTitle`
- `PlaylistPageView.swift` + `CatalogService.fetchPlaylist`
- `HomeView.swift` — spacing, sheet, bottom inset
