# Party smoke/load tests

Этот тест проверяет реальный lifecycle Party, а не мок:

- создать приватную комнату;
- получить invite code и WS ticket;
- подключить host по WebSocket;
- подключить гостей через invite code;
- проверить участников;
- отправить несколько `playback_update`;
- проверить доставку playback-событий гостям и latency;
- проверить `add_to_queue` и `remove_from_queue`;
- вывести гостей;
- завершить комнату host-ом.

Тест ходит напрямую в internal `party-state-service` и `party-gateway-service`, поэтому использует `X-User-Id` / `X-User-Name`. Через публичный edge этот сценарий запускать нельзя: gateway специально удаляет такие заголовки.

## Быстрый запуск

С Linux-сервера из корня проекта:

```bash
cd /opt/music-platform
PARTY_TEST_ROOMS=10 \
PARTY_TEST_GUESTS=10 \
PARTY_TEST_UPDATES=20 \
PARTY_TEST_CONCURRENCY=5 \
./scripts/party-smoke-load.sh
```

Если вы уже внутри папки `scripts`:

```bash
cd /opt/music-platform/scripts
PARTY_TEST_ROOMS=10 \
PARTY_TEST_GUESTS=10 \
PARTY_TEST_UPDATES=20 \
PARTY_TEST_CONCURRENCY=5 \
./party-smoke-load.sh
```

Windows / PowerShell:

```powershell
cd C:\Users\Heave\Downloads\music-platform
$env:PARTY_TEST_ROOMS = "10"
$env:PARTY_TEST_GUESTS = "10"
$env:PARTY_TEST_UPDATES = "20"
$env:PARTY_TEST_CONCURRENCY = "5"
.\scripts\party-smoke-load.ps1
```

## Режимы запуска

`PARTY_TEST_MODE=auto` включён по умолчанию.

- Если `http://localhost:3130/health` доступен, тест идёт напрямую.
- Если порты не проброшены на host, wrapper сам запускает Go runner внутри compose network.

Явно напрямую:

```bash
PARTY_TEST_MODE=direct \
PARTY_STATE_URL=http://localhost:3130 \
PARTY_WS_URL=ws://localhost:3131/ws/v2 \
./scripts/party-smoke-load.sh
```

Явно внутри Docker network:

```bash
PARTY_TEST_MODE=docker ./scripts/party-smoke-load.sh
```

## Нагрузочная лестница

Smoke перед деплоем:

```bash
./scripts/party-smoke-load.sh
```

Небольшая нагрузка:

```bash
PARTY_TEST_ROOMS=10 PARTY_TEST_GUESTS=10 PARTY_TEST_UPDATES=20 PARTY_TEST_CONCURRENCY=5 ./scripts/party-smoke-load.sh
```

Pre-prod прогон:

```bash
PARTY_TEST_ROOMS=30 PARTY_TEST_GUESTS=20 PARTY_TEST_UPDATES=30 PARTY_TEST_CONCURRENCY=10 PARTY_TEST_TIMEOUT=5m ./scripts/party-smoke-load.sh
```

На production не начинайте с больших значений. Сначала смотрите:

- `party_gateway_active_connections`;
- `party_gateway_active_parties`;
- Redis latency/memory;
- NATS latency/errors;
- gateway 5xx / p95;
- logs `party-state-service` и `party-gateway-service`.

## Успешный результат

В конце должно быть примерно:

```text
Party smoke/load summary: rooms=2 failed=0 guestsPerRoom=4 updatesPerRoom=8 concurrency=2 duration=...
WS propagation latency ms: p50=... p95=... p99=... max=... samples=...
```

`failed=0` обязателен. Timeout на playback event означает, что WS/NATS/state path реально теряет или задерживает события.
