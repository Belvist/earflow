# Known Issues Verification Report

Верификация статуса известных проблем из comprehensive-security-plan.md.

**Дата:** 2025-01  
**Источник:** reports/comprehensive-security-plan.md

---

## H-2: JWT Refresh-токен хранится в Redis без шифрования

**Статус в плане:** ⏳ ОТКРЫТО  
**Верификация:** ⚠️ НЕПОЛНАЯ

**Evidence:**
- `backend/go-api-gateway/internal/auth/session_crypto.go` — Реализована функция `newSessionCipherFromEnv()` которая читает `SESSION_ENCRYPTION_KEY`
- `backend/go-api-gateway/internal/auth/session_store.go` — SessionStore использует cipher для шифрования/дешифрования

**Проверка:**
```bash
# Проверяем, используется ли SESSION_ENCRYPTION_KEY в production
grep -r "SESSION_ENCRYPTION_KEY" docker-compose.yml
```

**Результат:**
- SESSION_ENCRYPTION_KEY определён в docker-compose.yml для go-api-gateway
- Код для шифрования сессий существует
- **НЕПРОВЕРЕНО:** Установлен ли SESSION_ENCRYPTION_KEY в production environment
- **НЕПРОВЕРЕНО:** Включено ли шифрование в production config

**Рекомендация:** Проверить production environment variables и убедиться, что SESSION_ENCRYPTION_KEY установлен и не пустой.

---

## H-3: Redis доступен без обязательной аутентификации

**Статус в плане:** ✅ ЧАСТИЧНО ИСПРАВЛЕНО  
**Верификация:** ⚠️ ПОТЕНЦИАЛЬНАЯ ПРОБЛЕМА

**Evidence:**
- `docker-compose.yml` — Проверка REDIS_PASSWORD в сервисах

**Сервисы с обязательным паролем Redis:**
- auth-service
- party-go (party-gateway, party-state)

**Сервисы с опциональным паролем Redis (REDIS_PASSWORD:-):**
- artist-api-gateway
- recommendations-service
- playlist-service
- lyrics-service
- party-state-service
- api-gateway

**Риск:** Если REDIS_PASSWORD не установлен в production, Redis работает без аутентификации в Docker-сети.

**Рекомендация:** Установить REDIS_PASSWORD во всех сервисах и убрать default значение `:-`.

---

## H-4: Отсутствует проверка флага httpOnly для cookie mp_auth

**Статус в плане:** ⏳ ОТКРЫТО  
**Верификация:** ⚠️ НЕПОЛНАЯ

**Evidence:**
- `backend/go-api-gateway/internal/config/config.go:84-92` — CookieConfig с HttpOnly, Secure, SameSite
- `backend/upload-service/middleware/authenticateUser.js:51` — Чтение mp_auth из cookie (не установка)
- `backend/artist-portal-service/server.js:349` — Чтение mp_auth из cookie (не установка)

**Проверка:**
- Gateway устанавливает cookie с флагами из config
- Node сервисы только читают mp_auth, не устанавливают
- **НЕПРОВЕРЕНО:** Устанавливает ли gateway HttpOnly для mp_auth
- **НЕПРОВЕРЕНО:** Используется ли mp_auth вообще в production или только mp_sid

**Рекомендация:** Проверить production config и убедиться, что cookie устанавливаются с HttpOnly; Secure; SameSite=Lax.

---

## H-6: Мастер-процесс Nginx работает от root внутри контейнера

**Статус в плане:** ⏳ ОТКРЫТО  
**Верификация:** ✅ ПОДТВЕРЖДЕНО

**Evidence:**
- `nginx/Dockerfile:132-135` — Коммент: "Работает от root для привязки к порту 80, но воркеры Nginx работают от пользователя nginx"

**Проверка:**
```dockerfile
# nginx/Dockerfile
USER nginx
```

**Результат:**
- Dockerfile НЕ содержит `USER nginx` в конце
- Мастер-процесс Nginx работает от root
- Воркеры работают от nginx (стандартное поведение Nginx)

**Риск:** При компрометации мастер-процесса (zero-day Nginx) возможен выход из контейнера.

**Рекомендация:** Изменить внутренний порт на 8080 и добавить `USER nginx` в Dockerfile.

---

## H-7: Манифесты Kubernetes не содержат security contexts

**Статус в плане:** ⏳ ОТКРЫТО  
**Верификация:** ⚠️ НЕПРОВЕРЕНО

**Evidence:**
- `k8s/api-gateway.yaml` — (нужно проверить)
- `k8s/ingress.yaml` — (нужно проверить)

**Проверка:** Не выполнена — файлы k8s не проверены в этом аудите.

**Рекомендация:** Проверить все k8s манифесты на наличие securityContext (runAsNonRoot, readOnlyRootFilesystem, allowPrivilegeEscalation).

---

## H-8: Плоская Docker-сеть — нет сегментации

**Статус в плане:** ⏳ ОТКРЫТО  
**Верификация:** ✅ ПОДТВЕРЖДЕНО

**Evidence:**
- `docker-compose.yml:1860-1862` — Все сервисы используют сеть `music-network`

**Проверка:**
```yaml
networks:
  default:
    name: music-network
    external: true
```

**Результат:**
- Все 25+ сервисов используют единую сеть music-network
- Нет разделения на frontend-network, gateway-network, service-network, data-network
- PostgreSQL, Redis, MinIO доступны всем сервисам

**Риск:** Скомпрометированный сервис может обращаться к любой БД и хранилищу.

**Рекомендация:** Создать отдельные сети для разных слоёв (frontend, gateway, service, data).

---

## M-10: Нет разделения ролей БД — единый суперпользователь для всех сервисов

**Статус в плане:** ⏳ ОТКРЫТО  
**Верификация:** ✅ ПОДТВЕРЖДЕНО

**Evidence:**
- `docker-compose.yml` — Все сервисы используют `${DB_USER}:${DB_PASSWORD}`
- `SECURITY_VERIFICATION.md` — SQL queries используют parameterized queries (хорошо), но все сервисы используют одинаковые credentials

**Проверка:**
```yaml
# Все сервисы используют одни и те же credentials
DB_USER=music_user
DB_PASSWORD=music_password
```

**Результат:**
- Все сервисы подключаются к PostgreSQL с одинаковыми credentials
- music_user имеет полный доступ ко всем таблицам
- Нет разделения на auth_app, db_app, upload_app, playlist_app, lyrics_app, reco_app

**Риск:** Скомпрометированный сервис может читать/изменять любую таблицу.

**Рекомендация:** Создать отдельные роли PostgreSQL для каждого сервиса с минимальными привилегиями.

---

## M-11: artist-portal-service — Загрузка 200 МБ песни в память

**Статус в плане:** ⏳ ОТКРЫТО  
**Верификация:** ✅ ПОДТВЕРЖДЕНО

**Evidence:**
- `backend/artist-portal-service/routes/tracks.js:73` — `songUpload.single('file')` с multer.memoryStorage()

**Проверка:**
```javascript
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 200 * 1024 * 1024 } // 200 MB
});
```

**Результат:**
- artist-portal-service использует multer.memoryStorage()
- Лимит 200 MB
- Параллельные загрузки могут вызвать OOM

**Риск:** DoS через параллельные загрузки больших файлов.

**Рекомендация:** Использовать multer.diskStorage() или потоковый прокси к upload-service.

---

## M-12: Дрифт схем — несколько источников DDL для одних и тех же таблиц

**Статус в плане:** ⏳ ОТКРЫТО  
**Верификация:** ⚠️ НЕПОЛНАЯ

**Evidence:**
- `backend/00-create-tables.sql` — Initial schema
- `backend/02-recommendations-schema.sql` — Recommendations schema
- `backend/03-subscription-schema.sql` — Subscription schema
- `backend/04-mood-schema.sql` — Mood schema

**Проверка:**
- Несколько файлов .sql с DDL
- **НЕПРОВЕРЕНО:** Есть ли пересекающиеся таблицы между файлами
- **НЕПРОВЕРЕНО:** Есть ли дрифт схем

**Рекомендация:** Проверить пересекающиеся таблицы и консолидировать к единому источнику истины.

---

## M-13: K8s Ingress — Нет ограничений скорости или аннотаций WAF

**Статус в плане:** ⏳ ОТКРЫТО  
**Верификация:** ⚠️ НЕПРОВЕРЕНО

**Evidence:**
- `k8s/ingress.yaml` — (нужно проверить)

**Проверка:** Не выполнена — файлы k8s не проверены в этом аудите.

**Рекомендация:** Проверить k8s/ingress.yaml на наличие аннотаций rate limiting и WAF.

---

## M-14: K8s ConfigMap/Secrets — Нет шифрования при хранении

**Статус в плане:** ⏳ ОТКРЫТО  
**Верификация:** ⚠️ НЕПРОВЕРЕНО

**Evidence:**
- `k8s/configmap.yaml` — (нужно проверить)
- `k8s/secrets.yaml` — (нужно проверить)

**Проверка:** Не выполнена — файлы k8s не проверены в этом аудите.

**Рекомендация:** Проверить k8s ConfigMap/Secrets и включить шифрование при хранении.

---

## L-9: SERVICE_JWT_PRIVATE_KEY_B64 — RSA-ключ 2048 бит

**Статус в плане:** ⏳ ОТКРЫТО  
**Верификация:** ✅ ПОДТВЕРЖДЕНО

**Evidence:**
- `scripts/init-env.ps1:193` — Генерация RSA 2048 бит

**Проверка:**
```powershell
$rsa = [System.Security.Cryptography.RSA]::Create(2048)
```

**Результат:**
- RSA ключ 2048 бит
- NIST рекомендует 3072 бит для периода после 2030 года

**Риск:** RSA 2048 бит минимально приемлем, но рекомендуется migrate на RSA 4096 или Ed25519.

**Рекомендация:** Запланировать миграцию на RSA 4096 или Ed25519 для сервисных JWT.

---

## L-10: Порт frontend 3004 открыт для хоста

**Статус в плане:** ⏳ ОТКРЫТО  
**Верификация:** ✅ ПОДТВЕРЖДЕНО

**Evidence:**
- `docker-compose.yml:1709-1710` — `"3004:3004"`

**Проверка:**
```yaml
ports:
  - "3004:3004"
```

**Результат:**
- Frontend порт 3004 открыт на все интерфейсы (0.0.0.0:3004)
- Обходит TLS/заголовки безопасности Nginx

**Риск:** Прямой доступ к frontend без TLS.

**Рекомендация:** Изменить на `"127.0.0.1:3004:3004"` или удалить порт (Nginx проксирует).

---

## Summary

| Issue ID | Status in Plan | Verification | Current Status |
|----------|---------------|--------------|----------------|
| H-2 | ⏳ ОТКРЫТО | ⚠️ НЕПОЛНАЯ | ⏳ ОТКРЫТО (код есть, env не проверен) |
| H-3 | ✅ ЧАСТИЧНО | ⚠️ ПОТЕНЦИАЛЬНАЯ | ⚠️ ПОТЕНЦИАЛЬНАЯ (некоторые сервисы с опциональным паролем) |
| H-4 | ⏳ ОТКРЫТО | ⚠️ НЕПОЛНАЯ | ⏳ ОТКРЫТО (gateway config не проверен) |
| H-6 | ⏳ ОТКРЫТО | ✅ ПОДТВЕРЖДЕНО | ⏳ ОТКРЫТО |
| H-7 | ⏳ ОТКРЫТО | ⚠️ НЕПРОВЕРЕНО | ⏳ ОТКРЫТО (k8s не проверены) |
| H-8 | ⏳ ОТКРЫТО | ✅ ПОДТВЕРЖДЕНО | ⏳ ОТКРЫТО |
| M-10 | ⏳ ОТКРЫТО | ✅ ПОДТВЕРЖДЕНО | ⏳ ОТКРЫТО |
| M-11 | ⏳ ОТКРЫТО | ✅ ПОДТВЕРЖДЕНО | ⏳ ОТКРЫТО |
| M-12 | ⏳ ОТКРЫТО | ⚠️ НЕПОЛНАЯ | ⏳ ОТКРЫТО |
| M-13 | ⏳ ОТКРЫТО | ⚠️ НЕПРОВЕРЕНО | ⏳ ОТКРЫТО (k8s не проверены) |
| M-14 | ⏳ ОТКРЫТО | ⚠️ НЕПРОВЕРЕНО | ⏳ ОТКРЫТО (k8s не проверены) |
| L-9 | ⏳ ОТКРЫТО | ✅ ПОДТВЕРЖДЕНО | ⏳ ОТКРЫТО |
| L-10 | ⏳ ОТКРЫТО | ✅ ПОДТВЕРЖДЕНО | ⏳ ОТКРЫТО |

**Confirmed Open Issues:** 7  
**Partially Verified Issues:** 3  
**K8s Issues Not Verified:** 3

**Top Priority Issues:**
1. H-8: Плоская Docker-сеть — высокий риск горизонтального перемещения
2. M-10: Нет разделения ролей БД — высокий риск доступа к данным
3. H-6: Nginx от root — риск выхода из контейнера
4. L-10: Frontend порт открыт — риск обхода TLS
5. M-11: Загрузка 200 MB в память — риск DoS

**Next Steps:**
1. Проверить k8s манифесты (H-7, M-13, M-14)
2. Проверить production environment variables для SESSION_ENCRYPTION_KEY (H-2)
3. Проверить production config для cookie flags (H-4)
4. Установить обязательный REDIS_PASSWORD во всех сервисах (H-3)
