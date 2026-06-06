# Генерация PNG иконок для PWA

Файлы `public/logo512.svg` и `public/logo192.svg` — основа для приложения. Для идеальной совместимости с iOS Safari нужны PNG варианты.

## Вариант 1: Онлайн-сервис (быстро)

1. Откройте https://realfavicongenerator.net/
2. Загрузите `frontend/public/logo512.svg`
3. Настройте iOS: background `#000000`, padding 10%
4. Сгенерируйте и распакуйте в `frontend/public/`
5. Должны появиться: `apple-touch-icon-180x180.png`, `apple-touch-icon-167x167.png`, `apple-touch-icon-152x152.png`, `android-chrome-192x192.png`, `android-chrome-512x512.png`

## Вариант 2: `pwa-asset-generator` (локально, требует Node)

```bash
npx pwa-asset-generator@latest public/logo512.svg public/ ^
  --icon-only ^
  --favicon ^
  --opaque true ^
  --background "#000000" ^
  --padding "10%" ^
  --path-override "%PUBLIC_URL%"
```

## Вариант 3: ImageMagick (если установлен)

```powershell
magick convert -background "#000000" -density 600 public/logo512.svg -resize 512x512 public/icon-512.png
magick convert -background "#000000" -density 600 public/logo512.svg -resize 192x192 public/icon-192.png
magick convert -background "#000000" -density 600 public/logo512.svg -resize 180x180 public/apple-touch-icon-180.png
magick convert -background "#000000" -density 600 public/logo512.svg -resize 167x167 public/apple-touch-icon-167.png
magick convert -background "#000000" -density 600 public/logo512.svg -resize 152x152 public/apple-touch-icon-152.png
```

## После генерации: обновить manifest.json

Добавьте в `icons` массив:

```json
{
  "src": "icon-192.png",
  "type": "image/png",
  "sizes": "192x192",
  "purpose": "any"
},
{
  "src": "icon-512.png",
  "type": "image/png",
  "sizes": "512x512",
  "purpose": "any maskable"
}
```

И в `public/index.html` замените SVG ссылки на PNG:

```html
<link rel="apple-touch-icon" sizes="152x152" href="%PUBLIC_URL%/apple-touch-icon-152.png" />
<link rel="apple-touch-icon" sizes="167x167" href="%PUBLIC_URL%/apple-touch-icon-167.png" />
<link rel="apple-touch-icon" sizes="180x180" href="%PUBLIC_URL%/apple-touch-icon-180.png" />
```

## Когда это нужно

- **Обязательно:** перед публичным запуском PWA на iOS Safari < 15
- **Желательно:** для лучшего рендера на Android Chrome lockscreen
- **Не критично сейчас:** SVG работает на современных iOS 15+/Android 11+ Chrome
