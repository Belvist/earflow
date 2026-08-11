# db-migrations — canonical PostgreSQL schema pipeline

Единый источник правды для схемы `music_platform`. Заменяет раздробленные runners
(database-service `init.sql`, recommendations `runMigrations.js`, search migrator,
playlist/lyrics `initialize()`), которые сегодня НЕЗАВИСИМО меняют одну и ту же БД.

## Принципы (hard rules)

1. **Baseline proof, не предположение.** `migrations/000001_baseline.sql` воспроизводит
   production schema, проверенную на пустом PG15 (pgvector). История старых систем
   лежит в `legacy/` как immutable provenance — не переписывается.
2. **Новая история начинается с `000001_baseline`.** Старые файлы не перепаковываются
   в новые timestamps.
3. **Checksum = hard fail.** Если применённый файл кто-то поменял — runner падает.
   Схема никогда не "молча дрейфует".
4. **Один глобальный advisory lock** на весь run (`pg_advisory_lock`, session-level),
   один connection (`max: 1`).
5. **SQL выполняется целиком на сервере.** Никакого клиентского split по `;`
   (PL/pgSQL dollar-quoted bodies безопасны). Transactional по умолчанию.
   Non-transactional migrations маркируются первой строкой:
   `-- migration: non-transactional` (нужно для `CREATE INDEX CONCURRENTLY`).

## schema_migrations

```sql
migration_id TEXT PRIMARY KEY,
checksum_sha256 TEXT NOT NULL,
applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
execution_ms INTEGER NOT NULL
```

## Что исключено из baseline (артефакт drift, подтверждён пустым/неиспользуемым)

| object | тип | причина исключения |
|---|---|---|
| `equalizer_presets` | table | 0 rows, код не ссылается (заменено `user_eq_settings`) |
| `listening_history` | table | 0 rows, код не ссылается (заменено `listens`) |
| `user_song_likes` | table | 0 rows, код не ссылается (заменено `likes`) |
| `playlist_songs` | view | 0 callers; INSTEAD OF triggers покрывали старое имя |
| `playlist_songs_view_ins/del` | functions | триггеры view выше |
| `cleanup_expired_sessions` | function | дубликат `cleanup_expired_reco_sessions` (canonical) |
| `refresh_recommendation_views` | function | для matview `daily_interaction_summary` (0 callers) |
| `daily_interaction_summary` | matview | не вызывается, не нужна |

Эти объекты в production останутся до отдельной signoff-миграции
(`migrations/000002_cleanup_legacy_prod.sql` — DRAFT, не применять).

## Режимы

```bash
# fresh DB / CI / staging — реально применяет migrations
DATABASE_URL=postgres://... node runner/run.js

# future: verify-vs-prod (не stamp до отдельного GO)
# DATABASE_URL=postgres://prod... node runner/run.js --verify-baseline
```

## Тесты

```bash
cd db-migrations
# поднять тестовый PG15: docker run -d -p 15434:5432 -e POSTGRES_PASSWORD=postgres pgvector/pgvector:pg15
PGHOST=127.0.0.1 PGPORT=15434 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=music_platform \
  node --test tests/
```

## Порядок отключения legacy runners (НЕ сейчас)

| Релиз | Действие |
|---|---|
| **A** (текущий) | `db-migrations/` существует, legacy runners **включены**, новых schema-изменений через legacy нет |
| **B** | `db-migrations` — единственный writer; в сервисах startup DDL выключен (флагово), код runner'а ещё лежит |
| **C** | после staging/recovery-проверки — legacy migration-код физически удалён из сервисов |

## Legacy runners, которые потом отключаются (в этом порядке)

1. `recommendations-service/scripts/runMigrations.js` (убрать из `command:` в compose)
2. `search-service` `migrate.Apply()` (main.go)
3. `database-service` `db.initDatabase()` (server.js)
4. `playlist-service` `initialize()` (lib/database.js)
5. `lyrics-service` `initialize()` (lib/database.js)
6. `upload-service/scripts/integrity-check.js` `ensureSchema()` (DDL только в migration)
