# Earflow Music Platform

Персональная музыкальная платформа с ML-рекомендациями, стримингом и порталом артистов.

## Обзор

Earflow — это микросервисная музыкальная платформа, включающая:
- **Frontend:** React SPA для слушателей (earflow.ru) и артистов (artists.earflow.ru)
- **Backend:** 20+ микросервисов на Node.js и Go
- **Streaming:** Прямой стриминг и HLS для iOS
- **ML-рекомендации:** Персонализированные рекомендации на основе прослушиваний
- **Artist Portal:** Самостоятельная регистрация артистов, загрузка треков, статистика

## Архитектура

Подробная архитектура описана в [docs/earflow-architecture-map.md](docs/earflow-architecture-map.md).

### Основные компоненты

- **Nginx Edge:** TLS, CSP, CORS, rate limits, static/media cache
- **Go API Gateway:** Маршрутизация API, auth cookies, CSRF, rate limits
- **PostgreSQL + pgvector:** Основная БД с векторным поиском
- **Redis:** Кэш и хранилище сессий
- **MinIO:** Хранилище аудио и обложек
- **Meilisearch:** Полнотекстовый поиск
- **NATS JetStream:** Message bus для realtime

### Домены

- `earflow.ru` — основной фронтенд для слушателей
- `auth.earflow.ru` — авторизация
- `api.earflow.ru` — API + WebSocket + HLS
- `artists.earflow.ru` — портал артистов
- `strmhaha.earflow.ru` — origin для прямого стриминга

## Требования

### Для локального запуска

- **Docker & Docker Compose:** v24.0+
- **Node.js:** v22.0+ (для фронтенда)
- **Go:** 1.22+ (для Go сервисов)
- **PostgreSQL client:** для прямого доступа к БД (опционально)
- **FFmpeg:** для EBAP HLS (если запускаете локально без Docker)

### Для production

- Linux сервер с 8GB+ RAM
- Docker & Docker Compose
- SSL сертификаты (Let's Encrypt или собственные)
- Резервное копирование (PostgreSQL, MinIO)

## Быстрый старт

### 1. Клонирование и настройка

```bash
git clone <repository-url>
cd music-platform
cp .env.example .env
# Отредактируйте .env и заполните реальные секреты
```

**Важно:** Не коммитите `.env` с реальными секретами в git!

### 2. Генерация секретов

Для production используйте криптографически стойкие секреты:

```bash
# Пример генерации случайных секретов (Linux/macOS)
openssl rand -hex 32  # для JWT_SECRET, ENCRYPTION_KEY, etc.
```

### 3. Запуск всех сервисов

```bash
docker-compose up -d
```

Это запустит:
- PostgreSQL, Redis (main + auth), MinIO, Meilisearch
- Все backend сервисы
- Frontend контейнеры

### 4. Проверка здоровья сервисов

```bash
# Проверка статуса всех контейнеров
docker-compose ps

# Проверка логов
docker-compose logs -f

# Использование скрипта контроля
./scripts/platform-control.sh health
```

### 5. Инициализация БД

Первый запуск автоматически применит миграции:
- `backend/00-create-tables.sql`
- `backend/02-recommendations-schema.sql`
- `backend/03-subscription-schema.sql`
- `backend/04-mood-schema.sql`

### 6. Доступ к сервисам

После запуска:

- **Frontend:** http://localhost:3004 (или настроенный домен)
- **Artist Portal:** http://localhost:3005
- **API Gateway:** http://localhost:3000
- **MinIO Console:** http://localhost:9001 (только localhost)
- **Meilisearch:** http://localhost:7700

## Команды управления

### Docker Compose

```bash
# Запуск всех сервисов
docker-compose up -d

# Остановка всех сервисов
docker-compose down

# Перезапуск
docker-compose restart

# Просмотр логов
docker-compose logs -f [service-name]

# Пересборка после изменений кода
docker-compose up -d --build [service-name]

# Масштабирование stateless сервисов
docker-compose up -d --scale api-gateway=3
```

### Скрипты контроля

```bash
# Проверка здоровья сервисов
./scripts/platform-control.sh health

# Статус всех сервисов
./scripts/platform-control.sh status

# Остановка платформы
./scripts/platform-control.sh stop

# Запуск платформы
./scripts/platform-control.sh start

# Бэкап PostgreSQL
./scripts/backup-postgres.sh daily

# Восстановление из бэкапа
./scripts/drill-postgres-restore.sh

# Бэкап MinIO
./scripts/backup-minio.sh
```

## Разработка

### Frontend (React)

```bash
cd frontend
npm install
npm start          # Development server (craco)
npm run build      # Production build
npm run lint       # ESLint
```

### Artist Frontend (React)

```bash
cd artist-frontend
npm install
npm start
npm run build
```

### Backend Node.js сервисы

```bash
cd backend/[service-name]
npm install
npm start          # Production
npm run dev        # Development (если есть)
npm test           # Если есть тесты
```

### Backend Go сервисы

```bash
cd backend/[service-name]
go mod download
go build
go test ./...
go run .
```

### Тестирование

```bash
# Запуск integration тестов
docker-compose --profile tools up -d upload-service-tests
```

## Структура проекта

```
music-platform/
├── backend/                    # Backend сервисы
│   ├── go-api-gateway/        # Go API Gateway
│   ├── auth-service/          # Auth сервис (Node.js)
│   ├── security-service/      # Security сервис (Go)
│   ├── database-service/      # Database сервис (Node.js)
│   ├── upload-service/        # Upload сервис (Node.js)
│   ├── direct-stream-service/ # Direct streaming (Node.js/TS)
│   ├── ebap-hls-adapter/      # EBAP HLS для iOS (Node.js/TS)
│   ├── recommendations-service/ # ML-рекомендации (Node.js)
│   ├── search-service/        # Поиск (Go)
│   ├── artist-service/        # Artist сервис (Node.js)
│   ├── artist-portal-service/ # Artist Portal (Node.js)
│   ├── playlist-service/      # Плейлисты (Node.js)
│   ├── lyrics-service/        # Тексты песен (Node.js)
│   ├── device-sync-service/   # Device Sync (Go)
│   └── ...                    # Другие сервисы
├── frontend/                   # Frontend для слушателей (React)
├── artist-frontend/            # Frontend для артистов (React)
├── nginx/                      # Nginx конфигурации
├── scripts/                    # Utility скрипты
├── docs/                       # Документация
├── docker-compose.yml          # Основной compose файл
├── docker-compose.monitoring.yml # Monitoring (Prometheus, Grafana)
├── docker-compose.pgbouncer.yml   # PgBouncer
└── docker-compose.tools.yml        # Инструменты разработки
```

## Мониторинг и логирование

### Логи

```bash
# Просмотр логов конкретного сервиса
docker-compose logs -f api-gateway
docker-compose logs -f auth-service

# Все логи
docker-compose logs
```

### Health Checks

Большинство сервисов имеют `/health` endpoint:

```bash
curl http://localhost:3000/health  # API Gateway
curl http://localhost:3001/health  # Auth Service
# и т.д.
```

### Monitoring (опционально)

```bash
docker-compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d
```

Запустит Prometheus, Grafana, cAdvisor.

## Резервное копирование

### PostgreSQL

```bash
# Ежедневный бэкап
./scripts/backup-postgres.sh daily

# Проверка бэкапа
./scripts/backup-postgres.sh verify [backup-file]

# Восстановление
./scripts/drill-postgres-restore.sh
```

### MinIO

```bash
./scripts/backup-minio.sh
./scripts/drill-minio-restore.sh
```

## Troubleshooting

### Сервис не стартует

```bash
# Проверка логов
docker-compose logs [service-name]

# Проверка здоровья
docker-compose ps

# Перезапуск
docker-compose restart [service-name]
```

### Ошибки подключения к БД

- Убедитесь, что PostgreSQL запущен: `docker-compose ps postgres`
- Проверьте credentials в `.env`
- Проверьте network: docker-compose должен создать `music-network`

### Ошибки подключения к Redis

- Убедитесь, что Redis запущен: `docker-compose ps redis redis-auth`
- Проверьте `REDIS_PASSWORD` в `.env`

### Проблемы с MinIO

- MinIO Console: http://localhost:9001
- Проверьте логи: `docker-compose logs minio`
- Бuckets создаются автоматически через `minio-init`

### Проблемы с фронтендом

```bash
# Перезапуск фронтенда
docker-compose restart frontend

# Логи фронтенда
docker-compose logs frontend

# Локальная разработка без Docker
cd frontend
npm start
```

## Безопасность

**Критично:**

1. **Секреты:** Все секреты в `.env` должны быть уникальными и длинными (32+ символов)
2. **TLS:** Production должен использовать HTTPS (настроен в Nginx)
3. **Firewall:** PostgreSQL и Redis должны быть доступны только внутри Docker сети
4. **Регулярное обновление:** Образы Docker должны обновляться регулярно

Подробности безопасности в [reports/comprehensive-security-plan.md](reports/comprehensive-security-plan.md).

## Масштабирование

Для масштабирования используйте:

```bash
# Масштабирование stateless сервисов
docker-compose up -d --scale api-gateway=3
docker-compose up -d --scale direct-stream-service=2
```

Скрипты для масштабирования:
- `./scripts/scale-gateway.sh`
- `./scripts/scale-stateless.sh`

Подробности в [docs/scale-1m-engineering-plan.md](docs/scale-1m-engineering-plan.md).

## Документация

- [Architecture Map](docs/earflow-architecture-map.md) — Полная архитектура
- [SPOF Runbook](docs/operations-spof-runbook.md) — Runbook для операторов
- [Security Plan](reports/comprehensive-security-plan.md) — Аудит безопасности
- [Scale Plan](docs/scale-1m-engineering-plan.md) — План масштабирования

## Поддержка

Для проблем и вопросов:
1. Проверьте логи: `docker-compose logs`
2. Проверьте health: `./scripts/platform-control.sh health`
3. Прочитайте документацию в `docs/`
