# Earflow 3000+ Online Load Test Runbook

Этот runbook нужен для проверки реальной ёмкости одного VPS 4 CPU / 8 GB RAM без ложного вывода из-за `429 Too Many Requests` от per-IP rate limits.

## Почему k6 дал 429 около 200 online

k6 обычно запускается с одного IP. Для production это выглядит как один клиент, который делает сотни запросов в секунду, поэтому nginx/gateway/service rate limits корректно возвращают `429`. Если при этом нет `5xx`, timeout и резкого роста p95, это не означает, что сервер физически выдерживает только 200 пользователей.

## Безопасный load-test режим

По умолчанию production лимиты остаются строгими. Для controlled теста с одного IP можно временно поднять service-level лимиты:

```bash
LOAD_TEST_MODE=true LOAD_TEST_RATE_LIMIT_MULTIPLIER=30 docker compose up -d --build api-gateway database-service recommendations-service upload-service nginx
```

После теста вернуть обычный режим:

```bash
docker compose up -d --build api-gateway database-service recommendations-service upload-service nginx
```

Если тест идёт прямо на сервере, используй внутренний nginx endpoint без публичного per-IP лимита:

```bash
BASE_URL=http://127.0.0.1:8085 ENDPOINT=/api/version TARGET_RPS=250 HOLD_MINUTES=10 k6 run scripts/load/k6-online-estimate.js
```

Для публичного домена `https://earflow.ru` часть 429 может быть именно edge-защитой от одного IP. Это полезно для проверки анти-DDoS, но плохо подходит для capacity estimate.

## Ступенчатый профиль

Запускай ступенями и сравнивай p95/p99/429:

```bash
BASE_URL=http://127.0.0.1:8085 ENDPOINT=/api/version TARGET_RPS=100 HOLD_MINUTES=5 k6 run scripts/load/k6-online-estimate.js
BASE_URL=http://127.0.0.1:8085 ENDPOINT=/api/version TARGET_RPS=250 HOLD_MINUTES=10 k6 run scripts/load/k6-online-estimate.js
BASE_URL=http://127.0.0.1:8085 ENDPOINT=/api/version TARGET_RPS=500 HOLD_MINUTES=10 k6 run scripts/load/k6-online-estimate.js
BASE_URL=http://127.0.0.1:8085 ENDPOINT=/api/version TARGET_RPS=750 HOLD_MINUTES=10 k6 run scripts/load/k6-online-estimate.js
```

Модель online estimate зависит от `AVG_RPS_PER_ONLINE_USER`. Для музыкального сервиса часто полезно проверять диапазон:

```bash
AVG_RPS_PER_ONLINE_USER=0.15 BASE_URL=http://127.0.0.1:8085 TARGET_RPS=450 k6 run scripts/load/k6-online-estimate.js
AVG_RPS_PER_ONLINE_USER=0.25 BASE_URL=http://127.0.0.1:8085 TARGET_RPS=750 k6 run scripts/load/k6-online-estimate.js
```

## Метрики во время теста

В отдельном терминале:

```bash
docker stats --no-stream
curl -s http://127.0.0.1:8085/health
curl -s http://127.0.0.1:8085/metrics | grep -E 'gateway_http_requests_total|gateway_http_request_duration_seconds|gateway_http_inflight_requests|gateway_active_users_estimate'
docker compose exec postgres psql -U "$DB_USER" -d "$DB_NAME" -c "select count(*) as active_connections from pg_stat_activity where state <> 'idle';"
docker compose exec postgres psql -U "$DB_USER" -d "$DB_NAME" -c "select state, count(*) from pg_stat_activity group by state order by count desc;"
docker compose exec redis redis-cli ${REDIS_PASSWORD:+-a "$REDIS_PASSWORD"} --latency -i 1
```

## Как интерпретировать результат

- Если растёт `429`, но p95/p99 стабильные и нет `5xx`, тест упёрся в лимиты, а не в железо.
- Если p95/p99 резко растут, CPU около 100%, а 5xx ещё нет — это реальный предел CPU/gateway/service обработки.
- Если растёт число active DB connections и p95 API растёт — нужен PgBouncer/уменьшение app pools/индексы.
- Если Redis latency растёт — rate-limit/cache/session Redis стал bottleneck.
- Если network TX/RX забит — для 3000+ нужен перенос media/static в cache/CDN или отдельный streaming контур.

## Цель для одного VPS 4 CPU / 8 GB

На одном сервере цель 3000+ online реалистична только если средний пользователь генерирует мало API RPS, а media/static максимально кэшируется. Если тест показывает CPU/DB saturation раньше целевого RPS, следующий шаг — не поднимать лимиты, а оптимизировать top routes и connection pooling.
