# auth-core — service context card

**Stack:** Go 1.22+ (chi, pgx/v5, go-redis/v9, golang-jwt/v5)
**Status:** in development (drop-in replacement for Node `auth-service` identity endpoints)
**Owners:** Earflow backend (Security)

## Назначение

`auth-core` — Go-реализация identity endpoints Node `auth-service`
(register/login/telegram/refresh/verify/profile). Цель: забрать горячий
auth-путь с Node event loop на Go (concurrency), убрать лишний хоп через
`database-service` (прямой PG), и перейти на безопасный refresh-ротацию.

Покрывает ровно то, что Node auth-service отдаёт наружу в первой фазе
(без MFA — тот живёт в `security-service` (Go) и в `lib/mfa/httpRoutes.js`).

## Public API

| Method | Path | Назначение |
|---|---|---|
| GET | `/health` | liveness + redis/postgres status |
| POST | `/api/auth/email/register` | 201 `{token, refreshToken, user:{id,username}}` |
| POST | `/api/auth/email/login` | 200 `{token, refreshToken, user}` |
| POST | `/api/auth/telegram/login` | 200 `{token, refreshToken, user}` |
| POST | `/api/auth/refresh` | 200 `{accessToken, refreshToken}` (ротация + grace) |
| POST | `/api/verify` | 200 `{valid, user}` |
| GET | `/api/profile`, `/api/auth/profile` | 200 userData (Bearer access token) |

Внешний браузер ходит только через `go-api-gateway`: gateway сам владеет
cookie/sid (`handleAuthExchange`/`handleRefresh` в `internal/auth`), а auth-core
вызывается как upstream (`AUTH_SERVICE_URL`).

## Owns

Redis (auth DB):
  `auth:refresh:{jti}`, `auth:sid:{sid}`, `auth:session:meta:{sid}`, `auth:user_sids:{uid}`,
  `auth:grace:{jti}`, `auth:login_lock:{email_hash}`, `auth:login_fail:{email_hash}`,
  `auth:ip_fail:{ip}`, `auth:is_admin:{uid}`, `auth:profile:{uid}`,
  `auth:audit` (security/ops events, RPUSH+LTRIM(-10000)+EXPIRE 7d, fire-and-forget).

Postgres: читает/пишет `users` напрямую (id/email/email_hash/password_hash/
salt/username/metadata/email_encrypted/telegram_id/last_login/mfa_*).

## Reads

Postgres `users` — прямой доступ (без database-service), как `security-service`.

## Dependencies

- PostgreSQL (прямой DSN)
- Redis auth (`redis-auth`)
- `JWT_SECRET`, `ENCRYPTION_KEY` (64 hex / 32 bytes), `TELEGRAM_BOT_TOKEN`
- `DB_NAME`/`DB_USER`/`DB_PASSWORD`

## Caveats / Gotchas

- **Byte-совместимость с Node обязательна**: PBKDF2-SHA512 (600k/legacy 100k),
  AES-256-GCM encryptData v2 (`{v,encrypted,iv,authTag}`, 16-byte IV),
  HS256 JWT claims `{type,userId,sid,jti,ts,isAdmin}` (iss/aud), refresh-ротация
  с WATCH/MULTI и grace-окном. Не менять форматы без миграции.
- PBKDF2 600k — дорого; в Go каждый request выполняется в своей горутине, так что
  блокировка хеширования не останавливает сервер как Node event loop. `HandlerTimeout`
  завышен (15s) ради хеширования. Отдельного пула горутин для PBKDF2 НЕТ — не утверждать обратного.
- Email lockout: `auth:login_lock:`/`auth:login_fail:` + per-IP `auth:ip_fail:`
  (аналог Node `authLimiter`, но без счётчика успешных). Паритет с Node
  `authLimiter` (10/15мин/IP, success не считается) — также на **register и
  telegram login** через `throttleAuthIP` (`httpapi/server.go`), т.к. там нет
  per-email lockout (защита от спама регистраций и email-энумерации).
- **Grace-окно default 6h** (`AUTH_GRACE_TTL_SECONDS`), не 30м как у Node.
  Безопасно: `/api/auth/refresh` на gateway обложен device-proof (SEC-013 DoD #4,
  cookie-only → 401), так что reuse-401 в auth-core достигают только легитимные
  мультитаб-гонки — их и защищаем от «вылета». Старый украденный refresh без
  device-ключа бесполезен независимо от grace.
- Refresh reuse в фазе 1 = поведение Node (del refreshKey + 401, сигнал для
  risk-engine). Полное устранение «вылета» на границе grace — в PG SoT
  (`PEND-AUTH-003`) с epoch revoke.
- **Client IP for throttles/session meta = `X-Real-IP`** (nginx edge перезаписывает его
  реальным TCP-пиром). Первый элемент `X-Forwarded-For` НЕ доверяется — он
  клиент-контролируемый (спуфинг IP-троттла). См. `httpapi/server.go clientIP` + тесты.
- Троттл/сессии: пользовательская строка обрезается по **рунам** (не байтам) —
  `truncateRunes` (`SanitizeUsername`/`SanitizeProfileField`/telegram), кириллица не
  раскалывается (Node `.slice()` — по UTF-16 code units).
- Регистрация требует UNIQUE-индекс `users_email_hash_unique`
  (`database-service/database/migrations/007_users_email_hash_unique.sql`, применяется
  вручную, как `scripts/rollout-auth-pg-sot.sh migrate`).
  `CreateUser` маппит `23505` → `EMAIL_TAKEN` (закрывает гонку двух параллельных регистраций).
- Профиль: `PROFILE_CACHE_TTL_SECONDS` default **60** (не 600) — кэш не инвалидируется при
  удалении/демоции юзера, поэтому TTL сознательно мал (см. `PEND-AUTH-005`).
- Долговечность сессий: **не полагаемся на то, что Redis не рестартовал** — redis-auth
  в compose уже AOF + named volume + `noeviction`; рестарты обновлений сессии переживают.
  Реальный риск выброса всех — смена `JWT_SECRET`/`ENCRYPTION_KEY` (ротация только по
  запланированной миграции). Refresh 365d sliding: каждая ротация продлевает полный TTL.
- `AUTH_DECOY_SALT` — фиксированный соль для decoy-хеша (burnDecoyHash);
  задавать стабильным в проде, иначе каждый рестарт — новый.
- `AUTH_SERVICE_URL` на gateway переключается на этот сервис; MFA-роуты
  (`/api/auth/2fa/*`) при этом должны идти на `auth_legacy` (Node), см. gateway.yaml.
- Не дублировать `sid`: gateway-куки (`mp_sid`) и Node-`sid` внутри JWT —
  два разных уровня. Токены выдают здесь, session владеет gateway.
  (Упрощение до единого sid — отдельная фаза.)

## Tests

```
go test ./...
```

Покрытие: крипто-векторы от Node (PBKDF2 600k/100k, encryptData v2), Telegram HMAC +
age window, JWT roundtrip, refresh-ротация (happy/unknown/malformed/reuse), clientIP
(дисреспект к spoofed X-Forwarded-For, доверие только X-Real-IP/socket peer).

Генерация Node-векторов для крипто-тестов:
`node -e "console.log(require('crypto').pbkdf2Sync('MySecretPass1','<salt>',600000,64,'sha512').toString('hex'))"`

## Где смотреть глубже

- Entrypoint: `cmd/auth-service/main.go`
- Логика: `internal/authn/service.go`, `refresh.go`, `telegram_login.go`, `profile.go`
- Крипто-совместимость: `internal/cryptoutil/` (сверено с `security-service`)
- Контракт-референс (Node): `backend/auth-service/server.js`
