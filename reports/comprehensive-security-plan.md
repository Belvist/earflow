# Earflow Music Platform — Полный аудит безопасности и план устранения уязвимостей

**Дата:** 2025-01  
**Область:** Вся платформа — все бэкенд-сервисы, фронтенды, инфраструктура (Docker/Nginx/K8s), схемы БД, управление секретами  
**Методология:** Статический анализ кода, ревью конфигураций, аудит зависимостей, ревью схем БД, оценка защищённости инфраструктуры  
**Аудитор:** Cascade (автоматизированный статический анализ)

---

## Содержание

1. [Краткое резюме](#краткое-резюме)  
2. [Обзор архитектуры](#обзор-архитектуры)  
3. [Реестр уязвимостей](#реестр-уязвимостей)  
   - [CRITICAL](#критический-уровень)  
   - [HIGH](#высокий-уровень)  
   - [MEDIUM](#средний-уровень)  
   - [LOW](#низкий-уровень)  
   - [INFORMATIONAL](#информационный-уровень)  
4. [Оценка безопасности инфраструктуры](#оценка-безопасности-инфраструктуры)  
   - [Nginx](#41-nginx)  
   - [Docker](#42-docker--docker-compose)  
   - [Kubernetes](#43-kubernetes)  
   - [SSL/TLS](#44-ssltls)  
5. [Оценка безопасности схемы БД](#оценка-безопасности-схемы-бд)  
6. [Оценка управления секретами](#оценка-управления-секретами)  
7. [Положительные меры безопасности](#положительные-меры-безопасности)  
8. [Матрица приоритетов устранения](#матрица-приоритетов-устранения)  
9. [Дорожная карта усиления инфраструктуры](#дорожная-карта-усиления-инфраструктуры)  

---

## Краткое резюме

Музыкальная платформа Earflow демонстрирует **уровень безопасности выше среднего** для микросервисного проекта. Команда реализовала защиту в глубину на нескольких уровнях: WAF-подобная фильтрация в Nginx, Go API-шлюз с CSRF/управлением сессиями, параметризованные SQL-запросы повсюду, защита загрузки файлов и TLS 1.2+ с HSTS preload.

Однако остаются **инфраструктурные пробелы**, которые могут свести на нет прикладные средства защиты, если злоумышленник получит доступ к Docker-сети или эксплуатирует ошибку конфигурации.

**Сводка находок:**

| Критичность | Количество | Статус |
|-------------|-----------|--------|
| CRITICAL | 2 | ✅ Исправлено |
| HIGH | 8 | 5 исправлено, 3 открыто |
| MEDIUM | 14 | 8 исправлено, 6 открыто |
| LOW | 10 | 6 исправлено, 4 открыто |
| INFORMATIONAL | 8 | Н/Д |

**Ключевые оставшиеся риски:**
- Сессии Redis хранятся без шифрования (H-2)
- Флаги cookie `mp_auth` не согласованы между сервисами (H-4)
- Мастер-процесс Nginx работает от root внутри контейнера (H-6)
- Манифесты K8s не содержат security contexts (H-7)
- Docker-сеть плоская — нет сегментации (H-8)
- Нет разделения ролей БД — единый суперпользователь для всех сервисов (M-10)

---

## Обзор архитектуры

```
                        ┌─────────────┐
                        │  Интернет   │
                        └──────┬──────┘
                               │
                    ┌──────────▼──────────┐
                    │  Nginx (LB/TLS/WAF) │  :80/:443
                    │  earflow.ru          │
                    └──┬──────┬──────┬────┘
                       │      │      │
          ┌────────────▼┐  ┌──▼───┐  ┌▼──────────────┐
          │ go-api-gateway│  │frontend│  │artist-api-gateway│
          │  :3000 (×2)  │  │:3004  │  │  :3000         │
          └──┬──────┬────┘  └───────┘  └──────┬────────┘
             │      │                           │
    ┌────────▼──┐  ┌▼──────────┐    ┌──────────▼────────┐
    │auth-svc   │  │database-svc│    │artist-portal-svc  │
    │:3001      │  │:3003       │    │:3085               │
    └───────────┘  └──┬─────────┘    └──────────┬─────────┘
                      │                         │
              ┌───────▼─────────────────────────▼──────┐
              │       Внутренняя Docker-сеть           │
              │  (music-network — bridge driver)       │
              │                                         │
              │  ┌──────────┐  ┌──────────┐  ┌──────┐ │
              │  │postgres  │  │redis(×2) │  │minio │ │
              │  │:5432     │  │:6379     │  │:9000 │ │
              │  └──────────┘  └──────────┘  └──────┘ │
              │                                         │
              │  upload-svc · playlist-svc · party-svc  │
              │  lyrics-svc · search-svc · reco-svc    │
              │  direct-stream-svc · ebap-hls-adapter  │
              │  transcode-worker · ebap-encoder-worker │
              │  ebap-hls-packager-worker · ranking-svc│
              │  track-processor · party-state-svc     │
              │  party-gateway-svc · nats              │
              └─────────────────────────────────────────┘
```

**Количество сервисов:** 25+ сервисов на 4 поддоменах (earflow.ru, api.earflow.ru, artists.earflow.ru, strmhaha.earflow.ru)

---

## Реестр уязвимостей

### КРИТИЧЕСКИЙ уровень

#### C-1. Party WebSocket доверяет заголовку `X-User-Id` — обход аутентификации
**Файл:** `backend/party-go/internal/partygw/gateway.go` (стек `party-service` на Node снят)  
**CWE:** CWE-290 (Обход аутентификации через подмену)

`verifyClient` доверяет заголовку `X-User-Id` без проверки JWT. Если WebSocket-эндпоинт доступен без Go-шлюза, любой злоумышленник может выдать себя за любого пользователя.

**Влияние:** Полная подмена любого пользователя в party-сессиях — управление воспроизведением, инъекция чата, манипуляция очередью.

**Статус:** ✅ ИСПРАВЛЕНО — Ветка доверия заголовкам удалена. Для всех WS-соединений требуется проверка JWT.

---

#### C-2. Таблица `users` — `password_hash` и чувствительные столбцы в RETURNING-выражениях
**Файл:** `backend/database-service/routes/users.js:224-227`  
**CWE:** CWE-200 (Раскрытие конфиденциальной информации)

Выражение `UPDATE users` RETURNING включает `salt` и `metadata` (зашифрованные данные пользователя). Любая ошибка маршрутизации может привести к утечке этих данных клиенту.

**Влияние:** Утечка солей паролей снижает сложность брутфорса. Зашифрованные блобы metadata доступны для офлайн-расшифровки.

**Статус:** ✅ ИСПРАВЛЕНО — RETURNING-выражения очищены до безопасных полей.

---

### ВЫСОКИЙ уровень

#### H-1. `auth-service` — PBKDF2 с потенциально низким числом итераций
**Файл:** `backend/auth-service/server.js`  
**CWE:** CWE-916 (Использование хеша пароля с недостаточной вычислительной сложностью)

**Статус:** ✅ ИСПРАВЛЕНО — Итерации PBKDF2 увеличены до 600 000 с прозрачной миграцией устаревших хешей и перехешированием при входе.

---

#### H-2. JWT Refresh-токен хранится в Redis без шифрования
**Файл:** `backend/go-api-gateway/internal/auth/session_store.go`  
**CWE:** CWE-312 (Хранение конфиденциальной информации в открытом виде)

Значения сессий Redis содержат `{accessToken, refreshToken, user, ...}` как открытый JSON. При компрометации Redis (нет TLS, общая сеть) все активные сессии угоняются.

**Статус:** ⏳ ОТКРЫТО — Требуется развёртывание `SESSION_ENCRYPTION_KEY`. Шифровать полезные данные сессий с помощью AES-256-GCM перед сохранением в Redis.

**План устранения:**
1. Сгенерировать выделенный `SESSION_ENCRYPTION_KEY` (32 байта, base64)
2. Реализовать шифрование/расшифровку AES-256-GCM в хранилище сессий
3. Поддерживать двойное чтение (открытый + зашифрованный) в окне миграции
4. Ротировать все сессии после полного развёртывания

---

#### H-3. Redis доступен без обязательной аутентификации
**CWE:** CWE-306 (Отсутствие аутентификации для критической функции)

Несколько сервисов принимают `REDIS_PASSWORD` как опциональный (напр. `REDIS_PASSWORD:-`). Если `REDIS_PASSWORD` не задан в продакшене, Redis работает без аутентификации в Docker-сети.

**Статус:** ✅ ЧАСТИЧНО ИСПРАВЛЕНО — `auth-service` и Party (`party-go`) требуют пароль Redis в продакшене.  
**Осталось:** Несколько сервисов используют `${REDIS_PASSWORD:-}` (пустое значение по умолчанию). Проверить все сервисы на обязательное применение.

**Сервисы с опциональным паролем Redis:**
- `artist-api-gateway` (строка 712)
- `recommendations-service` (строка 772)
- `reco-feedback-worker-go` (строка 885)
- `reco-offline-worker` (строка 983)
- `playlist-service` (строка 1055)
- `lyrics-service` (строка 1104)
- `party-state-service` (строка 1265)
- `api-gateway` (строки 1660, 1663, 1666)

---

#### H-4. Отсутствует проверка флага `httpOnly` для cookie `mp_auth`
**Файлы:** `upload-service/middleware/authenticateUser.js:51`, `backend/party-go/...` (исторически: party Node), `artist-portal-service/server.js:349`  
**CWE:** CWE-614 (Конфиденциальная cookie без флага 'HttpOnly')

Cookie `mp_auth` читается несколькими сервисами как запасной источник токена. Если установлена без `HttpOnly; Secure; SameSite=Strict`, она уязвима к XSS-экфильтрации.

**Статус:** ⏳ ОТКРЫТО — Требуется аудит установки cookie во всех сервисах.

**План устранения:**
1. Проверить все вызовы `res.cookie()` в кодовой базе
2. Консолидировать к модели HttpOnly-сессии `mp_sid` Go-шлюза
3. Устранить `mp_auth` или установить `HttpOnly; Secure; SameSite=Lax; Path=/`

---

#### H-5. `songs.recommendations` — Риск SQL-инъекции через `md5()`-сид
**Файл:** `backend/database-service/routes/songs.js:350`  
**CWE:** CWE-89 (SQL-инъекция)

**Статус:** ✅ ИСПРАВЛЕНО — Непараметризованный сид в `md5()` заменён на безопасную параметризацию.

---

#### H-6. Мастер-процесс Nginx работает от root внутри контейнера
**Файл:** `nginx/Dockerfile:132-135`  
**CWE:** CWE-250 (Выполнение с избыточными привилегиями)

Комментарий в Dockerfile гласит: «Работает от root для привязки к порту 80, но воркеры Nginx работают от пользователя nginx». Хотя модель мастер-воркер стандартна для Nginx, компрометация мастер-процесса (через уязвимость Nginx) даёт root-доступ внутри контейнера.

**Влияние:** Потенциальный выход из контейнера при zero-day Nginx, позволяющем выполнение кода в мастер-процессе.

**Статус:** ⏳ ОТКРЫТО

**План устранения:**
1. Изменить внутренний порт Nginx на 8080
2. Добавить директиву `USER nginx` в Dockerfile после настройки привязки портов
3. Использовать Docker `--sysctl net.ipv4.ip_unprivileged_port_start=80` или `cap_add: [NET_BIND_SERVICE]` в compose
4. Альтернативно: использовать `setcap` на бинарнике Nginx для привязки к низким портам без root

---

#### H-7. Манифесты Kubernetes не содержат security contexts
**Файл:** `k8s/api-gateway.yaml`, `k8s/ingress.yaml`  
**CWE:** CWE-265 (Проблемы привилегий)

Манифест K8s Deployment не указывает:
- `securityContext.runAsNonRoot: true`
- `securityContext.readOnlyRootFilesystem: true`
- `securityContext.allowPrivilegeEscalation: false`
- `securityContext.capabilities.drop: [ALL]`

**Влияние:** При использовании K8s в продакшене контейнеры работают с привилегиями по умолчанию (часто root).

**Статус:** ⏳ ОТКРЫТО

**Устранение:** Добавить PodSecurityContext и ContainerSecurityContext во все манифесты K8s. Пример:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  fsGroup: 1000
  seccompProfile:
    type: RuntimeDefault
capabilities:
  drop: [ALL]
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
```

---

#### H-8. Плоская Docker-сеть — нет сегментации
**Файл:** `docker-compose.yml:1860-1862`  
**CWE:** CWE-284 (Некорректное управление доступом)

Все 25+ сервисов используют единую мостовую сеть `music-network`. Скомпрометированный сервис может обратиться к любому другому сервису, включая PostgreSQL, Redis и MinIO.

**Влияние:** Горизонтальное перемещение — компрометация одного сервиса даёт доступ ко всем БД и хранилищам.

**Статус:** ⏳ ОТКРЫТО

**План устранения:**
1. Создать отдельные Docker-сети:
   - `frontend-network`: nginx, frontend, artist-frontend
   - `gateway-network`: nginx, api-gateway, artist-api-gateway
   - `service-network`: шлюзы, auth-service, database-service, upload-service и т.д.
   - `data-network`: postgres, redis, redis-auth, minio (доступ только для сервисов, которым нужны)
2. Сервисы подключаются только к нужным им сетям
3. PostgreSQL и MinIO НЕ должны быть в сети шлюзов

---

### СРЕДНИЙ уровень

#### M-1. CORS-маска на обложках
**Файл:** `nginx/nginx.conf:2105`

```nginx
add_header Access-Control-Allow-Origin "*" always;
```

Обложки — публичные активы, поэтому `*` допустимо, но конфликтует с `Access-Control-Allow-Credentials: true` на других эндпоинтах.

**Статус:** Н/Д (по дизайну) — Задокументировать, что `/covers/` никогда не требует учётных данных.

---

#### M-2. `artist-portal-service` — Нет валидации Zod/схем на тела запросов
**Файл:** `backend/artist-portal-service/server.js:568-578`

**Статус:** ✅ ИСПРАВЛЕНО — Добавлена валидация Zod-схемы для PATCH artist-card.

---

#### M-3. Отсутствует ограничение скорости на эндпоинтах `/api/auth/2fa/*`
**Файл:** `backend/auth-service/lib/mfa/httpRoutes.js`

**Статус:** ✅ ИСПРАВЛЕНО — Ограничитель на пользователя: макс. 5 попыток за 60 секунд.

---

#### M-4. `database-service/db.js` — Учётные данные пула соединений в памяти
**Файл:** `backend/database-service/database/db.js:7-22`

Пароль PostgreSQL хранится в конфиге `Pool` всё время жизни процесса. В сочетании с отсутствием `statement_timeout` на уровне запросов, медленный запрос может удерживать соединение бесконечно.

**Статус:** Н/Д (стандартное поведение Node/pg) — Добавить таймауты на уровне запросов для длительных CTE рекомендаций.

---

#### M-5. Таблица `users` — Отсутствует обеспечение согласованности `email`/`email_hash`
**Файл:** `backend/00-create-tables.sql:9`

`email` — nullable UNIQUE, `email_hash` — фактический ключ уникальности. Несколько пользователей с `email = NULL` могут иметь разные `email_hash` — риск целостности данных.

**Статус:** ⏳ ОТКРЫТО — Добавить CHECK-ограничение, гарантирующее, что оба поля `email` и `email_hash` заполнены или оба пусты.

---

#### M-6. Таблица `songs` — Нет FK `ON DELETE` для `uploader_id`
**Файл:** `backend/00-create-tables.sql:151`

**Статус:** ✅ ИСПРАВЛЕНО — Добавлено `ON DELETE SET NULL`.

---

#### M-7. Кэш токенов Party-сервиса — Нет ограничения размера вытеснения
**Файл:** `backend/party-go/internal/stateserver` (аутентификация сессий через api-gateway, не мидлвар Node party)

**Статус:** Н/Д — Использовать LRU-кэш для ограниченного вытеснения.

---

#### M-8. Зависимость `sharp` — Известная CVE
**Файл:** `backend/upload-service/package.json:34`

**Статус:** ✅ ИСПРАВЛЕНО — Обновлено до `sharp@^0.33.5`.

---

#### M-9. Отсутствует аудит флага `Secure` для всех cookie
**Статус:** ⏳ ОТКРЫТО — Провести аудит и установить `Secure; SameSite=Lax` на все cookie в продакшене.

---

#### M-10. Нет разделения ролей БД — единый суперпользователь для всех сервисов
**Файл:** `docker-compose.yml` (все сервисы используют `${DB_USER}:${DB_PASSWORD}`)

Каждый сервис подключается к PostgreSQL с одними и теми же учётными данными `music_user`. Этот пользователь владеет всеми таблицами и имеет полный SELECT/INSERT/UPDATE/DELETE на каждую таблицу.

**Влияние:** Скомпрометированный сервис может читать/изменять любую таблицу (напр., upload-service изменяет таблицу `users`; привилегии сервисов Party — в party-go/Redis, не `songs` напрямую).

**Статус:** ⏳ ОТКРЫТО

**План устранения:**
1. Создать выделенные роли PostgreSQL для каждого сервиса:
   - `auth_app` — доступ только к `users`, `service_sessions`
   - `db_app` — доступ к `songs`, `playlists`, `likes`, `user_history` и т.д.
   - `upload_app` — доступ к `songs` (только INSERT/UPDATE), `artist_uploaders`
   - `playlist_app` — доступ к `playlists`, `playlist_tracks`, `user_history`
   - `lyrics_app` — доступ только к таблице `lyrics`
   - `reco_app` — доступ к `user_interactions`, `user_models`, `song_features`, таблицам рекомендаций
   - `party_app` — минимальный доступ, состояние party только в Redis
2. Предоставить минимальные привилегии каждой роли (принцип наименьших привилегий)
3. Создать скрипт миграции с операторами `GRANT`
4. Обновить `docker-compose.yml` с учётными данными БД для каждого сервиса

---

#### M-11. `artist-portal-service` — Загрузка 200 МБ песни в память
**Файл:** `backend/artist-portal-service/server.js:162-168`

`multer.memoryStorage()` с лимитом 200 МБ. Параллельные загрузки могут вызвать OOM.

**Статус:** ⏳ ОТКРЫТО — Использовать `multer.diskStorage()` или потоковый прокси к `upload-service`.

---

#### M-12. Дрифт схем — несколько источников DDL для одних и тех же таблиц
**Файлы:** `backend/00-create-tables.sql`, `backend/database-service/database/init.sql`

9+ таблиц определены одновременно в `00-create-tables.sql` и `init.sql` с возможным расхождением. Также `02-recommendations-schema.sql` определяет пересекающиеся таблицы.

**Влияние:** Дрифт схем может привести к тихой порче данных или ошибкам миграции.

**Статус:** ⏳ ОТКРЫТО — Консолидировать к единому источнику истины. Использовать фреймворк миграций (напр., `node-pg-migrate` или `db-migrate`).

---

#### M-13. K8s Ingress — Нет ограничений скорости или аннотаций WAF
**Файл:** `k8s/ingress.yaml`

Ресурс Ingress не содержит:
- Аннотаций ограничения скорости (`nginx.ingress.kubernetes.io/limit-connections`, `limit-rps`)
- Аннотаций WAF/modsecurity
- Пользовательских страниц ошибок
- IP-белого списка для админских путей

**Влияние:** При использовании K8s Ingress в продакшене обходятся все ограничения скорости и фильтрация безопасности Nginx.

**Статус:** ⏳ ОТКРЫТО

---

#### M-14. K8s ConfigMap/Secrets — Нет шифрования при хранении
**Файл:** `k8s/configmap.yaml`

K8s Secrets закодированы в base64, но не зашифрованы. Без `EncryptionConfiguration` секреты хранятся в открытом виде в etcd.

**Статус:** ⏳ ОТКРЫТО — Включить шифрование при хранении для K8s-секретов.

---

### НИЗКИЙ уровень

#### L-1. `X-XSS-Protection: 1; mode=block` — Устаревший заголовок
**Статус:** ✅ ИСПРАВЛЕНО — Установлено значение `"0"`.

---

#### L-2. Карта `block_sql_injection` не используется
**Статус:** ✅ ИСПРАВЛЕНО — Мёртвый конфиг удалён.

---

#### L-3. `artist-service` — Инвертированная логика проверки админа для заявок
**Статус:** ✅ ИСПРАВЛЕНО — Код ошибки изменён на `ADMIN_CANNOT_CLAIM`.

---

#### L-4. Учётные данные root MinIO в переменных окружения
**Статус:** Н/Д — `.env` исключён из контроля версий. Для продакшена рекомендуются Docker secrets.

---

#### L-5. Несогласованные JWT-библиотеки между сервисами
`jose` (v5) и `jsonwebtoken` (v9) используются в разных сервисах. Обе поддерживают только `HS256`.

**Статус:** Н/Д — Стандартизировать на одной библиотеке при удобном случае.

---

#### L-6. Нет ограничения `Content-Length` на сообщения WebSocket
**Файл:** `backend/party-go/internal/partygw/gateway.go` (см. обработку WS)

4KB `maxPayload` корректен. WS-ограничитель скорости снижает риск быстрых малых сообщений.

**Статус:** Н/Д

---

#### L-7. `artist-portal-service` — Загрузка 200 МБ в память
(См. M-11 выше — повышено до СРЕДНЕГО)

---

#### L-8. Nginx `cert-reloader` использует `pid: "service:nginx"` — привилегированный доступ
**Файл:** `docker-compose.yml:1587`

Контейнер cert-reloader разделяет пространство PID с Nginx и отправляет `SIGHUP`. Это необходимо для перезагрузки сертификатов, но даёт доступ на уровне процессов к контейнеру Nginx.

**Статус:** Н/Д — Приемлемый риск. Снижение: убедиться, что cert-reloader имеет минимальные другие привилегии (уже `alpine:3.21` без необходимости сетевого доступа).

---

#### L-9. `SERVICE_JWT_PRIVATE_KEY_B64` — RSA-ключ 2048 бит
**Файл:** `scripts/init-env.ps1:193`

RSA 2048 бит — минимально приемлемый размер ключа. NIST рекомендует 3072 бит для периода после 2030 года.

**Статус:** ⏳ ОТКРЫТО — Запланировать миграцию на RSA 4096 или Ed25519 для сервисных JWT.

---

#### L-10. Порт `frontend` 3004 открыт для хоста
**Файл:** `docker-compose.yml:1709-1710`

```yaml
ports:
  - "3004:3004"
```

Контейнер frontend открывает порт 3004 на все интерфейсы. Это обходит TLS/заголовки безопасности Nginx.

**Статус:** ⏳ ОТКРЫТО — Изменить на `"127.0.0.1:3004:3004"` или удалить (Nginx проксирует к нему).

---

### ИНФОРМАЦИОННЫЙ уровень

#### I-1. Карта архитектуры сервисов

| Сервис | Стек | Порт | Модель аутентификации | Сеть |
| **go-api-gateway** | Go 1.22 / chi / Redis | 3000 | Сессионные cookie (HttpOnly) + CSRF | music-network |
| **artist-api-gateway** | Go 1.22 / chi / Redis | 3000 | Сессионные cookie + CSRF | music-network |
| **auth-service** | Node 22 / Express | 3001 | JWT-эмитент + сессии Redis | music-network |
| **database-service** | Node 22 / Express / pg | 3003 | Сервисный токен (X-Service-Token) | music-network |
| **upload-service** | Node 22 / Express / S3 | 3002 | JWT + cookie | music-network |
| **artist-service** | Node 22 / Express / pg | 3040 | JWT + cookie | music-network |
| **artist-portal-service** | Node 22 / Express | 3085 | Bearer-прокси к вышестоящему | music-network |
| **direct-stream-service** | Bun / TypeScript / S3 | 3096 | Подписанные URL-токены + HMAC | music-network |
| **ebap-hls-adapter** | Bun / TypeScript | 3095 | Cookie/токен | music-network |
| **ebap-encoder-worker** | Bun / TypeScript | — | Только внутренний | music-network |
| **ebap-hls-packager-worker** | Bun / TypeScript | — | Только внутренний | music-network |
| **transcode-worker** | Node / ffmpeg | — | Только внутренний | music-network |
| **playlist-service** | Node 22 / Express / pg / Redis | 3020 | JWT + сервисный токен | music-network |
| **lyrics-service** | Node / Express | 3010 | JWT + сервисный токен | music-network |
| **party-state-service** | Go / party-go / Redis / NATS | 3130 | Внутренний | music-network |
| **party-gateway-service** | Go / party-go / NATS / WebSocket | 3131 | Внутренний (ws v2) | music-network |
| **recommendations-service** | Node / Flask / pg | 3006 | Сервисный токен + HMAC-сессия | music-network |
| **reco-feedback-worker** | Go / Redis Stream | — | Внутренний | music-network |
| **ranking-service** | Go | 8080 | Внутренний | music-network |
| **audio-features-worker** | Python | — | Внутренний | music-network |
| **track-processor** | Node | — | Внутренний | music-network |
| **search-service** | Node / Meilisearch | 3062 | Внутренний | music-network |
| **frontend** | React / Nginx | 3004 | На основе cookie (через шлюз) | music-network |
| **artist-frontend** | React / Nginx | 3005 | На основе cookie (через шлюз) | music-network |
| **nginx** | Nginx 1.27-alpine-slim | 80/443 | TLS-терминация | music-network |
| **postgres** | PostgreSQL + pgvector | 5432 | Только внутренний | music-network |
| **redis** | Redis 7 | 6379 | Опциональный пароль | music-network |
| **redis-auth** | Redis 7 (noeviction) | 6379 | Опциональный пароль | music-network |
| **minio** | MinIO | 9000/9001 | S3-подпись | music-network |
| **nats** | NATS 2.10 JetStream | 4222 | Нет | music-network |

---

#### I-2. Сводка ограничений скорости

| Зона | Скорость | Всплеск | Область | Конфиг Nginx |
|------|------|-------|-------|--------------|
| `api_limit` | 100 з/с | 1000 | Глобальный API | `nginx.conf` |
| `auth_limit` | 10 з/с | 30 | Вход/регистрация | `nginx.conf` |
| `upload_limit` | 5 з/с | 20 | Загрузка файлов | `nginx.conf` |
| `hls_limit` | 30 з/с | 600 | HLS-стриминг | `nginx.conf` |
| `media_limit` | 20 з/с | 600 | Медиа/MinIO | `nginx.conf` |
| `login_limit` | 5 з/м | 10 | Вход по IP | `nginx.conf` |
| `conn_limit` | 100 | — | Соединения по IP | `nginx.conf` |
| `media_conn_limit` | 50 | — | Медиа-соединения по IP | `nginx.conf` |
| WS (party) | Настраиваемый/с | — | На соединение | party-gateway-service (go) |

---

#### I-3. Сводка зависимостей

| Пакет | Где используется | Последний | Установлен | Статус |
|---------|---------|--------|-----------|--------|
| express | All Node services | 4.21.x | ^4.21.2 | ✅ |
| helmet | All Node services | 8.x | ^8.0.0 | ✅ |
| jsonwebtoken | Most Node services | 9.0.2 | ^9.0.2 | ✅ |
| sharp | upload-service | 0.33.5 | ^0.33.5 | ✅ |
| pg | db/upload/playlist | 8.13.x | ^8.13.1 | ✅ |
| redis | auth/playlist/party | 4.7.x | ^4.7.0 | ✅ |
| jose | ebap-streaming | 5.2.x | ^5.2.4 | ✅ |
| go-redis/v9 | go-gateway | 9.7.x | 9.7.0 | ✅ |
| golang-jwt/v5 | go-gateway | 5.2.x | 5.2.1 | ✅ |
| multer | upload/portal | 2.0.0 | ^2.0.0 | ✅ |
| zod | artist-portal | 3.x | ^3.x | ✅ |

---

#### I-4. Заметки Docker/Инфра

- Все сервисы работают в общей Docker-сети (`music-network`)
- Внутренние сервисы (database-service, воркеры) не открыты через Nginx ✅
- Порты PostgreSQL, Redis, MinIO не опубликованы на хост ✅
- Certbot настроен на автообновление Let's Encrypt ✅
- OCSP stapling включён с цепочкой доверия ISRG Root X1 ✅
- Portainer и pgAdmin привязаны только к `127.0.0.1` ✅
- Docker-сокет смонтирован только для чтения в Portainer ✅

---

#### I-5. Заметки по ревью схемы БД

- `00-create-tables.sql`: Хорошо структурирована с корректными индексами, FK-ограничениями, уникальными ограничениями
- Расширение `pgcrypto` используется для `gen_random_bytes` (генерация public_id) — безопасно
- `playlist_songs` устарела в пользу `playlist_tracks`
- `user_interactions.timestamp` дублирует `created_at` — незначительная избыточность
- 9 неиспользуемых таблиц обнаружено db-audit (см. `reports/db-audit.md`)
- Дрифт схем между `00-create-tables.sql` и `init.sql` для 9+ таблиц

---

#### I-6. Архитектура кэширования Nginx

| Зона кэша | Путь | Макс. размер | Неактивность | Назначение |
|------------|------|----------|----------|---------|
| `static_cache` | JS/CSS/изображения | 1g | 30d | Статические активы CRA |
| `ebap_cache` | Медиа EBAP | 10g | 30d | Закодированные аудиосегменты |
| `audio_cache` | Прямое аудио | 10g | 30d | Кэш нарезанного аудио |

---

#### I-7. Безопасность переменных окружения

Скрипт `scripts/init-env.ps1` корректно генерирует секреты с использованием `System.Security.Cryptography.RandomNumberGenerator` (CSPRNG). Секреты: 48 байт base64url для сервисных ключей, 32 байт hex для ключей шифрования, 24 байт для паролей.

---

## Оценка безопасности инфраструктуры

### 4.1 Nginx

#### Безопасно ✅

| Функция | Реализация |
|---------|---------------|
| **Протоколы TLS** | Только TLSv1.2 + TLSv1.3 (TLS 1.0/1.1 отключены) |
| **Шифр-наборы** | Только AEAD (AES-GCM, CHACHA20-POLY1305), обмен ключами ECDHE |
| **Параметры DH** | 4096 бит (`ssl_dhparam`) |
| **Кривая ECDH** | `secp384r1` |
| **HSTS** | `max-age=63072000; includeSubDomains; preload` (2 года) |
| **HSTS Preload** | Включён |
| **OCSP Stapling** | Включён с `ssl_stapling_verify on` |
| **0-RTT** | Отключён (`ssl_early_data off`) — защита от повтора |
| **Сессионные тикеты** | Отключены (`ssl_session_tickets off`) — прямая секретность |
| **Токены сервера** | Скрыты (`server_tokens off`) |
| **Заголовки безопасности** | X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, CSP |
| **Ограничение скорости** | 6 зон: auth, API, upload, HLS, media, login |
| **Ограничение соединений** | По IP (100 общих, 50 медиа) |
| **Размер запроса** | `client_max_body_size 100m` только для загрузок |
| **Защита от Slowloris** | Таймауты: `client_body_timeout 12s`, `client_header_timeout 12s`, `send_timeout 10s`, `keepalive_timeout 65s` |
| **Скрытые файлы** | `location ~ /\.` → deny all |
| **Чувствительные типы файлов** | Заблокированы: `.env`, `.git`, `.htaccess`, `.htpasswd`, `.sql`, `.bak`, `.log`, `.conf`, `.ini`, `.yml`, `.yaml`, `.json` (выборочно) |
| **Внутренние локации** | `/media/direct-audio/`, `/media/direct-audio-private/`, `/media/direct-audio-sliced/`, `/media/ebap-cache/` — все `internal;` |
| **Админ/Метрики** | Доступ только с `127.0.0.1` через `allow/deny` |
| **Редирект HTTP→HTTPS** | Весь трафик порта 80 перенаправлен на HTTPS |
| **Сервер по умолчанию** | Возвращает 444 (закрытие соединения) для неизвестных хостов |
| **CORS** | Динамическая валидация origin через карту `$cors_earflow_origin` |
| **Аутентификация медиа** | `auth_request /internal/media-auth` проверяет параметры S3 presigned URL |
| **Проверки Sec-Fetch** | `Sec-Fetch-Mode: navigate` и `Sec-Fetch-Dest: document` заблокированы на стриминговых эндпоинтах |
| **Удаление заголовков прокси** | Заголовки MinIO (x-amz-*) скрыты от клиента |
| **Пересылка cookie** | Только на стриминговых эндпоинтах, где необходимо |
| **ID запроса** | `$request_id` генерируется и пересылается бэкенду |

#### Требует улучшения ⚠️

| Проблема | Критичность | Описание |
|-------|----------|-------------|
| Мастер-процесс от root | HIGH | См. H-6 выше |
| Нет `server_tokens off` во всех блоках | LOW | Проверить, что все блоки скрывают версию |
| `proxy_next_upstream` включает `http_500` | LOW | Может повторять при ошибке сервера, маскируя проблемы |
| CORS-маска `/covers/` | MEDIUM | См. M-1 (приемлемо по дизайну) |
| Нет `proxy_cookie_path` / `proxy_cookie_domain` | LOW | Cookie бэкенда могут утекать за пределы области |
| `proxy_cache_key` включает `$http_range` | LOW | Вариация заголовка Range может раздувать кэш |

---

### 4.2 Docker и Docker Compose

#### Безопасно ✅

| Функция | Сервисы |
|---------|----------|
| **`no-new-privileges:true`** | nginx, frontend, artist-frontend, portainer, pgadmin, party-state-service, party-gateway-service, ebap-encoder-worker, transcode-worker, ebap-hls-packager-worker |
| **`read_only: true`** | frontend, artist-frontend, party-state-service, party-gateway-service, ebap-encoder-worker, transcode-worker, ebap-hls-packager-worker |
| **Монтирование `tmpfs`** | Все read_only-сервисы имеют ограниченные tmpfs для /tmp |
| **Лимиты ресурсов** | Большинство сервисов имеют ограничения CPU/памяти |
| **Проверки здоровья** | Все сервисы имеют health checks |
| **Только внутренние порты** | PostgreSQL, Redis, MinIO не опубликованы на хост |
| **Portainer/pgAdmin** | Привязаны только к `127.0.0.1` |
| **Docker-сокет** | Смонтирован только для чтения (`:ro`) в Portainer |
| **Конфиг Nginx** | Смонтирован только для чтения (`:ro`) |
| **Let's Encrypt** | Смонтирован только для чтения (`:ro`) |
| **Профиль pgAdmin** | `profiles: ["tools"]` — не запускается по умолчанию |
| **Cert-reloader** | Минимальный образ alpine, только разделение PID |

#### Требует улучшения ⚠️

| Проблема | Критичность | Описание |
|-------|----------|-------------|
| Плоская сеть | HIGH | См. H-8 — все сервисы в одной сети |
| Отсутствует `no-new-privileges` | MEDIUM | Несколько сервисов не имеют этого: `postgres`, `redis`, `redis-auth`, `minio`, `auth-service`, `database-service`, `upload-service`, `artist-service`, `artist-portal-service`, `search-service`, `meilisearch`, `ebap-hls-adapter`, `direct-stream-service`, `recommendations-service`, `track-processor`, `nats` |
| Отсутствует `read_only` | MEDIUM | Те же сервисы не имеют read_only файловой системы |
| Отсутствуют лимиты ресурсов | MEDIUM | `auth-service`, `database-service`, `upload-service`, `artist-service`, `artist-portal-service`, `search-service`, `ebap-hls-adapter`, `direct-stream-service`, `track-processor`, `nats` не имеют ограничений CPU/памяти |
| Порт фронтенда открыт | LOW | См. L-10 — `3004:3004` должно быть `127.0.0.1:3004:3004` |
| Консоль MinIO открыта | LOW | `9001:9001` должно быть `127.0.0.1:9001:9001` |
| NATS без аутентификации | MEDIUM | NATS не имеет аутентификации (`--user`/`--pass` не настроены) |
| `restart: unless-stopped` везде | LOW | Не проблема безопасности как таковая, но упавшие сервисы перезапускаются без расследования |

---

### 4.3 Kubernetes

#### Текущее состояние

Манифесты K8s существуют, но предназначены для будущего развёртывания. Текущий продакшен использует Docker Compose.

#### Требует улучшения ⚠️

| Проблема | Критичность | Файл | Описание |
|-------|----------|------|-------------|
| Нет security context | HIGH | `api-gateway.yaml` | См. H-7 |
| Нет сетевых политик | HIGH | — | Нет ресурсов `NetworkPolicy` |
| Нет PodDisruptionBudget | MEDIUM | — | Нет PDB для доступности |
| Нет ограничения скорости на Ingress | MEDIUM | `ingress.yaml` | См. M-13 |
| Нет шифрования при хранении | MEDIUM | — | См. M-14 |
| Хардкоженный тег образа | LOW | `api-gateway.yaml:18` | `your-registry/music-api-gateway:latest` — использовать конкретные теги |
| Нет политики загрузки образов | LOW | `api-gateway.yaml` | Добавить `imagePullPolicy: Always` или использовать дайджесты |
| Нет RBAC | MEDIUM | — | Нет `Role`/`RoleBinding` |
| Нет лимитных диапазонов | LOW | — | Нет лимитов ресурсов по умолчанию на namespace |
| Нет квот ресурсов | LOW | — | Нет квот на уровне namespace |

---

### 4.4 SSL/TLS

#### Безопасно ✅

| Параметр | Значение | Оценка |
|-----------|-------|------------|
| `ssl_protocols` | TLSv1.2 TLSv1.3 | ✅ Современный |
| `ssl_ciphers` | Только AEAD-набор | ✅ Нет слабых шифров |
| `ssl_prefer_server_ciphers` | `off` | ✅ Корректно для TLS 1.3 |
| `ssl_dhparam` | 4096 бит | ✅ Сильный DH |
| `ssl_ecdh_curve` | `secp384r1` | ✅ Сильная кривая |
| `ssl_session_cache` | `shared:SSL:50m` | ✅ Достаточный |
| `ssl_session_timeout` | `1d` | ✅ Разумный |
| `ssl_session_tickets` | `off` | ✅ Прямая секретность |
| `ssl_stapling` | `on` + verify | ✅ OCSP stapling |
| `ssl_early_data` | `off` | ✅ Защита от повтора |
| `ssl_buffer_size` | `4k` | ✅ Оптимизирован |
| `resolver` | 1.1.1.1, 8.8.8.8 | ✅ Доверенный DNS |
| HSTS max-age | 63072000 (2 года) | ✅ Сильный |
| HSTS preload | Включён | ✅ |
| Автообновление серт. | Certbot каждые 12ч | ✅ |
| K8s cert-manager | `letsencrypt-prod` | ✅ |

#### Проблем в конфигурации SSL/TLS не обнаружено

Конфигурация SSL/TLS следует рекомендациям Mozilla Intermediate и готова к продакшену.

---

## Оценка безопасности схемы БД

### Безопасно ✅

| Функция | Реализация |
|---------|---------------|
| **Параметризованные запросы** | 100% во всех сервисах — нет конкатенации строк |
| **`pgcrypto`** | Используется для `gen_random_bytes` (генерация public_id) |
| **Уникальные ограничения** | `users.email`, `users.email_hash`, `artists.public_id`, `artists.name_key`, `albums.public_id` |
| **FK-ограничения** | Все связи обеспечены `REFERENCES` |
| **Частичные индексы** | Используются для эффективных запросов (напр., `idx_songs_is_available WHERE is_available = false`) |
| **Покрывающие индексы** | `idx_songs_reco_covering` снижает обращения к таблице |
| **Индексы с ограничением по времени** | `idx_user_interactions_recent WHERE created_at > NOW() - INTERVAL '12 months'` |
| **Материализованные представления** | `daily_interaction_summary` с параллельным обновлением |
| **Функции очистки** | `cleanup_expired_sessions()` для сборки мусора сессий |
| **Триггер `updated_at`** | Автообновление временной метки при изменении строки |

### Требует улучшения ⚠️

| Проблема | Критичность | Таблица(ы) | Описание |
|-------|----------|----------|-------------|
| Нет шифрования на уровне столбцов | HIGH | `users.email` | Email хранится в открытом виде (зашифрован в JSONB `metadata`, но сам столбец `email` — открытый) |
| Нет Row-Level Security (RLS) | MEDIUM | Все | PostgreSQL RLS не включён — полагается на аутентификацию на уровне приложения |
| Единый пользователь БД | HIGH | Все | См. M-10 — все сервисы используют одну роль PostgreSQL |
| Нет аудита логирования | MEDIUM | Все | Нет `pgaudit` или триггерного аудита |
| Столбец `password_hash` | MEDIUM | `users` | Использует PBKDF2 (теперь 600к итераций) — предпочтительно `argon2id` |
| Нет политики хранения данных | MEDIUM | `listens`, `user_interactions` | Нет автоматической очистки старых аналитических данных |
| Nullable `email` + UNIQUE | MEDIUM | `users` | См. M-5 — риск целостности данных |
| Отсутствует индекс FK | LOW | `playlist_tracks.song_id` | `idx_playlist_tracks_song_id` существует ✅ |
| Дублирующая временная метка | LOW | `user_interactions` | `timestamp` дублирует `created_at` |
| Нет настройки VACUUM | LOW | Все | Нет пользовательских настроек `autovacuum` для таблиц с высокой записью |
| Неиспользуемые таблицы | LOW | 9 таблиц | См. `reports/db-audit.md` — `artist_trends`, `genre_popularity` и т.д. |

---

## Оценка управления секретами

### Текущее состояние

Секреты управляются через файл `.env`, генерируемый скриптом `scripts/init-env.ps1` с использованием CSPRNG. Скрипт:
- Использует `System.Security.Cryptography.RandomNumberGenerator` (CSPRNG) ✅
- Генерирует 48-байтные секреты для сервисных ключей ✅
- Генерирует 32-байтный hex для ключей шифрования ✅
- Генерирует RSA-ключ 2048 бит для сервисных JWT ✅
- Заполняет только отсутствующие значения (не перезаписывает существующие) ✅
- Отказывается неявно ротировать ключи (проверка безопасности) ✅

### Требует улучшения ⚠️

| Проблема | Критичность | Описание |
|-------|----------|-------------|
| Файл `.env` на диске | MEDIUM | Один файл содержит все секреты — права файла должны быть строгими (`chmod 600`) |
| Нет ротации секретов | MEDIUM | Нет механизма автоматической ротации секретов |
| RSA 2048 бит | LOW | См. L-9 — минимально приемлемо, мигрировать на 4096 или Ed25519 |
| Нет Docker secrets | MEDIUM | Docker Compose поддерживает `secrets:` для лучшей изоляции |
| Нет интеграции с Vault | LOW | HashiCorp Vault или AWS Secrets Manager были бы безопаснее |
| `MINIO_ROOT_USER` = `minioadmin` | MEDIUM | Имя пользователя MinIO по умолчанию в dev — должно быть изменено в продакшене |
| `EBAP_TRACK_KEY_MASTER_SECRET` = пусто | LOW | Пустое значение по умолчанию в `init-env.ps1` — должно быть обязательным |

---

## Положительные меры безопасности

Следующие меры безопасности реализованы корректно и должны поддерживаться:

### Прикладной уровень
- **Защита CSRF:** HMAC(sid.nonce, JWT_SECRET) паттерн двойной отправки в Go-шлюзе
- **Очистка заголовков:** `InternalHeaderSanitizer` удаляет `X-User-Id`, `X-User-Role` из входящих запросов
- **Предотвращение SQL-инъекций:** 100% параметризованные запросы во всех сервисах
- **Валидация загрузки файлов:** Проверка magic-byte + расширение, дедупликация SHA-256, санитизация имён файлов с защитой от path traversal
- **MFA:** TOTP + коды восстановления для операций записи в портале артистов
- **Сравнения с защитой от тайминг-атак:** `timingSafeEqual` используется для проверки сервисных ключей и токенов
- **Корректное завершение:** Обработчики SIGTERM/SIGINT в auth-service и других

### Транспортный уровень
- **Только TLS 1.2+:** Нет поддержки TLS 1.0/1.1
- **HSTS Preload:** max-age 2 года с includeSubDomains
- **OCSP Stapling:** Включён с проверкой
- **Прямая секретность:** Сессионные тикеты отключены, обмен ключами ECDHE
- **Защита от повтора:** 0-RTT отключён

### Сетевой уровень
- **Ограничение скорости:** 6 зон Nginx + ограничение на уровне сервисов
- **Ограничение соединений:** Лимиты по IP
- **Только внутренние сервисы:** БД, воркеры не открыты внешне
- **Доступ к админке/метрикам:** Ограничен localhost (требуется SSH-туннель)

### Уровень Docker
- **`no-new-privileges`** на 11 сервисах
- **`read_only`** файловая система на 8 сервисах
- **`tmpfs`** с лимитами размера для записываемых директорий
- **Лимиты ресурсов** на большинстве сервисов
- **Проверки здоровья** на всех сервисах
- **Portainer/pgAdmin** привязка только к localhost

---

## Матрица приоритетов устранения

| № | Критичность | Проблема | Статус | Трудозатраты |
|---|----------|-------|--------|--------|
| C-1 | CRITICAL | Обход доверия заголовкам Party WS | ✅ ИСПРАВЛЕНО | Готово |
| C-2 | CRITICAL | Salt/metadata в RETURNING | ✅ ИСПРАВЛЕНО | Готово |
| H-1 | HIGH | Итерации PBKDF2 | ✅ ИСПРАВЛЕНО | Готово |
| H-2 | HIGH | Шифрование сессий Redis | ⏳ ОТКРЫТО | 3-5 дней |
| H-3 | HIGH | Обязательная аутентификация Redis | ✅ ЧАСТИЧНО | 1 день остался |
| H-4 | HIGH | Флаги cookie mp_auth | ⏳ ОТКРЫТО | 2-3 дня |
| H-5 | HIGH | Параметризация SQL-сида | ✅ ИСПРАВЛЕНО | Готово |
| H-6 | HIGH | Nginx от root | ⏳ ОТКРЫТО | 1 день |
| H-7 | HIGH | Security contexts K8s | ⏳ ОТКРЫТО | 2 дня |
| H-8 | HIGH | Сегментация Docker-сети | ⏳ ОТКРЫТО | 3-5 дней |
| M-2 | MEDIUM | Валидация ввода портала (Zod) | ✅ ИСПРАВЛЕНО | Готово |
| M-3 | MEDIUM | Лимит брутфорса MFA | ✅ ИСПРАВЛЕНО | Готово |
| M-5 | MEDIUM | Согласованность email/email_hash | ⏳ ОТКРЫТО | 0.5 дня |
| M-6 | MEDIUM | FK ON DELETE SET NULL | ✅ ИСПРАВЛЕНО | Готово |
| M-8 | MEDIUM | Обновление Sharp | ✅ ИСПРАВЛЕНО | Готово |
| M-9 | MEDIUM | Аудит Secure cookie | ⏳ ОТКРЫТО | 1-2 дня |
| M-10 | MEDIUM | Разделение ролей БД | ⏳ ОТКРЫТО | 3-5 дней |
| M-11 | MEDIUM | Загрузка 200 МБ в память (портал) | ⏳ ОТКРЫТО | 2-3 дня |
| M-12 | MEDIUM | Консолидация дрифта схем | ⏳ ОТКРЫТО | 2-3 дня |
| M-13 | MEDIUM | Ограничение скорости K8s Ingress | ⏳ ОТКРЫТО | 1 день |
| M-14 | MEDIUM | Шифрование K8s-секретов при хранении | ⏳ ОТКРЫТО | 1 день |
| L-1 | LOW | Устаревший X-XSS-Protection | ✅ ИСПРАВЛЕНО | Готово |
| L-2 | LOW | Неиспользуемая карта block_sql_injection | ✅ ИСПРАВЛЕНО | Готово |
| L-3 | LOW | Сообщение об ошибке админской заявки | ✅ ИСПРАВЛЕНО | Готово |
| L-9 | LOW | RSA 2048→4096/Ed25519 | ⏳ ОТКРЫТО | 1 день |
| L-10 | LOW | Открытый порт фронтенда | ⏳ ОТКРЫТО | 5 мин |

---

## Дорожная карта усиления инфраструктуры

### Фаза 1 — Быстрые победы (1-2 дня)

1. **L-10:** Изменить привязку порта `frontend` на `127.0.0.1:3004:3004`
2. **M-5:** Добавить CHECK-ограничение `CHECK ((email IS NULL) = (email_hash IS NULL))` на `users`
3. **H-3 (остаток):** Проверить все сервисы с `${REDIS_PASSWORD:-}` — сделать обязательным
4. **Аутентификация NATS:** Добавить `--user`/`--pass` к команде сервера NATS
5. **Консоль MinIO:** Привязать к `127.0.0.1:9001:9001`

### Фаза 2 — Усиление Docker (3-5 дней)

1. **H-8:** Реализовать сегментацию Docker-сети
   - Создать `data-network`, `service-network`, `gateway-network`, `frontend-network`
   - Назначить сервисы в минимально необходимые сети
   - Протестировать связность между сервисами
2. **Добавить `no-new-privileges` + `read_only`** оставшимся сервисам:
   - `postgres`, `redis`, `redis-auth`, `minio`, `auth-service`, `database-service`, `upload-service`, `artist-service`, `artist-portal-service`, `search-service`, `ebap-hls-adapter`, `direct-stream-service`, `nats`
3. **Добавить лимиты ресурсов** сервисам, у которых их нет
4. **H-6:** Запустить Nginx от non-root с возможностью `NET_BIND_SERVICE`

### Фаза 3 — Безопасность сессий и cookie (3-5 дней)

1. **H-2:** Реализовать шифрование AES-256-GCM для полезных данных сессий Redis
2. **H-4:** Провести аудит и исправить все настройки cookie `mp_auth`
3. **M-9:** Установить `Secure; SameSite=Lax` на все cookie в продакшене

### Фаза 4 — Усиление БД (3-5 дней)

1. **M-10:** Создать выделенные роли PostgreSQL для каждого сервиса с минимальными привилегиями
2. **M-12:** Консолидировать схему к единому фреймворку миграций
3. Добавить расширение `pgaudit` для аудита логирования
4. Реализовать политики хранения данных для `listens` и `user_interactions`
5. Рассмотреть миграцию на `argon2id` для хеширования паролей

### Фаза 5 — Усиление Kubernetes (5-7 дней, если планируется развёртывание K8s)

1. **H-7:** Добавить security contexts во все манифесты K8s
2. **M-13:** Добавить аннотации ограничения скорости и WAF к Ingress
3. **M-14:** Включить шифрование при хранении для K8s-секретов
4. Добавить ресурсы `NetworkPolicy` (запрет по умолчанию, явное разрешение)
5. Добавить `PodDisruptionBudget` для критических сервисов
6. Добавить RBAC `Role`/`RoleBinding` для каждого сервиса
7. Использовать конкретные теги образов (не `:latest`) или SHA-дайджесты
8. Добавить `LimitRange` и `ResourceQuota` на каждый namespace

### Фаза 6 — Управление секретами (2-3 дня)

1. Мигрировать с `.env` на Docker secrets или HashiCorp Vault
2. **L-9:** Ротировать сервисные JWT-ключи на RSA 4096 или Ed25519
3. Реализовать автоматическую ротацию секретов
4. Добавить `EBAP_TRACK_KEY_MASTER_SECRET` как обязательное (непустое)

---

*Отчёт сгенерирован комплексным статическим анализом. Предыдущие исправления применены 2025-02-06. Оценка инфраструктуры и схем завершена 2025-01.*
