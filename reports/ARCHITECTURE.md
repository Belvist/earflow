# Earflow Architecture Documentation

Полная архитектура платформы Earflow описана в [docs/earflow-architecture-map.md](docs/earflow-architecture-map.md).

## Quick Links

- [Architecture Map](docs/earflow-architecture-map.md) — Полная архитектура (23 карты, ~1200 строк)
- [Architecture Visual](docs/earflow-architecture-visual.html) — Интерактивная визуальная версия
- [Service Map](SERVICE_MAP.md) — Карта всех сервисов
- [Security Documentation](SECURITY.md) — Безопасность
- [Operations Runbook](RUNBOOK.md) — Runbook для операторов

## Architecture Overview

### Domains

- `earflow.ru` — Основной фронтенд для слушателей
- `auth.earflow.ru` — Авторизация
- `api.earflow.ru` — API + WebSocket + HLS
- `artists.earflow.ru` — Портал артистов
- `strmhaha.earflow.ru` — Origin для прямого стриминга

### Layers

1. **Edge Layer:** Nginx (TLS, CSP, CORS, rate limits, static/media cache)
2. **Gateway Layer:** Go API Gateway (маршрутизация, auth, CSRF, rate limits)
3. **Frontend Layer:** React SPA (listeners + artists)
4. **Backend Layer:** 20+ микросервисов (Node.js + Go)
5. **Data Layer:** PostgreSQL, Redis (main + auth), MinIO, Meilisearch, NATS

### Key Services

- **api-gateway:** Go gateway для listeners
- **artist-api-gateway:** Go gateway для artists
- **auth-service:** Auth, MFA, профили
- **security-service:** Security, сессии, recovery codes
- **database-service:** API данных каталога
- **upload-service:** Загрузка файлов
- **direct-stream-service:** Прямой стриминг
- **ebap-hls-adapter:** HLS для iOS
- **recommendations-service:** ML-рекомендации
- **search-service:** Полнотекстовый поиск

### Data Flows

- **Auth Flow:** Nginx → Gateway → Auth Service → Redis (auth)
- **Streaming Flow:** Gateway → Direct Stream / EBAP HLS → MinIO
- **Upload Flow:** Artist Portal → Gateway → Upload Service → MinIO → PostgreSQL
- **Search Flow:** Gateway → Search Service → Meilisearch → PostgreSQL

Подробности см. в [docs/earflow-architecture-map.md](docs/earflow-architecture-map.md).
