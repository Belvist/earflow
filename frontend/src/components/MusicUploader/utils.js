/**
 * MusicUploader Utilities
 * 
 * Безопасные утилиты для работы с файлами.
 * 
 * @module MusicUploader/utils
 */

/**
 * Форматирует размер файла в человекочитаемый вид
 * @param {number} bytes - Размер в байтах
 * @returns {string}
 */
export function formatFileSize(bytes) {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
        return '0 B';
    }

    if (bytes === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB'];
    const k = 1024;
    const i = Math.min(
        Math.floor(Math.log(bytes) / Math.log(k)),
        units.length - 1
    );

    const size = bytes / Math.pow(k, i);
    const decimals = i > 0 ? 1 : 0;

    return `${size.toFixed(decimals)} ${units[i]}`;
}

/**
 * Генерирует уникальный ID для файла в очереди
 * Использует crypto API если доступен
 * @returns {string}
 */
export function generateFileId() {
    // Используем crypto.randomUUID если доступен (современные браузеры)
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return `file_${crypto.randomUUID()}`;
    }

    // Fallback для старых браузеров
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).slice(2, 11);
    return `file_${timestamp}_${randomPart}`;
}

/**
 * Безопасное экранирование HTML для отображения
 * Предотвращает XSS атаки
 * @param {string} text - Текст для экранирования
 * @returns {string}
 */
export function escapeHtml(text) {
    if (!text || typeof text !== 'string') return '';

    const escapeMap = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '/': '&#x2F;',
    };

    return text.replace(/[&<>"'/]/g, char => escapeMap[char]);
}

/**
 * Debounce функция для оптимизации обработчиков
 * @param {Function} fn - Функция
 * @param {number} delay - Задержка в мс
 * @returns {Function}
 */
export function debounce(fn, delay) {
    let timeoutId = null;

    return function debounced(...args) {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }

        timeoutId = setTimeout(() => {
            fn.apply(this, args);
            timeoutId = null;
        }, delay);
    };
}

/**
 * Throttle функция для ограничения частоты вызовов
 * @param {Function} fn - Функция
 * @param {number} limit - Минимальный интервал в мс
 * @returns {Function}
 */
export function throttle(fn, limit) {
    let lastRun = 0;
    let pendingRun = null;

    return function throttled(...args) {
        const now = Date.now();

        if (now - lastRun >= limit) {
            lastRun = now;
            fn.apply(this, args);
        } else {
            // Запоминаем последний вызов
            if (pendingRun) clearTimeout(pendingRun);

            pendingRun = setTimeout(() => {
                lastRun = Date.now();
                fn.apply(this, args);
                pendingRun = null;
            }, limit - (now - lastRun));
        }
    };
}

/**
 * Создаёт AbortController с timeout
 * @param {number} timeoutMs - Таймаут в мс
 * @returns {{controller: AbortController, clear: Function}}
 */
export function createAbortControllerWithTimeout(timeoutMs) {
    const controller = new AbortController();

    const timeoutId = setTimeout(() => {
        controller.abort(new Error('Upload timeout'));
    }, timeoutMs);

    return {
        controller,
        signal: controller.signal,
        clear: () => clearTimeout(timeoutId),
    };
}

/**
 * Проверяет, является ли устройство мобильным
 * @returns {boolean}
 */
export function isMobileDevice() {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
}

/**
 * Безопасно получает значение из объекта по пути
 * @param {Object} obj - Объект
 * @param {string} path - Путь (например: 'user.profile.name')
 * @param {*} defaultValue - Значение по умолчанию
 * @returns {*}
 */
export function safeGet(obj, path, defaultValue = undefined) {
    if (!obj || typeof path !== 'string') return defaultValue;

    const keys = path.split('.');
    let result = obj;

    for (const key of keys) {
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
            return defaultValue;
        }
        if (result == null || typeof result !== 'object') {
            return defaultValue;
        }
        result = result[key];
    }

    return result !== undefined ? result : defaultValue;
}
