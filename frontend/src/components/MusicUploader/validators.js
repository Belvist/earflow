/**
 * MusicUploader Validators
 * 
 * Модуль валидации файлов с defense-in-depth подходом.
 * Множественные проверки для предотвращения загрузки вредоносных файлов.
 * 
 * Безопасность:
 * - Проверка MIME-типа (Content-Type sniffing prevention)
 * - Проверка расширения файла
 * - Проверка magic bytes (file signature)
 * - Санитизация имени файла
 * - Защита от path traversal
 * 
 * @module MusicUploader/validators
 */

import { CONFIG, ErrorType } from './constants';

/**
 * Magic bytes для аудио форматов
 * Используется для глубокой валидации содержимого файла
 */
const MAGIC_BYTES = Object.freeze({
    // MP3: ID3 tag или MPEG audio frame sync
    mp3: [
        [0x49, 0x44, 0x33], // ID3
        [0xFF, 0xFB],       // MPEG Audio Layer 3
        [0xFF, 0xFA],       // MPEG Audio Layer 3
        [0xFF, 0xF3],       // MPEG Audio Layer 3
        [0xFF, 0xF2],       // MPEG Audio Layer 3
    ],
    // WAV: RIFF header
    wav: [[0x52, 0x49, 0x46, 0x46]], // RIFF
    // OGG: OggS magic
    ogg: [[0x4F, 0x67, 0x67, 0x53]], // OggS
    // FLAC: fLaC magic
    flac: [[0x66, 0x4C, 0x61, 0x43]], // fLaC
    // M4A/AAC: ftyp atom
    m4a: [[0x00, 0x00, 0x00], [0x66, 0x74, 0x79, 0x70]], // ftyp (offset varies)
    // WebM: EBML header
    webm: [[0x1A, 0x45, 0xDF, 0xA3]], // EBML
});

/**
 * Результат валидации
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Прошёл ли файл валидацию
 * @property {ErrorType|null} errorType - Тип ошибки
 * @property {string|null} errorMessage - Сообщение об ошибке
 */

/**
 * Проверяет, является ли расширение файла допустимым
 * @param {string} filename - Имя файла
 * @returns {boolean}
 */
function isValidExtension(filename) {
    if (!filename || typeof filename !== 'string') return false;

    const lastDot = filename.lastIndexOf('.');
    if (lastDot === -1) return false;

    const ext = filename.slice(lastDot).toLowerCase();
    return CONFIG.ALLOWED_EXTENSIONS.includes(ext);
}

/**
 * Проверяет, является ли MIME-тип допустимым
 * @param {string} mimeType - MIME-тип
 * @returns {boolean}
 */
function isValidMimeType(mimeType) {
    if (!mimeType || typeof mimeType !== 'string') return false;
    return CONFIG.ALLOWED_MIME_TYPES.includes(mimeType.toLowerCase());
}

function readBlobArrayBuffer(blob) {
    if (!blob) {
        return Promise.reject(new Error('Empty file header'));
    }
    if (typeof blob.arrayBuffer === 'function') {
        return blob.arrayBuffer();
    }
    if (typeof FileReader === 'function') {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error || new Error('Unable to read file header'));
            reader.readAsArrayBuffer(blob);
        });
    }
    return Promise.reject(new Error('File header reading is not supported'));
}

/**
 * Проверяет magic bytes файла
 * @param {ArrayBuffer} buffer - Первые байты файла
 * @param {string} extension - Расширение файла
 * @returns {boolean}
 */
function checkMagicBytes(buffer, extension) {
    const ext = extension.replace('.', '').toLowerCase();
    const signatures = MAGIC_BYTES[ext];

    if (!signatures) {
        // Если нет сигнатуры для формата - пропускаем проверку
        // но это не означает что файл валидный
        return true;
    }

    const bytes = new Uint8Array(buffer);

    return signatures.some(signature => {
        if (bytes.length < signature.length) return false;

        // Для M4A проверяем с offset
        if (ext === 'm4a') {
            // ftyp может быть на позиции 4-7
            for (let offset = 0; offset <= 8; offset++) {
                let match = true;
                for (let i = 0; i < 4; i++) {
                    if (bytes[offset + i] !== [0x66, 0x74, 0x79, 0x70][i]) {
                        match = false;
                        break;
                    }
                }
                if (match) return true;
            }
            return false;
        }

        // Стандартная проверка с начала файла
        for (let i = 0; i < signature.length; i++) {
            if (bytes[i] !== signature[i]) return false;
        }
        return true;
    });
}

/**
 * Проверяет имя файла на подозрительные символы
 * Защита от path traversal и injection атак
 * @param {string} filename - Имя файла
 * @returns {boolean}
 */
function isValidFilename(filename) {
    if (!filename || typeof filename !== 'string') return false;
    if (filename.length > CONFIG.MAX_FILENAME_LENGTH) return false;
    if (filename.length === 0) return false;

    // Запрещённые паттерны:
    // - Path traversal: ../ или ..\
    // - Null bytes: \x00
    // - Control characters: \x00-\x1f
    // - Reserved characters: < > : " | ? * /
    // - Windows reserved names: CON, PRN, AUX, NUL, COM1-9, LPT1-9

    const dangerousPatterns = [
        /\.\./,                          // Path traversal
        /[<>:"|?*]/,                     // Reserved characters
        /[\x00-\x1f]/,                   // Control characters
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i, // Windows reserved
        /\\/,                            // Backslash
    ];

    return !dangerousPatterns.some(pattern => pattern.test(filename));
}

/**
 * Санитизирует имя файла для безопасного использования
 * @param {string} filename - Исходное имя файла
 * @returns {string} - Безопасное имя файла
 */
export function sanitizeFilename(filename) {
    if (!filename || typeof filename !== 'string') {
        return `upload_${Date.now()}.mp3`;
    }

    // Удаляем опасные символы
    let safe = filename
        .replace(/\.\./g, '_')           // Path traversal
        .replace(/[<>:"|?*\\]/g, '_')    // Reserved characters
        .replace(/[\x00-\x1f]/g, '')     // Control characters
        .trim();

    // Ограничиваем длину
    if (safe.length > CONFIG.MAX_FILENAME_LENGTH) {
        const ext = safe.slice(safe.lastIndexOf('.'));
        const name = safe.slice(0, CONFIG.MAX_FILENAME_LENGTH - ext.length - 1);
        safe = name + ext;
    }

    // Если имя пустое после санитизации
    if (!safe || safe === '.' || safe === '..') {
        safe = `upload_${Date.now()}.mp3`;
    }

    return safe;
}

/**
 * Полная валидация файла
 * Defense-in-depth: множественные проверки
 * 
 * @param {File} file - Файл для валидации
 * @returns {Promise<ValidationResult>}
 */
export async function validateFile(file) {
    // Базовые проверки
    if (!file || !(file instanceof File)) {
        return {
            valid: false,
            errorType: ErrorType.UNKNOWN,
            errorMessage: 'Некорректный файл',
        };
    }

    // Проверка размера (минимум)
    if (file.size < CONFIG.MIN_FILE_SIZE) {
        return {
            valid: false,
            errorType: ErrorType.FILE_TOO_SMALL,
            errorMessage: null,
        };
    }

    // Проверка размера (максимум)
    if (file.size > CONFIG.MAX_FILE_SIZE) {
        return {
            valid: false,
            errorType: ErrorType.FILE_TOO_LARGE,
            errorMessage: null,
        };
    }

    // Проверка имени файла
    if (!isValidFilename(file.name)) {
        return {
            valid: false,
            errorType: ErrorType.INVALID_FILENAME,
            errorMessage: null,
        };
    }

    // Проверка расширения
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    const hasValidExtension = isValidExtension(file.name);

    // Проверка MIME-типа
    const hasValidMimeType = isValidMimeType(file.type);

    // Хотя бы одно должно совпадать (некоторые браузеры не передают MIME)
    if (!hasValidExtension && !hasValidMimeType) {
        return {
            valid: false,
            errorType: ErrorType.INVALID_TYPE,
            errorMessage: null,
        };
    }

    // Глубокая валидация: проверка magic bytes
    try {
        const headerSize = 32; // Достаточно для всех форматов
        const header = file.slice(0, headerSize);
        const buffer = await readBlobArrayBuffer(header);

        if (!checkMagicBytes(buffer, ext)) {
            // Magic bytes не совпадают - возможная попытка обхода
            return {
                valid: false,
                errorType: ErrorType.INVALID_TYPE,
                errorMessage: 'Содержимое файла не соответствует расширению',
            };
        }
    } catch (error) {
        // Если не удалось прочитать header - всё равно разрешаем
        // (сервер проведёт свою валидацию)
        void error;
        return {
            valid: false,
            errorType: ErrorType.INVALID_TYPE,
            errorMessage: 'РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРѕРІРµСЂРёС‚СЊ СЃРѕРґРµСЂР¶РёРјРѕРµ С„Р°Р№Р»Р°',
        };
    }

    return {
        valid: true,
        errorType: null,
        errorMessage: null,
    };
}

/**
 * Быстрая синхронная валидация (без чтения содержимого)
 * Используется для предварительной фильтрации в drag&drop
 * 
 * @param {File} file - Файл
 * @returns {ValidationResult}
 */
export function quickValidate(file) {
    if (!file || !(file instanceof File)) {
        return { valid: false, errorType: ErrorType.UNKNOWN };
    }

    if (file.size < CONFIG.MIN_FILE_SIZE) {
        return { valid: false, errorType: ErrorType.FILE_TOO_SMALL };
    }

    if (file.size > CONFIG.MAX_FILE_SIZE) {
        return { valid: false, errorType: ErrorType.FILE_TOO_LARGE };
    }

    const hasValidExt = isValidExtension(file.name);
    const hasValidMime = isValidMimeType(file.type);

    if (!hasValidExt && !hasValidMime) {
        return { valid: false, errorType: ErrorType.INVALID_TYPE };
    }

    return { valid: true, errorType: null };
}
