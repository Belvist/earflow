# E2E тесты Earflow

## Быстрый выбор

| Цель | Команда |
|------|---------|
| CI / перед merge (быстро, headless) | `npm run test:local` |
| Жесты mini-bar | `npm run test:e2e:gestures` |
| Главная + mock API | `npm run test:e2e:homepage` |
| **Смотреть глазами + скриншоты для AI** | `npm run test:e2e:visual` |
| Полный visual прогон + отчёт | `npm run test:e2e:visual:run` |
| Пошагово в UI | `npm run test:e2e:ui` |

Установка один раз: `npm run test:e2e:install`

Dev server: Playwright поднимает `npm start` сам (порт **3000**). Можно заранее запустить `npm start` — будет переиспользован.

---

## Visual mode (локально, с браузером и скриншотами)

```powershell
cd frontend

# Короткий walkthrough: playground → guest home → home с mock API
# Браузер виден, slowMo ~220ms, скриншот на каждом шаге
npm run test:e2e:visual

# Весь player suite (gestures + homepage) с видео/скриншотами
npm run test:e2e:visual:player

# Прогон + открыть HTML-отчёт
npm run test:e2e:visual:run
```

### Куда складываются артефакты

```
frontend/e2e/artifacts/
  report/index.html          ← открыть в браузере
  visual-manifest.json       ← список скриншотов/видео для агента
  test-results/              ← PNG, webm, trace.zip по каждому тесту
```

Открыть отчёт вручную:

```powershell
npm run test:e2e:visual:open
```

### Как отдать результат агенту

После прогона приложи или укажи путь:

- `frontend/e2e/artifacts/visual-manifest.json`
- или конкретные PNG из `frontend/e2e/artifacts/test-results/`

В manifest перечислены все шаги (`01-playground-mini-bar`, `07-home-with-tracks`, …) с путями к файлам.

Замедлить жесты (мс между действиями):

```powershell
$env:E2E_SLOW_MO=400; npm run test:e2e:visual
```

---

## Headless (быстро)

```powershell
npm run test:e2e:gestures
npm run test:e2e:homepage
npm run test:e2e:all
npm run test:local
```

HTML-отчёт headless: `npm run test:e2e:report` → `e2e/report/index.html`

---

## Что чем проверяется

| Слой | Файлы | Backend |
|------|-------|---------|
| Playground жесты | `gestures.spec.js` | не нужен |
| Главная prod-like | `homepage-health.spec.js`, `homepage-gestures.spec.js` | mock API в тесте |
| Smoke «не зависает» | smoke в `gestures.spec.js` | не нужен |
| Visual walkthrough | `visual-walkthrough.spec.js` | mock только на шаге 7+ |
| Реальная жизнь | руками + `docker compose up -d` + login | нужен |

---

## Один тест

```powershell
npx playwright test e2e/gestures.spec.js -g "Tap на mini-bar"
npx playwright test e2e/visual-walkthrough.spec.js --config playwright.visual.config.js --headed
```
