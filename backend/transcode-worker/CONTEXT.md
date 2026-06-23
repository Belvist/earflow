# transcode-worker — service context card

**Stack:** Node 22+, `pg`, AWS S3 SDK (MinIO), ffmpeg/ffprobe  
**Status:** production  
**Owners:** streaming pipeline

## Назначение

Poll/NOTIFY worker: скачивает исходник из MinIO, генерирует `quality_variants` (AAC/Opus/FLAC), loudness metadata, waveform peaks (`waveform_peaks`). Пишет статусы в Postgres. Потребители: `direct-stream-service` (variants), `database-service` (waveform API), listener UI.

## Public API

| Method | Path | Auth | Назначение |
|--------|------|------|------------|
| GET | `/health` | none | readiness (`503` while not ready or shutting down) |
| GET | `/metrics` | none | Prometheus counters/gauges |

Нет user-facing HTTP API.

## Owns

```
Postgres (songs):
  transcode_status, transcode_error, quality_variants
  waveform_status, waveform_error, waveform_peaks, waveform_bars

MinIO (music-audio):
  derived keys: {base}_{tag}.m4a|.webm|.flac

Postgres NOTIFY (listen only):
  transcode_jobs
```

## Reads

```
postgres.songs     — claim jobs, update status
minio music-audio  — GetObject source, PutObject variants
```

## Publishes

Нет NATS/WS. Триггер входа: `upload-service` → `pg_notify('transcode_jobs', songId)`.

## Job queues

| Queue | Status column | Concurrency env |
|-------|---------------|-----------------|
| Transcode | `transcode_status` | `TRANSCODE_CONCURRENCY` (default 2) |
| Waveform-only | `waveform_status` | `WAVEFORM_CONCURRENCY` (default 1) |

Отдельные пулы — waveform backfill не блокируется полным transcode.

## Retry policy

- Старт: `claimed`/`processing` → `pending`.
- `failed` → `pending` если `[retries:N]` в error column и `N < TRANSCODE_FAILED_MAX_RETRIES`, `updated_at` старше `TRANSCODE_FAILED_RETRY_INTERVAL_MS` (периодический sweep в poll loop).
- После `TRANSCODE_FAILED_MAX_RETRIES` запись остаётся `failed` (ручной разбор).

## Shutdown

`SIGTERM`/`SIGINT`: stop claim, `TRANSCODE_SHUTDOWN_TIMEOUT_MS` wait in-flight, прерванные jobs → `pending` (не `failed`).

## Security

- `DATABASE_URL`, MinIO keys — только env.
- `resolveObjectKey`: отклоняет `..` и `\0` в ключах MinIO.
- SQL — параметризованный; имена колонок retry — whitelist в `jobRetry.js`.

## Caveats

- Два PG-соединения (worker + `LISTEN`); `TRANSCODE_DB_MAX_CONNECTIONS=2` в compose — документировано, не pool.
- Частичные variants при жёстком kill процесса до graceful — сброс `claimed`/`processing` на следующем старте.
- `DB_MAX_CONNECTIONS` в compose — лимит для ops, не pg.Pool в коде.

## Key files

- `src/worker.js` — loops, orchestration
- `src/jobPool.js`, `src/jobRetry.js` — concurrency + retry
- `src/transcode.js`, `src/waveform.js`, `src/profiles.js`

## Tests

```bash
cd backend/transcode-worker && npm test
```
