# Earflow listener UI — деплой (ветка `frontend`)

## Git

- **`frontend`** — все коммиты UI (`frontend/`, `artist-frontend/`)
- **`main`** — backend/gateway/ops (без правок SPA)

```bash
git checkout frontend
git pull origin frontend
git push origin frontend
```

## Сервер (VPS)

```bash
cd /opt/music-platform
git fetch origin
git checkout frontend
git pull origin frontend
./scripts/platform-control.sh build frontend
docker compose up -d frontend
```

Проверка: `data-mini-bar-ui` на `[data-testid="mini-player-bar"]` (DevTools).

Cursor rule (локально у разработчика): `.cursor/rules/earflow-frontend-branch.mdc`
