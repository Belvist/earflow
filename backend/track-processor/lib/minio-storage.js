/**
 * MinIO Storage Module for Track Processor
 * 
 * Загружает обложки в MinIO при обработке треков.
 * Аудиофайлы остаются на локальном хранилище (library folder).
 */

const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs-extra');
const path = require('path');

// ============================================================================
// Configuration
// ============================================================================

const config = {
  endpoint: process.env.MINIO_ENDPOINT || 'minio',
  port: parseInt(process.env.MINIO_PORT, 10) || 9000,
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || '',
  secretKey: process.env.MINIO_SECRET_KEY || '',
  audioBucket: process.env.MINIO_BUCKET_AUDIO || 'music-audio',
  coversBucket: process.env.MINIO_BUCKET_COVERS || 'music-covers',
  storageMode: process.env.STORAGE_MODE || 'hybrid',
};

// ============================================================================
// S3 Client
// ============================================================================

let s3Client = null;
let minioAvailable = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(attempt) {
  const base = 500;
  const max = 8000;
  const delay = Math.min(base * Math.pow(2, attempt), max);
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.floor(delay + jitter);
}

function isRetryableError(err) {
  if (!err) return false;

  if (err.code === 'ECONNREFUSED' ||
    err.code === 'ECONNRESET' ||
    err.code === 'ETIMEDOUT' ||
    err.code === 'EPIPE' ||
    err.code === 'ENOTFOUND') {
    return true;
  }

  if (err.name === 'TimeoutError') {
    return true;
  }

  if (typeof err.message === 'string') {
    const m = err.message;
    if (m.includes('timeout') || m.includes('Timeout') || m.includes('socket') || m.includes('connection')) {
      return true;
    }
  }

  const code = err.$metadata?.httpStatusCode;
  if (typeof code === 'number' && code >= 500) {
    return true;
  }

  return false;
}

async function withRetry(operation, maxRetries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (!isRetryableError(err) || attempt >= maxRetries) {
        throw err;
      }
      const delay = getRetryDelayMs(attempt);
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * Initialize MinIO client
 * @returns {Promise<boolean>}
 */
async function initialize() {
  if (config.storageMode === 'local') {
    console.log('📁 MinIO disabled (storage mode: local)');
    return false;
  }

  if (!config.accessKey || !config.secretKey) {
    console.warn('⚠️ MinIO credentials not configured');
    return false;
  }

  try {
    const endpoint = `${config.useSSL ? 'https' : 'http'}://${config.endpoint}:${config.port}`;

    s3Client = new S3Client({
      endpoint,
      region: 'us-east-1',
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: true,
    });

    const healthCheck = async (bucketName) => {
      await withRetry(async () => {
        await s3Client.send(new HeadObjectCommand({
          Bucket: bucketName,
          Key: '.health-check',
        }));
      }, 1).catch((err) => {
        if (err.name !== 'NotFound' && err.$metadata?.httpStatusCode !== 404) {
          throw err;
        }
      });
    };

    await healthCheck(config.coversBucket);
    await healthCheck(config.audioBucket);

    minioAvailable = true;
    console.log(`✅ MinIO connected: ${endpoint}`);
    console.log(`   Covers bucket: ${config.coversBucket}`);
    return true;
  } catch (error) {
    console.error('❌ MinIO connection failed:', error.message);
    minioAvailable = false;
    return false;
  }
}

async function audioExists(objectKey) {
  if (!minioAvailable) {
    return false;
  }

  const key = normalizeKey(objectKey);
  if (!key) {
    return false;
  }

  try {
    await withRetry(async () => {
      await s3Client.send(new HeadObjectCommand({
        Bucket: config.audioBucket,
        Key: key,
      }));
    }, 1);
    return true;
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
}

async function uploadAudioFromPath(filePath, objectKey, contentType = 'application/octet-stream') {
  if (!minioAvailable) {
    return null;
  }

  const key = normalizeKey(objectKey);
  if (!key) {
    throw new Error('Invalid audio object key');
  }

  const stat = await fs.stat(filePath);

  await withRetry(async () => {
    const bodyStream = fs.createReadStream(filePath);
    await s3Client.send(new PutObjectCommand({
      Bucket: config.audioBucket,
      Key: key,
      Body: bodyStream,
      ContentType: contentType,
      ContentLength: stat.size,
      Metadata: {
        'upload-source': 'track-processor',
        'uploaded-at': new Date().toISOString(),
      },
    }));
  });

  return `minio://${config.audioBucket}/${key}`;
}

/**
 * Get content type for file
 */
function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

function normalizeKey(key) {
  return (key || '').toString().replace(/^\/+/, '');
}

/**
 * Upload cover to MinIO
 * @param {Buffer|string} data - Buffer or file path
 * @param {string} filename - Target filename
 * @returns {Promise<string|null>} - MinIO path or null if failed
 */
async function uploadCover(data, filename) {
  if (!minioAvailable) {
    return null;
  }

  try {
    let buffer;
    if (Buffer.isBuffer(data)) {
      buffer = data;
    } else if (typeof data === 'string') {
      buffer = await fs.readFile(data);
    } else {
      throw new Error('Invalid data type');
    }

    const key = `covers/${filename}`;

    await withRetry(async () => {
      await s3Client.send(new PutObjectCommand({
        Bucket: config.coversBucket,
        Key: key,
        Body: buffer,
        ContentType: getContentType(filename),
        CacheControl: 'public, max-age=31536000',
        Metadata: {
          'upload-source': 'track-processor',
          'uploaded-at': new Date().toISOString(),
        },
      }));
    });

    return `minio://${config.coversBucket}/${key}`;
  } catch (error) {
    console.error(`❌ MinIO upload failed for ${filename}:`, error.message);
    return null;
  }
}

/**
 * Check if cover exists in MinIO
 * @param {string} filename 
 * @returns {Promise<boolean>}
 */
async function coverExists(filename) {
  if (!minioAvailable) {
    return false;
  }

  try {
    await s3Client.send(new HeadObjectCommand({
      Bucket: config.coversBucket,
      Key: `covers/${filename}`,
    }));
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Get public URL for cover
 * @param {string} filename 
 * @returns {string}
 */
function getCoverUrl(filename) {
  // Returns the MinIO public URL for covers bucket
  const protocol = config.useSSL ? 'https' : 'http';
  // For internal use - containers access MinIO directly
  return `${protocol}://${config.endpoint}:${config.port}/${config.coversBucket}/covers/${filename}`;
}

/**
 * Get status
 */
function getStatus() {
  return {
    enabled: config.storageMode !== 'local',
    available: minioAvailable,
    mode: config.storageMode,
    coversBucket: config.coversBucket,
  };
}

module.exports = {
  initialize,
  uploadCover,
  coverExists,
  audioExists,
  uploadAudioFromPath,
  getCoverUrl,
  getStatus,
  config,
};
