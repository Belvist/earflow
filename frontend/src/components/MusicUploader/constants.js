/**
 * MusicUploader Constants
 * 
 * Конфигурация загрузчика музыки.
 * Все чувствительные данные берутся из env переменных.
 * 
 * @module MusicUploader/constants
 */

// Берём из env или используем безопасные defaults
const ENV = {
    MAX_FILE_SIZE_MB: parseInt(process.env.REACT_APP_MAX_UPLOAD_SIZE_MB, 10) || 100,
    MAX_FILES_COUNT: parseInt(process.env.REACT_APP_MAX_UPLOAD_FILES, 10) || 20,
};

/**
 * Конфигурация загрузчика
 */
export const CONFIG = Object.freeze({
    // Разрешённые MIME-типы (whitelist подход)
    ALLOWED_MIME_TYPES: Object.freeze([
        'audio/mpeg',
        'audio/mp3',
        'audio/wav',
        'audio/wave',
        'audio/x-wav',
        'audio/ogg',
        'audio/flac',
        'audio/x-flac',
        'audio/m4a',
        'audio/x-m4a',
        'audio/mp4',
        'audio/aac',
        'audio/webm',
    ]),

    // Разрешённые расширения (fallback для браузеров с некорректным MIME)
    ALLOWED_EXTENSIONS: Object.freeze([
        '.mp3',
        '.wav',
        '.ogg',
        '.flac',
        '.m4a',
        '.aac',
        '.webm',
    ]),

    // Лимиты
    MAX_FILE_SIZE: ENV.MAX_FILE_SIZE_MB * 1024 * 1024,
    MAX_FILES_AT_ONCE: ENV.MAX_FILES_COUNT,
    MAX_FILENAME_LENGTH: 255,
    MIN_FILE_SIZE: 1024, // 1KB минимум (защита от пустых файлов)

    // UI
    UPLOAD_TIMEOUT_MS: 120000, // 2 минуты на загрузку одного файла
    SUCCESS_DISPLAY_MS: 3000,
});

/**
 * Статусы загрузки
 */
export const UploadStatus = Object.freeze({
    PENDING: 'pending',
    VALIDATING: 'validating',
    UPLOADING: 'uploading',
    SUCCESS: 'success',
    ERROR: 'error',
    CANCELLED: 'cancelled',
});

/**
 * Типы ошибок
 */
export const ErrorType = Object.freeze({
    INVALID_TYPE: 'invalid_type',
    FILE_TOO_LARGE: 'file_too_large',
    FILE_TOO_SMALL: 'file_too_small',
    INVALID_FILENAME: 'invalid_filename',
    NETWORK_ERROR: 'network_error',
    SERVER_ERROR: 'server_error',
    CANCELLED: 'cancelled',
    UNKNOWN: 'unknown',
});

/**
 * Сообщения об ошибках (локализация)
 */
export const ERROR_MESSAGES = Object.freeze({
    [ErrorType.INVALID_TYPE]: 'Неподдерживаемый формат. Разрешены: MP3, WAV, OGG, FLAC, M4A',
    [ErrorType.FILE_TOO_LARGE]: `Файл слишком большой. Максимум ${ENV.MAX_FILE_SIZE_MB}MB`,
    [ErrorType.FILE_TOO_SMALL]: 'Файл слишком маленький или повреждён',
    [ErrorType.INVALID_FILENAME]: 'Недопустимые символы в имени файла',
    [ErrorType.NETWORK_ERROR]: 'Ошибка сети. Проверьте подключение',
    [ErrorType.SERVER_ERROR]: 'Ошибка сервера. Попробуйте позже',
    [ErrorType.CANCELLED]: 'Загрузка отменена',
    [ErrorType.UNKNOWN]: 'Неизвестная ошибка',
});
