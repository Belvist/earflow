# prerender-service — service context card

**Stack:** Node 22 + Puppeteer (Chromium)
**Status:** production
**Owners:** SEO

## Назначение

Headless Chromium-рендер публичных страниц для поисковых ботов (Googlebot, YandexBot, Bingbot, Facebook, Twitter, VK, WhatsApp). Возвращает готовый HTML с отрендеренным React-контентом (title, H1, текст, JSON-LD), чтобы боты индексировали SPA без исполнения JS.

**Потребители:** nginx (earflow.ru), только по `User-Agent` ботов, только GET, только whitelist путей (`/`, `/music/*`, `/artist/*`, `/album/*`, `/about`, легальные).

## Public API

| Method | Path | Auth | Назначение |
|---|---|---|---|
| GET | `/render?url=...` | **none** (internal) | Вернёт отрендеренный HTML. Whitelist host: `frontend:3004`. |
| GET | `/health` | none | liveness |

## Owns (что хранит)

In-memory LRU `pageCache` (max 100 страниц, TTL 1h, stale-while-revalidate). Ничего персистентного.

## Ключевые переменные

| Env | Default | Назначение |
|---|---|---|
| `PORT` | `3100` | HTTP listen |
| `PRERENDER_ALLOWED_HOSTS` | `frontend:3004` | Whitelist origin (SSRF защита) |
| `PRERENDER_NAV_TIMEOUT_MS` | `8000` | Таймаут `page.goto` (domcontentloaded) |
| `PRERENDER_SETTLE_MS` | `700` | Фикс. ожидание после React mount (`waitForFunction(h1)` уже ждёт контент) |
| `PRERENDER_CONTENT_TITLE_TIMEOUT_MS` | `6000` | Ожидание H1/контента на SPA-страницах |
| `PRERENDER_PAGE_CACHE_TTL_MS` | `3600000` | TTL in-memory кэша (1h) |
| `PRERENDER_MAX_CONCURRENT` | `1` | Один context за раз; очередь → 503 → nginx отдаёт SPA |

## Безопасность (INV-SEO-001)

- **Read-only:** только GET/HEAD; POST/PUT/DELETE → 405.
- **Без auth:** Cookie, Authorization, X-CSRF-Token **не пробрасываются** в Chromium (полностью анонимный).
- **Whitelist hosts:** только `frontend:3004` (internal docker network). SSRF невозможен.
- **Chromium hardening:** `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu`, non-root user (uid 1001), `no-new-privileges`, `read_only: true` (docker-compose).
- **No user input:** весь URL из nginx `$request_uri`, hostname из whitelist.

## Caveats

- **Crashpad workaround:** Chromium требует `XDG_CONFIG_HOME`/`XDG_CACHE_HOME` (writable). Env установлен в `/tmp` через `server.js`.
- **Debian slim** (не alpine): system Chromium + все shared libs (libgobject и др.) предустановлены.
- **Cache не персистентный:** при рестаре прогревается на лету.
- **Graceful fallback:** при 5xx/timeout nginx `error_page` → отдаёт обычный SPA (не хуже чем до пререндера).
