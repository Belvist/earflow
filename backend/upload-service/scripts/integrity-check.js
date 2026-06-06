#!/usr/bin/env node
/**
 * MinIO Integrity Check Service
 * 
 * Проверяет целостность файлов в MinIO:
 * - Находит треки в БД у которых нет файлов в MinIO
 * - Помечает их как недоступные (is_available = false)
 * - Опционально удаляет битые записи
 * 
 * Запуск:
 *   node scripts/integrity-check.js [--fix] [--delete]
 * 
 * Флаги:
 *   --fix    - Помечать недоступные треки (is_available = false)
 *   --delete - Удалять треки без файлов из БД
 *   --dry-run - Только показать что будет изменено (по умолчанию)
 */

const { Pool } = require('pg');
const { S3Client, HeadObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

// ============================================================================
// CONFIGURATION
// ============================================================================

const config = {
    database: {
        connectionString: process.env.DATABASE_URL ||
            `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST || 'postgres'}:5432/${process.env.DB_NAME}`,
        max: 5,
        idleTimeoutMillis: 30000,
    },
    minio: {
        endpoint: process.env.MINIO_ENDPOINT || 'http://minio:9000',
        region: process.env.MINIO_REGION || 'us-east-1',
        credentials: {
            accessKeyId: process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER,
            secretAccessKey: process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD,
        },
        audioBucket: process.env.MINIO_BUCKET_AUDIO || 'music-audio',
        coversBucket: process.env.MINIO_BUCKET_COVERS || 'music-covers',
        forcePathStyle: true,
    },
    batchSize: 100,
};

// ============================================================================
// CLIENTS
// ============================================================================

const pool = new Pool(config.database);

const s3Client = new S3Client({
    endpoint: config.minio.endpoint,
    region: config.minio.region,
    credentials: config.minio.credentials,
    forcePathStyle: config.minio.forcePathStyle,
});

// ============================================================================
// UTILITIES
// ============================================================================

function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const prefix = {
        info: '📋',
        success: '✅',
        warning: '⚠️',
        error: '❌',
        debug: '🔍',
    }[level] || '•';

    console.log(`[${timestamp}] ${prefix} ${message}`);
    if (data) {
        console.log(JSON.stringify(data, null, 2));
    }
}

/**
 * Проверяет существует ли файл в MinIO
 */
async function fileExistsInMinio(key, bucket) {
    if (!key) return false;

    // Пробуем несколько возможных ключей
    const possibleKeys = [
        key,
        `audio/${key}`,
        key.replace(/^audio\//, ''),
    ];

    for (const testKey of possibleKeys) {
        try {
            await s3Client.send(new HeadObjectCommand({
                Bucket: bucket,
                Key: testKey,
            }));
            return true;
        } catch (error) {
            if (error.name !== 'NotFound' && error.$metadata?.httpStatusCode !== 404) {
                // Другая ошибка - логируем но продолжаем
                continue;
            }
        }
    }

    return false;
}

/**
 * Получает список всех файлов в бакете
 */
async function listAllFilesInBucket(bucket) {
    const files = new Set();
    let continuationToken = null;

    do {
        const response = await s3Client.send(new ListObjectsV2Command({
            Bucket: bucket,
            MaxKeys: 1000,
            ContinuationToken: continuationToken,
        }));

        for (const obj of (response.Contents || [])) {
            files.add(obj.Key);
            // Также добавляем имя файла без пути
            const basename = obj.Key.split('/').pop();
            files.add(basename);
        }

        continuationToken = response.IsTruncated ? response.NextContinuationToken : null;
    } while (continuationToken);

    return files;
}

// ============================================================================
// MAIN CHECK FUNCTIONS
// ============================================================================

/**
 * Проверяет все треки на наличие файлов
 */
async function checkAllTracks(options = {}) {
    const { fix = false, deleteOrphans = false, dryRun = true } = options;

    log('info', 'Запуск проверки целостности MinIO...');
    log('info', `Режим: ${dryRun ? 'DRY RUN (только просмотр)' : fix ? 'FIX (пометка недоступных)' : 'DELETE (удаление битых)'}`);

    const stats = {
        total: 0,
        valid: 0,
        missing: 0,
        fixed: 0,
        deleted: 0,
        errors: 0,
        missingTracks: [],
    };

    try {
        // Получаем список всех файлов в MinIO для быстрой проверки
        log('info', 'Загрузка списка файлов из MinIO...');
        const audioFiles = await listAllFilesInBucket(config.minio.audioBucket);
        log('success', `Найдено ${audioFiles.size} файлов в audio бакете`);

        // Получаем все треки из БД порциями
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
            const result = await pool.query(`
        SELECT id, title, artist, file_path, uploader_id, created_at
        FROM songs 
        ORDER BY id
        LIMIT $1 OFFSET $2
      `, [config.batchSize, offset]);

            if (result.rows.length === 0) {
                hasMore = false;
                break;
            }

            for (const track of result.rows) {
                stats.total++;

                // Проверяем есть ли файл
                const filePath = track.file_path;
                let fileExists = false;

                if (filePath) {
                    // Быстрая проверка по списку
                    fileExists = audioFiles.has(filePath) ||
                        audioFiles.has(`audio/${filePath}`) ||
                        audioFiles.has(filePath.replace(/^audio\//, ''));

                    // Если не нашли в списке - проверяем напрямую
                    if (!fileExists) {
                        fileExists = await fileExistsInMinio(filePath, config.minio.audioBucket);
                    }
                }

                if (fileExists) {
                    stats.valid++;
                } else {
                    stats.missing++;
                    stats.missingTracks.push({
                        id: track.id,
                        title: track.title,
                        artist: track.artist,
                        file_path: filePath,
                        uploader_id: track.uploader_id,
                    });

                    if (!dryRun) {
                        if (deleteOrphans) {
                            // Удаляем трек из БД
                            try {
                                await pool.query('DELETE FROM songs WHERE id = $1', [track.id]);
                                stats.deleted++;
                                log('warning', `Удалён трек ID ${track.id}: ${track.artist} - ${track.title}`);
                            } catch (err) {
                                stats.errors++;
                                log('error', `Ошибка удаления трека ${track.id}: ${err.message}`);
                            }
                        } else if (fix) {
                            // Помечаем как недоступный
                            try {
                                await pool.query(
                                    'UPDATE songs SET is_available = false, updated_at = NOW() WHERE id = $1',
                                    [track.id]
                                );
                                stats.fixed++;
                                log('warning', `Помечен недоступным ID ${track.id}: ${track.artist} - ${track.title}`);
                            } catch (err) {
                                stats.errors++;
                                log('error', `Ошибка обновления трека ${track.id}: ${err.message}`);
                            }
                        }
                    }
                }

                // Прогресс каждые 100 треков
                if (stats.total % 100 === 0) {
                    log('debug', `Проверено ${stats.total} треков...`);
                }
            }

            offset += config.batchSize;
        }

        // Итоги
        log('info', '═══════════════════════════════════════════');
        log('info', '          РЕЗУЛЬТАТЫ ПРОВЕРКИ              ');
        log('info', '═══════════════════════════════════════════');
        log('info', `Всего треков: ${stats.total}`);
        log('success', `Валидных: ${stats.valid}`);
        log('warning', `Отсутствуют файлы: ${stats.missing}`);

        if (!dryRun) {
            if (fix) log('info', `Помечено недоступными: ${stats.fixed}`);
            if (deleteOrphans) log('info', `Удалено: ${stats.deleted}`);
            if (stats.errors > 0) log('error', `Ошибок: ${stats.errors}`);
        }

        // Выводим первые 20 отсутствующих треков
        if (stats.missingTracks.length > 0) {
            log('warning', '\nПервые 20 треков без файлов:');
            stats.missingTracks.slice(0, 20).forEach(t => {
                console.log(`  - ID ${t.id}: ${t.artist} - ${t.title} (file: ${t.file_path})`);
            });

            if (stats.missingTracks.length > 20) {
                console.log(`  ... и ещё ${stats.missingTracks.length - 20} треков`);
            }
        }

        return stats;

    } catch (error) {
        log('error', 'Критическая ошибка:', error.message);
        throw error;
    }
}

/**
 * Добавляет колонку is_available если её нет
 */
async function ensureSchema() {
    try {
        await pool.query(`
      ALTER TABLE songs 
      ADD COLUMN IF NOT EXISTS is_available BOOLEAN DEFAULT true
    `);

        await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_songs_is_available 
      ON songs(is_available) 
      WHERE is_available = false
    `);

        log('success', 'Схема БД обновлена');
    } catch (error) {
        log('error', 'Ошибка обновления схемы:', error.message);
    }
}

// ============================================================================
// CLI
// ============================================================================

async function main() {
    const args = process.argv.slice(2);

    const options = {
        fix: args.includes('--fix'),
        deleteOrphans: args.includes('--delete'),
        dryRun: !args.includes('--fix') && !args.includes('--delete'),
    };

    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
MinIO Integrity Check

Использование:
  node integrity-check.js [OPTIONS]

Опции:
  --dry-run   Только показать проблемы (по умолчанию)
  --fix       Пометить недоступные треки (is_available = false)
  --delete    Удалить треки без файлов из БД
  --help      Показать эту справку

Примеры:
  node integrity-check.js              # Только проверка
  node integrity-check.js --fix        # Пометить битые треки
  node integrity-check.js --delete     # Удалить битые треки
    `);
        process.exit(0);
    }

    try {
        // Обновляем схему
        await ensureSchema();

        // Запускаем проверку
        const stats = await checkAllTracks(options);

        // Закрываем соединения
        await pool.end();

        // Exit code на основе результата
        process.exit(stats.missing > 0 ? 1 : 0);

    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(2);
    }
}

main();
