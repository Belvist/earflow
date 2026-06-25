#!/bin/bash
# =============================================================================
# EarFlow Music Platform - Production Control Script
# =============================================================================
# Версия: 2.0.0
# Автор: EarFlow Team
# 
# ИСПОЛЬЗОВАНИЕ:
#   ./platform-control.sh [command] [options]
#
# КОМАНДЫ:
#   start       - Запустить платформу
#   stop        - Остановить платформу
#   restart     - Перезапустить платформу
#   status      - Показать статус сервисов
#   logs        - Показать логи
#   build       - Пересобрать сервисы
#   health      - Проверить здоровье сервисов
#   backup      - Создать бэкап данных
#   update      - Обновить и перезапустить
#   scale       - Масштабировать сервис
# =============================================================================

set -euo pipefail

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Конфигурация
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"
ENV_FILE="${PROJECT_DIR}/.env"
BACKUP_DIR="${PROJECT_DIR}/backups"
LOG_FILE="${PROJECT_DIR}/logs/platform.log"

# Проверка что мы в правильной директории
check_directory() {
    if [[ ! -f "$COMPOSE_FILE" ]]; then
        echo -e "${RED}❌ Ошибка: docker-compose.yml не найден в ${PROJECT_DIR}${NC}"
        echo -e "${YELLOW}   Запустите скрипт из директории проекта${NC}"
        exit 1
    fi
    
    if [[ ! -f "$ENV_FILE" ]]; then
        echo -e "${RED}❌ Ошибка: .env файл не найден${NC}"
        echo -e "${YELLOW}   Скопируйте .env.example в .env и настройте переменные${NC}"
        exit 1
    fi
}

# Логирование
log() {
    local level=$1
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    mkdir -p "$(dirname "$LOG_FILE")"
    echo "[${timestamp}] [${level}] ${message}" >> "$LOG_FILE"
    
    case $level in
        INFO)  echo -e "${GREEN}✅ ${message}${NC}" ;;
        WARN)  echo -e "${YELLOW}⚠️  ${message}${NC}" ;;
        ERROR) echo -e "${RED}❌ ${message}${NC}" ;;
        DEBUG) echo -e "${CYAN}🔍 ${message}${NC}" ;;
    esac
}

# =============================================================================
# ОСНОВНЫЕ КОМАНДЫ
# =============================================================================

# Запуск платформы
cmd_start() {
    log INFO "Запуск EarFlow Platform..."
    
    cd "$PROJECT_DIR"
    
    # Проверяем Docker
    if ! docker info &>/dev/null; then
        log ERROR "Docker не запущен!"
        exit 1
    fi
    
    # Запускаем сервисы в правильном порядке
    log INFO "Запуск инфраструктурных сервисов..."
    docker compose up -d postgres redis minio
    
    log INFO "Ожидание готовности баз данных (30 сек)..."
    sleep 30
    
    log INFO "Запуск остальных сервисов..."
    docker compose up -d
    
    log INFO "Ожидание инициализации (15 сек)..."
    sleep 15
    
    cmd_status
    
    log INFO "Платформа запущена!"
    echo ""
    echo -e "${GREEN}🎵 EarFlow доступен по адресу: https://earflow.ru${NC}"
}

# Остановка платформы
cmd_stop() {
    log INFO "Остановка EarFlow Platform..."
    
    cd "$PROJECT_DIR"
    docker compose down
    
    log INFO "Платформа остановлена"
}

# Перезапуск
cmd_restart() {
    log INFO "Перезапуск EarFlow Platform..."
    cmd_stop
    sleep 5
    cmd_start
}

# Статус сервисов
cmd_status() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}          EarFlow Platform - Статус сервисов               ${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    
    cd "$PROJECT_DIR"
    
    # Получаем статус контейнеров
    docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || \
    docker compose ps
    
    echo ""
    echo -e "${BLUE}─────────────────────────────────────────────────────────────${NC}"
    
    # Проверяем здоровье ключевых сервисов
    echo -e "\n${CYAN}Проверка здоровья сервисов:${NC}"
    
    local services=("music-postgres" "music-redis" "music-minio" "music-upload-service" "music-frontend" "music-nginx-lb")
    
    for service in "${services[@]}"; do
        local status=$(docker inspect --format='{{.State.Health.Status}}' "$service" 2>/dev/null || echo "unknown")
        local running=$(docker inspect --format='{{.State.Running}}' "$service" 2>/dev/null || echo "false")
        
        if [[ "$status" == "healthy" ]]; then
            echo -e "  ${GREEN}✓${NC} $service: ${GREEN}healthy${NC}"
        elif [[ "$running" == "true" ]]; then
            echo -e "  ${YELLOW}○${NC} $service: ${YELLOW}running (${status})${NC}"
        else
            echo -e "  ${RED}✗${NC} $service: ${RED}stopped${NC}"
        fi
    done
    
    echo ""
}

# Просмотр логов
cmd_logs() {
    local service="${1:-}"
    local lines="${2:-100}"
    
    cd "$PROJECT_DIR"
    
    if [[ -n "$service" ]]; then
        docker compose logs -f --tail="$lines" "$service"
    else
        docker compose logs -f --tail="$lines"
    fi
}

# Сборка сервисов с retry для npm
cmd_build() {
    local service="${1:-}"
    local max_retries=3
    local retry=0
    
    log INFO "Сборка сервисов..."
    
    cd "$PROJECT_DIR"
    
    # Очистка Docker cache если нужно
    if [[ "${CLEAN_BUILD:-false}" == "true" ]]; then
        log INFO "Очистка Docker build cache..."
        docker builder prune -f
    fi
    
    while [[ $retry -lt $max_retries ]]; do
        if [[ -n "$service" ]]; then
            if docker compose build --no-cache "$service" 2>&1; then
                log INFO "Сборка $service завершена успешно"
                return 0
            fi
        else
            if docker compose build --no-cache 2>&1; then
                log INFO "Сборка всех сервисов завершена успешно"
                return 0
            fi
        fi
        
        retry=$((retry + 1))
        log WARN "Попытка $retry/$max_retries не удалась, повтор через 10 секунд..."
        sleep 10
    done
    
    log ERROR "Сборка не удалась после $max_retries попыток"
    return 1
}

# Проверка здоровья
cmd_health() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}          EarFlow Platform - Health Check                  ${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    
    cd "$PROJECT_DIR"
    
    # PostgreSQL
    echo -n "PostgreSQL: "
    if docker exec music-postgres pg_isready -U "${DB_USER:-music_user}" &>/dev/null; then
        echo -e "${GREEN}OK${NC}"
        
        # Проверяем количество подключений
        local connections=$(docker exec music-postgres psql -U "${DB_USER:-music_user}" -d "${DB_NAME:-music_platform}" -t -c "SELECT count(*) FROM pg_stat_activity;" 2>/dev/null | tr -d ' ')
        echo -e "  └─ Активных подключений: ${connections:-N/A}"
    else
        echo -e "${RED}FAILED${NC}"
    fi
    
    # Redis
    echo -n "Redis: "
    if docker exec music-redis redis-cli ping &>/dev/null; then
        echo -e "${GREEN}OK${NC}"
        
        local redis_info=$(docker exec music-redis redis-cli info memory 2>/dev/null | grep used_memory_human | cut -d: -f2 | tr -d '\r')
        echo -e "  └─ Используемая память: ${redis_info:-N/A}"
    else
        echo -e "${RED}FAILED${NC}"
    fi
    
    # MinIO
    echo -n "MinIO: "
    if docker exec music-minio mc ready local &>/dev/null; then
        echo -e "${GREEN}OK${NC}"
    else
        echo -e "${RED}FAILED${NC}"
    fi
    
    # nginx
    echo -n "Nginx LB: "
    if curl -sf http://localhost:80/health &>/dev/null; then
        echo -e "${GREEN}OK${NC}"
    else
        # Пробуем внутренний healthcheck
        if docker exec music-nginx-lb nginx -t &>/dev/null; then
            echo -e "${YELLOW}CONFIG OK (port check failed)${NC}"
        else
            echo -e "${RED}FAILED${NC}"
        fi
    fi
    
    # Upload Service API
    echo -n "Upload Service: "
    if docker exec music-upload-service wget -q --spider http://localhost:3000/health 2>/dev/null; then
        echo -e "${GREEN}OK${NC}"
    else
        echo -e "${YELLOW}CHECKING...${NC}"
    fi
    
    # Диск
    echo ""
    echo -e "${CYAN}Использование диска:${NC}"
    df -h / | tail -1 | awk '{print "  └─ Всего: "$2", Использовано: "$3" ("$5"), Доступно: "$4}'
    
    # Docker volumes
    echo ""
    echo -e "${CYAN}Docker volumes:${NC}"
    docker system df --format "table {{.Type}}\t{{.Size}}\t{{.Reclaimable}}" 2>/dev/null | head -5
    
    echo ""
}

# Бэкап
cmd_backup() {
    local timestamp=$(date '+%Y%m%d_%H%M%S')
    local backup_path="${BACKUP_DIR}/${timestamp}"
    
    log INFO "Создание бэкапа в ${backup_path}..."
    
    mkdir -p "$backup_path"
    
    cd "$PROJECT_DIR"
    
    # PostgreSQL dump
    log INFO "Бэкап PostgreSQL..."
    docker exec music-postgres pg_dump -U "${DB_USER:-music_user}" "${DB_NAME:-music_platform}" | gzip > "${backup_path}/postgres.sql.gz"
    
    # Redis dump (если есть)
    log INFO "Бэкап Redis..."
    docker exec music-redis redis-cli BGSAVE &>/dev/null || true
    sleep 2
    docker cp music-redis:/data/dump.rdb "${backup_path}/redis.rdb" 2>/dev/null || true
    
    # Конфигурация
    log INFO "Бэкап конфигурации..."
    cp "$ENV_FILE" "${backup_path}/.env"
    cp "$COMPOSE_FILE" "${backup_path}/docker-compose.yml"
    
    # Архивируем
    cd "$BACKUP_DIR"
    tar -czf "${timestamp}.tar.gz" "$timestamp"
    rm -rf "$timestamp"
    
    log INFO "Бэкап создан: ${BACKUP_DIR}/${timestamp}.tar.gz"
    
    # Удаляем старые бэкапы (оставляем последние 7)
    ls -t "${BACKUP_DIR}"/*.tar.gz 2>/dev/null | tail -n +8 | xargs -r rm -f
    
    log INFO "Старые бэкапы очищены (оставлены последние 7)"
}

# Обновление с бэкапом
cmd_update() {
    log INFO "Обновление EarFlow Platform..."
    
    # Сначала бэкап
    cmd_backup
    
    cd "$PROJECT_DIR"
    
    # Pull latest code (если git)
    if [[ -d .git ]]; then
        log INFO "Обновление кода из git..."
        git pull origin main || log WARN "Git pull не удался, продолжаем с локальным кодом"
    fi
    
    # Пересборка
    cmd_build
    
    # Перезапуск
    cmd_restart
    
    log INFO "Обновление завершено!"
}

# Масштабирование
cmd_scale() {
    local service="$1"
    local replicas="${2:-2}"
    
    if [[ -z "$service" ]]; then
        echo "Использование: $0 scale <service> <replicas>"
        echo "Пример: $0 scale api-gateway 3"
        exit 1
    fi
    
    log INFO "Масштабирование $service до $replicas реплик..."
    
    cd "$PROJECT_DIR"
    docker compose up -d --scale "$service=$replicas"
    
    log INFO "Сервис $service масштабирован"
}

# =============================================================================
# УТИЛИТЫ
# =============================================================================

# Статистика пользователей
cmd_stats() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}          EarFlow Platform - Статистика                    ${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    
    cd "$PROJECT_DIR"
    
    # Количество пользователей
    local total_users=$(docker exec music-postgres psql -U "${DB_USER:-music_user}" -d "${DB_NAME:-music_platform}" -t -c "SELECT COUNT(*) FROM users;" 2>/dev/null | tr -d ' ')
    echo -e "👥 Всего пользователей: ${GREEN}${total_users:-N/A}${NC}"
    
    # Пользователи за сегодня
    local today_users=$(docker exec music-postgres psql -U "${DB_USER:-music_user}" -d "${DB_NAME:-music_platform}" -t -c "SELECT COUNT(*) FROM users WHERE created_at >= CURRENT_DATE;" 2>/dev/null | tr -d ' ')
    echo -e "📅 Новых сегодня: ${GREEN}${today_users:-N/A}${NC}"
    
    # Количество треков
    local total_songs=$(docker exec music-postgres psql -U "${DB_USER:-music_user}" -d "${DB_NAME:-music_platform}" -t -c "SELECT COUNT(*) FROM songs;" 2>/dev/null | tr -d ' ')
    echo -e "🎵 Всего треков: ${GREEN}${total_songs:-N/A}${NC}"
    
    # Количество прослушиваний
    local total_plays=$(docker exec music-postgres psql -U "${DB_USER:-music_user}" -d "${DB_NAME:-music_platform}" -t -c "SELECT COALESCE(SUM(play_count), 0) FROM songs;" 2>/dev/null | tr -d ' ')
    echo -e "▶️  Всего прослушиваний: ${GREEN}${total_plays:-N/A}${NC}"
    
    # Последние пользователи
    echo ""
    echo -e "${CYAN}Последние 5 пользователей:${NC}"
    docker exec music-postgres psql -U "${DB_USER:-music_user}" -d "${DB_NAME:-music_platform}" -c "SELECT id, username, created_at FROM users ORDER BY id DESC LIMIT 5;" 2>/dev/null || echo "  N/A"
    
    echo ""
}

# Очистка
cmd_clean() {
    log WARN "Очистка Docker ресурсов..."
    
    read -p "Это удалит неиспользуемые образы и контейнеры. Продолжить? (y/N) " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        docker system prune -f
        docker image prune -f
        log INFO "Очистка завершена"
    else
        log INFO "Очистка отменена"
    fi
}

# =============================================================================
# ПОМОЩЬ
# =============================================================================

show_help() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}     🎵 EarFlow Music Platform - Control Script            ${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "Использование: $0 <command> [options]"
    echo ""
    echo "Команды:"
    echo -e "  ${GREEN}start${NC}              Запустить платформу"
    echo -e "  ${GREEN}stop${NC}               Остановить платформу"
    echo -e "  ${GREEN}restart${NC}            Перезапустить платформу"
    echo -e "  ${GREEN}status${NC}             Показать статус сервисов"
    echo -e "  ${GREEN}health${NC}             Детальная проверка здоровья"
    echo -e "  ${GREEN}stats${NC}              Статистика пользователей и треков"
    echo -e "  ${GREEN}logs [service]${NC}     Показать логи (опционально: конкретного сервиса)"
    echo -e "  ${GREEN}build [service]${NC}    Пересобрать сервисы"
    echo -e "  ${GREEN}backup${NC}             Создать бэкап данных"
    echo -e "  ${GREEN}update${NC}             Обновить и перезапустить"
    echo -e "  ${GREEN}scale <svc> <n>${NC}    Масштабировать сервис"
    echo -e "  ${GREEN}clean${NC}              Очистить неиспользуемые Docker ресурсы"
    echo ""
    echo "Примеры:"
    echo "  $0 start                    # Запустить платформу"
    echo "  $0 logs upload-service 50   # Последние 50 строк логов"
    echo "  $0 build frontend           # Пересобрать только frontend"
    echo "  $0 scale api-gateway 3      # 3 реплики api-gateway"
    echo ""
    echo -e "${YELLOW}После перезагрузки сервера:${NC}"
    echo "  $0 start"
    echo ""
}

# =============================================================================
# MAIN
# =============================================================================

main() {
    local command="${1:-help}"
    shift || true
    
    # Загружаем переменные окружения
    if [[ -f "$ENV_FILE" ]]; then
        set -a
        source "$ENV_FILE"
        set +a
    fi
    
    case "$command" in
        start)   check_directory; cmd_start ;;
        stop)    check_directory; cmd_stop ;;
        restart) check_directory; cmd_restart ;;
        status)  check_directory; cmd_status ;;
        logs)    check_directory; cmd_logs "$@" ;;
        build)   check_directory; cmd_build "$@" ;;
        health)  check_directory; cmd_health ;;
        backup)  check_directory; cmd_backup ;;
        update)  check_directory; cmd_update ;;
        scale)   check_directory; cmd_scale "$@" ;;
        stats)   check_directory; cmd_stats ;;
        clean)   cmd_clean ;;
        help|--help|-h) show_help ;;
        *)
            echo -e "${RED}Неизвестная команда: $command${NC}"
            show_help
            exit 1
            ;;
    esac
}

main "$@"
