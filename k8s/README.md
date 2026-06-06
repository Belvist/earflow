# Kubernetes Deployment

## Быстрый старт

```bash
# 1. Создать namespace
kubectl apply -f namespace.yaml

# 2. Применить секреты (⚠️ сначала отредактируйте!)
kubectl apply -f secrets.yaml

# 3. Применить конфиг (⚠️ замените домены!)
kubectl apply -f configmap.yaml

# 4. Задеплоить сервисы
kubectl apply -f api-gateway.yaml
# ... остальные сервисы

# 5. Применить Ingress (⚠️ замените домен!)
kubectl apply -f ingress.yaml
```

## Сборка Docker образов

```bash
# В корне проекта
docker build -t your-registry/music-api-gateway:latest -f backend/api-gateway/Dockerfile backend/api-gateway
docker build -t your-registry/music-auth-service:latest -f backend/auth-service/Dockerfile backend/auth-service
# ... и так далее

# Push в registry
docker push your-registry/music-api-gateway:latest
```

## Структура сервисов

| Service | Port | Replicas |
|---------|------|----------|
| api-gateway | 3000 | 2 |
| auth-service | 3001 | 1 |
| upload-service | 3002 | 1 |
| database-service | 3003 | 1 |
| recommendations-service | 3006 | 1 |
| party-state-service (party-go) | 3130 | 1 |
| party-gateway-service (party-go) | 3131 | 1 |
| frontend | 3004 | 2 |
| postgres | 5432 | 1 |
| redis | 6379 | 1 |
| minio | 9000 | 1 |

## Полезные команды

```bash
# Статус подов
kubectl get pods -n music-platform

# Логи
kubectl logs -f deployment/api-gateway -n music-platform

# Перезапуск
kubectl rollout restart deployment/api-gateway -n music-platform

# Масштабирование
kubectl scale deployment/api-gateway --replicas=3 -n music-platform
```

## Helm (опционально)

Для более удобного деплоя рекомендуется создать Helm chart.
