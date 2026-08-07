'use strict';

/**
 * File Validator Module
 * Профессиональная валидация аудиофайлов с проверкой magic bytes,
 * санитизацией имён и защитой от вредоносного контента
 */

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

// ============================================================================
// MAGIC BYTES SIGNATURES FOR AUDIO FILES
// ============================================================================
const AUDIO_SIGNATURES = {
    // MP3 signatures
    mp3_id3v2: { bytes: [0x49, 0x44, 0x33], offset: 0 }, // ID3v2 header
    mp3_sync: { bytes: [0xFF, 0xFB], offset: 0 },        // MPEG sync word
    mp3_sync2: { bytes: [0xFF, 0xFA], offset: 0 },       // MPEG sync word variant
    mp3_sync3: { bytes: [0xFF, 0xF3], offset: 0 },       // MPEG sync word variant
    mp3_sync4: { bytes: [0xFF, 0xF2], offset: 0 },       // MPEG sync word variant

    // FLAC
    flac: { bytes: [0x66, 0x4C, 0x61, 0x43], offset: 0 }, // "fLaC"

    // WAV (RIFF header)
    wav: { bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 }, // "RIFF"

    // OGG Vorbis
    ogg: { bytes: [0x4F, 0x67, 0x67, 0x53], offset: 0 }, // "OggS"

    // M4A/AAC (ftyp atom)
    m4a: { bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }, // "ftyp" at offset 4

    // AIFF
    aiff: { bytes: [0x46, 0x4F, 0x52, 0x4D], offset: 0 }, // "FORM"

    // WMA/ASF
    wma: { bytes: [0x30, 0x26, 0xB2, 0x75, 0x8E, 0x66, 0xCF, 0x11], offset: 0 },
};

// Allowed extensions with their expected signatures
const EXTENSION_SIGNATURE_MAP = {
    '.mp3': ['mp3_id3v2', 'mp3_sync', 'mp3_sync2', 'mp3_sync3', 'mp3_sync4'],
    '.flac': ['flac'],
    '.wav': ['wav'],
    '.ogg': ['ogg'],
    '.m4a': ['m4a'],
    '.aac': ['m4a', 'mp3_sync', 'mp3_sync2'], // AAC can be in M4A container or raw
    '.aiff': ['aiff'],
    '.wma': ['wma'],
};

// MIME type to extension mapping
const MIME_TO_EXTENSION = {
    'audio/mpeg': ['.mp3'],
    'audio/mp3': ['.mp3'],
    'audio/flac': ['.flac'],
    'audio/x-flac': ['.flac'],
    'audio/wav': ['.wav'],
    'audio/x-wav': ['.wav'],
    'audio/wave': ['.wav'],
    'audio/ogg': ['.ogg'],
    'audio/vorbis': ['.ogg'],
    'audio/mp4': ['.m4a'],
    'audio/x-m4a': ['.m4a'],
    'audio/aac': ['.aac', '.m4a'],
    'audio/x-aac': ['.aac', '.m4a'],
    'audio/aiff': ['.aiff'],
    'audio/x-aiff': ['.aiff'],
    'audio/x-ms-wma': ['.wma'],
};

const EXTENSION_TO_MIME = {
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.aiff': 'audio/aiff',
    '.wma': 'audio/x-ms-wma',
};

// ============================================================================
// SECURITY LIMITS
// ============================================================================
const LIMITS = {
    maxFileSize: 100 * 1024 * 1024, // 100 MB
    minFileSize: 1024,               // 1 KB minimum (avoid empty/corrupt files)
    maxFilenameLength: 255,
    maxDailyUploads: 50,             // Per user per day
    maxTotalStorage: 5 * 1024 * 1024 * 1024, // 5 GB per user total
};

// Dangerous patterns in filenames (проверяются ПОСЛЕ декодирования)
const DANGEROUS_PATTERNS = [
    /\.\./,                    // Path traversal
    /[<>:"|?*]/,              // Windows illegal characters
    /[\x00-\x1F]/,            // Control characters
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i, // Windows reserved names
    /\0/,                      // Null bytes
    // УБРАЛИ: /%[0-9a-f]{2}/i - URL-encoded символы проверяются ПОСЛЕ декодирования
];

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate file magic bytes against expected audio signatures
 * @param {Buffer} buffer - First bytes of the file
 * @param {string} extension - File extension
 * @returns {{valid: boolean, detectedType: string|null, error: string|null}}
 */
function validateMagicBytes(buffer, extension) {
    if (!buffer || buffer.length < 12) {
        return { valid: false, detectedType: null, error: 'FILE_TOO_SHORT' };
    }

    const ext = extension.toLowerCase();
    const expectedSignatures = EXTENSION_SIGNATURE_MAP[ext];

    if (!expectedSignatures) {
        return { valid: false, detectedType: null, error: 'UNSUPPORTED_EXTENSION' };
    }

    // Check if file matches any expected signature for this extension
    for (const sigName of expectedSignatures) {
        const sig = AUDIO_SIGNATURES[sigName];
        if (!sig) continue;

        let matches = true;
        for (let i = 0; i < sig.bytes.length; i++) {
            if (buffer[sig.offset + i] !== sig.bytes[i]) {
                matches = false;
                break;
            }
        }

        if (matches) {
            return { valid: true, detectedType: sigName, error: null };
        }
    }

    // Try to detect actual file type for better error message
    const detectedType = detectFileType(buffer);

    return {
        valid: false,
        detectedType,
        error: 'SIGNATURE_MISMATCH'
    };
}

/**
 * Detect file type from magic bytes
 * @param {Buffer} buffer
 * @returns {string|null}
 */
function detectFileType(buffer) {
    for (const [name, sig] of Object.entries(AUDIO_SIGNATURES)) {
        let matches = true;
        for (let i = 0; i < sig.bytes.length; i++) {
            if (buffer[sig.offset + i] !== sig.bytes[i]) {
                matches = false;
                break;
            }
        }
        if (matches) {
            return name;
        }
    }

    // Check for common non-audio types (security)
    const commonTypes = {
        exe: { bytes: [0x4D, 0x5A], offset: 0 },                    // MZ header
        zip: { bytes: [0x50, 0x4B, 0x03, 0x04], offset: 0 },        // PK
        rar: { bytes: [0x52, 0x61, 0x72, 0x21], offset: 0 },        // Rar!
        pdf: { bytes: [0x25, 0x50, 0x44, 0x46], offset: 0 },        // %PDF
        png: { bytes: [0x89, 0x50, 0x4E, 0x47], offset: 0 },        // PNG
        jpg: { bytes: [0xFF, 0xD8, 0xFF], offset: 0 },              // JPEG
        gif: { bytes: [0x47, 0x49, 0x46, 0x38], offset: 0 },        // GIF8
        webp: { bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 },       // RIFF (check WEBP)
        elf: { bytes: [0x7F, 0x45, 0x4C, 0x46], offset: 0 },        // ELF
        script: { bytes: [0x23, 0x21], offset: 0 },                  // Shebang #!
    };

    for (const [name, sig] of Object.entries(commonTypes)) {
        let matches = true;
        for (let i = 0; i < sig.bytes.length; i++) {
            if (buffer[sig.offset + i] !== sig.bytes[i]) {
                matches = false;
                break;
            }
        }
        if (matches) {
            return `BLOCKED_${name.toUpperCase()}`;
        }
    }

    return null;
}

/**
 * Sanitize filename to prevent security issues
 * @param {string} filename
 * @returns {{safe: boolean, sanitized: string, error: string|null}}
 */
function sanitizeFilename(filename) {
    if (!filename || typeof filename !== 'string') {
        return { safe: false, sanitized: '', error: 'EMPTY_FILENAME' };
    }

    // Decode if URL encoded
    let decoded;
    try {
        decoded = decodeURIComponent(filename);
    } catch {
        decoded = filename;
    }

    // Check for dangerous patterns
    for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(decoded)) {
            return { safe: false, sanitized: '', error: 'DANGEROUS_FILENAME' };
        }
    }

    // Check length
    if (decoded.length > LIMITS.maxFilenameLength) {
        return { safe: false, sanitized: '', error: 'FILENAME_TOO_LONG' };
    }

    // Extract just the filename (no path)
    const basename = path.basename(decoded);

    // Sanitize: replace problematic characters with underscores
    let sanitized = basename
        .replace(/[<>:"|?*\x00-\x1F]/g, '_')  // Remove illegal chars
        .replace(/\.+/g, '.')                   // Multiple dots -> single
        .replace(/^\.+/, '')                    // Remove leading dots
        .replace(/\s+/g, ' ')                   // Normalize whitespace
        .trim();

    // Ensure extension is preserved
    const ext = path.extname(sanitized).toLowerCase();
    const name = path.basename(sanitized, ext);

    // If name is empty after sanitization, generate a safe one
    if (!name) {
        sanitized = `audio_${Date.now()}${ext}`;
    }

    return { safe: true, sanitized, error: null };
}

/**
 * Validate MIME type
 * @param {string} mimeType
 * @param {string} extension
 * @returns {{valid: boolean, error: string|null}}
 */
function validateMimeType(mimeType, extension) {
    if (!mimeType) {
        return { valid: false, error: 'MISSING_MIME_TYPE' };
    }

    const allowedExtensions = MIME_TO_EXTENSION[mimeType.toLowerCase()];

    if (!allowedExtensions) {
        return { valid: false, error: 'UNSUPPORTED_MIME_TYPE' };
    }

    const ext = extension.toLowerCase();

    // Check if extension matches MIME type
    if (!allowedExtensions.includes(ext)) {
        // Allow some flexibility for common mismatches
        const isAudioMime = mimeType.toLowerCase().startsWith('audio/');
        const isAudioExt = Object.keys(EXTENSION_SIGNATURE_MAP).includes(ext);

        if (isAudioMime && isAudioExt) {
            return { valid: true, error: null };
        }

        return { valid: false, error: 'MIME_EXTENSION_MISMATCH' };
    }

    return { valid: true, error: null };
}

function mimeForExtension(extension) {
    const ext = typeof extension === 'string' ? extension.toLowerCase() : '';
    if (!ext) return null;
    return EXTENSION_TO_MIME[ext] || null;
}

/**
 * Calculate file hash for deduplication
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function calculateFileHash(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);

        stream.on('data', (data) => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

/**
 * Comprehensive file validation
 * @param {Object} file - Multer file object
 * @param {Object} options - Validation options
 * @returns {Promise<{valid: boolean, errors: string[], warnings: string[], hash: string|null}>}
 */
async function validateFile(file, options = {}) {
    const errors = [];
    const warnings = [];
    let hash = null;

    // 1. Check if file exists
    if (!file) {
        return { valid: false, errors: ['NO_FILE'], warnings, hash };
    }

    // 2. Check file size
    if (file.size < LIMITS.minFileSize) {
        errors.push('FILE_TOO_SMALL');
    }

    if (file.size > LIMITS.maxFileSize) {
        errors.push('FILE_TOO_LARGE');
    }

    // 3. Sanitize filename
    const filenameResult = sanitizeFilename(file.originalname);
    if (!filenameResult.safe) {
        errors.push(filenameResult.error);
    }

    // 4. Get file extension
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (!extension) {
        errors.push('MISSING_EXTENSION');
    }

    // 5. Validate MIME type
    if (file.mimetype) {
        const mimeResult = validateMimeType(file.mimetype, extension);
        if (!mimeResult.valid) {
            errors.push(mimeResult.error);
        }
    }

    // 6. Read file header for magic bytes validation
    if (file.path && errors.length === 0) {
        try {
            // Используем readFile с ограничением чтения первых 16 байт
            const nodeFs = require('fs');
            const buffer = Buffer.alloc(16);
            const fd = nodeFs.openSync(file.path, 'r');
            nodeFs.readSync(fd, buffer, 0, 16, 0);
            nodeFs.closeSync(fd);

            const magicResult = validateMagicBytes(buffer, extension);
            if (!magicResult.valid) {
                if (magicResult.detectedType?.startsWith('BLOCKED_')) {
                    errors.push(`MALICIOUS_FILE_TYPE: ${magicResult.detectedType}`);
                } else {
                    errors.push(`INVALID_FILE_CONTENT: expected ${extension}, detected ${magicResult.detectedType || 'unknown'}`);
                }
            }
        } catch (err) {
            errors.push('FILE_READ_ERROR');
        }
    }

    // 7. Calculate hash for deduplication (if valid so far)
    if (errors.length === 0 && file.path) {
        try {
            hash = await calculateFileHash(file.path);
        } catch (err) {
            warnings.push('HASH_CALCULATION_FAILED');
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        hash,
        sanitizedFilename: filenameResult.sanitized
    };
}

/**
 * Check user upload limits
 * @param {number} userId
 * @param {Function} getUserUploadStats - Function (userId, dateIso) => {dailyCount,totalStorage}
 * @returns {Promise<{allowed: boolean, reason: string|null, remaining: number}>}
 */
async function checkUploadLimits(userId, getUserUploadStats) {
    try {
        // Get today's upload count
        const today = new Date().toISOString().split('T')[0];
        const stats = await getUserUploadStats(userId, today);

        const dailyCount = stats?.dailyCount || 0;
        const totalStorage = stats?.totalStorage || 0;

        if (dailyCount >= LIMITS.maxDailyUploads) {
            return {
                allowed: false,
                reason: 'DAILY_LIMIT_REACHED',
                remaining: 0
            };
        }

        if (totalStorage >= LIMITS.maxTotalStorage) {
            return {
                allowed: false,
                reason: 'STORAGE_LIMIT_REACHED',
                remaining: 0
            };
        }

        return {
            allowed: true,
            reason: null,
            remaining: LIMITS.maxDailyUploads - dailyCount
        };
    } catch (err) {
        // Fail-closed on storage/stats outage: if we cannot read upload stats,
        // we cannot enforce daily/storage limits, so we must NOT allow. Otherwise
        // an attacker can flood the DB or the DB connection to bypass limits
        // (fail-open). Availability during a DB blip is traded for abuse safety.
        return { allowed: false, reason: 'UPLOAD_STATS_UNAVAILABLE', remaining: 0 };
    }
}

/**
 * Check for duplicate file by hash
 * @param {string} hash
 * @param {number} userId
 * @param {Function} getSongByHash
 * @returns {Promise<{isDuplicate: boolean, existingSong: Object|null}>}
 */
async function checkDuplicate(hash, userId, getSongByHash) {
    try {
        const existing = await getSongByHash(hash, userId);

        if (existing) {
            return { isDuplicate: true, existingSong: existing };
        }

        return { isDuplicate: false, existingSong: null };
    } catch (err) {
        // If check fails, assume not duplicate
        return { isDuplicate: false, existingSong: null };
    }
}

// ============================================================================
// EXPORTS
// ============================================================================
module.exports = {
    validateFile,
    validateMagicBytes,
    sanitizeFilename,
    validateMimeType,
    mimeForExtension,
    calculateFileHash,
    checkUploadLimits,
    checkDuplicate,
    detectFileType,
    LIMITS,
    EXTENSION_SIGNATURE_MAP,
    MIME_TO_EXTENSION,
};
