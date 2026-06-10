# Earflow listener UI — деплой

## Важно: две ветки

| Ветка | Содержимое |
|-------|------------|
| **`main`** | всё (backend + UI). **На VPS деплой UI — из `main`** (после merge UI). |
| **`frontend`** | только UI-коммиты (разработка). Периодически мержится в `main`. |

После merge UI в `main` на сервере **не нужно** `git checkout frontend`.

## Git: конфликт имени `frontend`

В репозитории есть папка `frontend/`. Команда `git checkout frontend` может упасть:

```text
fatal: 'frontend' could be both a local file and a tracking branch
```

**Используй:**

```bash
git switch frontend          # предпочтительно
# или на main просто:
git pull origin main         # UI уже в main после merge
```

## Сервер (VPS) — UI из main (рекомендуется)

```bash
cd /opt/music-platform
git fetch origin
git checkout main
git pull origin main
git rev-parse --short HEAD   # запомни SHA

docker compose build --no-cache frontend
docker compose up -d --force-recreate frontend

# проверка build hints (v67+ после merge UI)
curl -sS https://earflow.ru/ | grep -o 'data-mini-bar-ui="[^"]*"' | head -1
# ожидаем: data-mini-bar-ui="2026-06-v71-smooth-pass"
curl -sS https://earflow.ru/ | grep -o 'data-mobile-nav-ui="[^"]*"' | head -1
# ожидаем: data-mobile-nav-ui="2026-06-v71-smooth-pass"
```

Если `platform-control.sh: Permission denied`:

```bash
chmod +x scripts/platform-control.sh
bash scripts/platform-control.sh build frontend
```

## Сервер — только ветка frontend (DEV / стенд, не prod)

> **Не использовать для earflow.ru prod.** Prod UI — только `main` (см. выше).

```bash
cd /opt/music-platform
git fetch origin
git switch frontend || git switch -c frontend origin/frontend
git pull origin frontend
docker compose build --no-cache frontend
docker compose up -d --force-recreate frontend
```

## Локально (разработка UI)

```bash
git switch frontend
git pull origin frontend
# правки в frontend/ ...
git commit -am "fix(frontend): …"
git push origin frontend
# merge frontend → main перед prod (обязательно)
git switch main && git merge frontend && git push origin main
git push origin main:frontend   # держим ветки на одном SHA
```

Проверка на телефоне: `[data-testid="mini-player-bar"]` → `data-mini-bar-ui`.

### Чеклист mobile chrome (v71)

1. **Навбар** — solid `#0D0D0D` до низа экрана, tap-only; иконка сжимается при нажатии (scale 0.82) и пружинит обратно.
2. **Переход вкладок** — новая страница появляется fade 0.2s; нет чёрного экрана «Загрузка...» при быстрой загрузке.
3. **Мини-бар** — progress 2px серый track; обложка при смене трека появляется fade 0.24s.
4. **Плеер (шит)** — кнопки реагируют на нажатие мгновенно (transform 0.12s, без `transition: all`).
5. **Build hints:** `data-mini-bar-ui="2026-06-v71-smooth-pass"`, `data-mobile-nav-ui="2026-06-v71-smooth-pass"`.
6. **Токены:** `mobileChromeTokens.js` — высота nav + float gap.
