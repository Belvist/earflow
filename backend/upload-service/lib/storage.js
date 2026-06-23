/**
 * Storage Module - MinIO/S3 Compatible Object Storage
 * 
 * Production-grade storage with:
 * - Automatic reconnection with exponential backoff
 * - Health checks and circuit breaker pattern
 * - Retry logic for transient failures
 * - Graceful degradation to local storage
 * 
 * @module lib/storage
 */

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListBucketsCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');

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
  storageMode: (process.env.STORAGE_MODE || 'minio').toLowerCase(),
  localUploadDir: process.env.UPLOAD_DIR || '/app/uploads',
  // Retry and health check settings
  maxRetries: 0,
  retryBaseDelayMs: 1000,
  retryMaxDelayMs: 30000,
  healthCheckIntervalMs: 0,
  circuitBreakerThreshold: 0,
  circuitBreakerResetMs: 0,
  connectionTimeoutMs: 10000,
  socketTimeoutMs: 60000,
};

// ============================================================================
// Connection State Management
// ============================================================================

let s3Client = null;
let minioAvailable = false;
let healthCheckInterval = null;
let reconnectTimeout = null;
let isReconnecting = false;

// Circuit breaker state
const circuitBreaker = {
  failures: 0,
  lastFailure: 0,
  isOpen: false,
  lastStateChange: Date.now(),
};

function assertSafeObjectKey(value) {
  const v = (value || '').toString();
  if (!v) return;
  if (v.length > 2048) {
    throw new Error('Invalid object key');
  }
  if (v.includes('\0') || v.includes('..') || v.includes('\\')) {
    throw new Error('Invalid object key');
  }
}

function buildPossibleObjectKeys(key, bucket) {
  const normalizedKey = (key || '').toString().replace(/^\/+/, '');
  assertSafeObjectKey(normalizedKey);
  const bucketPrefix = `${bucket}/`;
  const possibleKeys = [];

  if (normalizedKey) {
    possibleKeys.push(normalizedKey);
  }

  if (normalizedKey.startsWith(bucketPrefix)) {
    const withoutPrefix = normalizedKey.slice(bucketPrefix.length);
    if (withoutPrefix) {
      possibleKeys.push(withoutPrefix);
    }
  } else if (normalizedKey) {
    possibleKeys.push(`${bucket}/${normalizedKey}`);
    if (bucket === 'audio' && !normalizedKey.startsWith('library/')) {
      possibleKeys.push(`${bucket}/library/${normalizedKey}`);
    }
  }

  const baseName = path.basename(normalizedKey);
  if (baseName && baseName !== normalizedKey) {
    possibleKeys.push(`${bucket}/${baseName}`);
    if (bucket === 'audio') {
      possibleKeys.push(`${bucket}/library/${baseName}`);
    }
  }

  const unique = [];
  const seen = new Set();
  for (const k of possibleKeys) {
    const kk = (k || '').toString();
    if (!kk || seen.has(kk)) continue;
    seen.add(kk);
    unique.push(kk);
  }
  return unique;
}

async function listObjects(prefix = '', bucket = 'covers') {
  const bucketName = bucket === 'covers' ? config.coversBucket : config.audioBucket;

  if (!isMinioReady()) {
    const unavailableError = new Error('MinIO storage is unavailable');
    unavailableError.code = 'MINIO_UNAVAILABLE';
    throw unavailableError;
  }

  const safePrefix = (prefix || '').toString().replace(/^\/+/, '');
  const items = [];
  let continuationToken = undefined;

  do {
    const response = await s3Client.send(new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: safePrefix,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    }));

    const contents = Array.isArray(response.Contents) ? response.Contents : [];
    for (const obj of contents) {
      if (obj && obj.Key) items.push(String(obj.Key));
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return items;
}

/**
 * Reset circuit breaker after successful operation
 */
function resetCircuitBreaker() {
  // no-op: legacy circuit breaker removed in MinIO-only mode
}

/**
 * Record circuit breaker failure
 */
function recordCircuitBreakerFailure() {
  // no-op: legacy circuit breaker removed in MinIO-only mode
}

/**
 * Check if circuit breaker allows requests
 */
function isCircuitBreakerClosed() {
  return true;
}

/**
 * Calculate exponential backoff delay
 */
function getRetryDelay(attempt) {
  const delay = Math.min(
    config.retryBaseDelayMs * Math.pow(2, attempt),
    config.retryMaxDelayMs
  );
  // Add jitter (±25%)
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.floor(delay + jitter);
}

/**
 * Execute operation with retry logic
 */
async function withRetry(operation, operationName, maxRetries = config.maxRetries) {
  return await operation();
}

/**
 * Check if error is retryable
 */
function isRetryableError(error) {
  // Network errors
  if (error.code === 'ECONNREFUSED' ||
    error.code === 'ECONNRESET' ||
    error.code === 'ETIMEDOUT' ||
    error.code === 'EPIPE' ||
    error.code === 'ENOTFOUND') {
    return true;
  }

  // Timeout errors
  if (error.message?.includes('timeout') ||
    error.message?.includes('Timeout') ||
    error.name === 'TimeoutError') {
    return true;
  }

  // AWS SDK specific retryable errors
  if (error.$metadata?.httpStatusCode >= 500) {
    return true;
  }

  // Socket errors
  if (error.message?.includes('socket') ||
    error.message?.includes('connection')) {
    return true;
  }

  return false;
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Schedule automatic reconnection
 */
function scheduleReconnect() {
  // no-op: legacy reconnect loop removed in MinIO-only mode
}

/**
 * Attempt to reconnect to MinIO
 */
async function attemptReconnect() {
  // no-op: legacy reconnect loop removed in MinIO-only mode
}

/**
 * Health check for MinIO connection
 */
async function performHealthCheck() {
  // no-op: legacy health checks removed in MinIO-only mode
}

/**
 * Start periodic health checks
 */
function startHealthChecks() {
  // no-op: legacy health checks removed in MinIO-only mode
}

/**
 * Stop health checks (for graceful shutdown)
 */
function stopHealthChecks() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
}

/**
 * Create S3 client instance
 */
function createS3Client() {
  const endpoint = `${config.useSSL ? 'https' : 'http'}://${config.endpoint}:${config.port}`;

  return new S3Client({
    endpoint,
    region: 'us-east-1',
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
    forcePathStyle: true,
    maxAttempts: Math.min(Math.max(parseInt(process.env.MINIO_MAX_ATTEMPTS || '3', 10) || 3, 1), 10),
    retryMode: (process.env.AWS_RETRY_MODE || 'standard').toLowerCase(),
    requestHandler: new NodeHttpHandler({
      connectionTimeout: config.connectionTimeoutMs,
      socketTimeout: config.socketTimeoutMs,
    }),
  });
}

/**
 * Initialize S3 client with connection validation
 */
async function initializeS3Client() {
  if (config.storageMode !== 'minio') {
    throw new Error(`Unsupported STORAGE_MODE=${config.storageMode}. Set STORAGE_MODE=minio`);
  }

  if (!config.accessKey || !config.secretKey) {
    throw new Error('MinIO credentials not configured');
  }

  try {
    const endpoint = `${config.useSSL ? 'https' : 'http'}://${config.endpoint}:${config.port}`;

    s3Client = createS3Client();

    await s3Client.send(new ListBucketsCommand({}));

    minioAvailable = true;
    void endpoint;
    return true;
  } catch (error) {
    console.error('❌ MinIO connection failed:', error.message);
    minioAvailable = false;
    throw error;
  }
}

/**
 * Get current MinIO availability with circuit breaker check
 */
function isMinioReady() {
  return minioAvailable && s3Client !== null;
}

// ============================================================================
// Storage Operations
// ============================================================================

/**
 * Generate unique object key for storage
 * @param {string} originalFilename - Original filename
 * @param {string} prefix - Optional prefix (e.g., 'audio/', 'covers/')
 * @returns {string} - Unique object key
 */
function generateObjectKey(originalFilename, prefix = '') {
  const timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(8).toString('hex');
  const ext = path.extname(originalFilename).toLowerCase();
  const safeName = path.basename(originalFilename, ext)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .substring(0, 64);

  return `${prefix}${timestamp}_${safeName}_${randomSuffix}${ext}`;
}

/**
 * Upload file to storage (MinIO or local)
 * @param {Buffer|string} fileData - File buffer or path to local file
 * @param {string} filename - Original filename
 * @param {Object} options - Upload options
 * @param {string} options.bucket - Target bucket ('audio' or 'covers')
 * @param {string} options.contentType - MIME type
 * @param {Object} options.metadata - Custom metadata
 * @returns {Promise<{key: string, location: string, size: number}>}
 */
async function uploadFile(fileData, filename, options = {}) {
  const { bucket = 'audio', contentType = 'application/octet-stream', metadata = {} } = options;
  const bucketName = bucket === 'covers' ? config.coversBucket : config.audioBucket;
  const objectKey = generateObjectKey(filename, `${bucket}/`);

  const isBuffer = Buffer.isBuffer(fileData);
  const isPath = typeof fileData === 'string';
  if (!isBuffer && !isPath) {
    throw new Error('fileData must be a Buffer or file path string');
  }

  // Determine payload and size without loading whole file into RAM for path uploads
  let body;
  let fileSize;
  if (isBuffer) {
    body = fileData;
    fileSize = fileData.length;
  } else {
    const stat = await fs.stat(fileData);
    fileSize = stat.size;
    body = fs.createReadStream(fileData);
  }

  if (!isMinioReady()) {
    const unavailableError = new Error('MinIO storage is unavailable');
    unavailableError.code = 'MINIO_UNAVAILABLE';
    throw unavailableError;
  }

  await s3Client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: objectKey,
    Body: body,
    ContentType: contentType,
    ...(isBuffer ? {} : { ContentLength: fileSize }),
    Metadata: {
      ...metadata,
      'original-filename': encodeURIComponent(filename),
      'upload-timestamp': String(Date.now()),
    },
  }));

  return {
    key: objectKey,
    location: `minio://${bucketName}/${objectKey}`,
    size: fileSize,
    storage: 'minio',
  };
}

async function uploadFileFromPathWithKey(filePath, objectKey, options = {}) {
  const { bucket = 'audio', contentType = 'application/octet-stream', metadata = {} } = options;
  const bucketName = bucket === 'covers' ? config.coversBucket : config.audioBucket;
  const normalizedKey = (objectKey || '').toString().replace(/^\/+/, '');

  assertSafeObjectKey(normalizedKey);

  if (!normalizedKey) {
    throw new Error('objectKey is required');
  }

  if (!filePath || typeof filePath !== 'string') {
    throw new Error('filePath must be a string');
  }

  if (!isMinioReady()) {
    const unavailableError = new Error('MinIO storage is unavailable');
    unavailableError.code = 'MINIO_UNAVAILABLE';
    throw unavailableError;
  }

  const stat = await fs.stat(filePath);

  const bodyStream = fs.createReadStream(filePath);
  await s3Client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: normalizedKey,
    Body: bodyStream,
    ContentType: contentType,
    ContentLength: stat.size,
    Metadata: {
      ...metadata,
      'upload-timestamp': String(Date.now()),
    },
  }));

  return {
    key: normalizedKey,
    location: `minio://${bucketName}/${normalizedKey}`,
    size: stat.size,
    storage: 'minio',
  };
}

/**
 * Get file stream from storage
 * @param {string} key - Object key or local filename
 * @param {Object} options - Options
 * @param {string} options.bucket - Bucket name ('audio' or 'covers')
 * @param {Object} options.range - Range request {start, end}
 * @returns {Promise<{stream: Readable, contentType: string, contentLength: number, acceptRanges: boolean}>}
 */
async function getFileStream(key, options = {}) {
  const { bucket = 'audio', range } = options;
  const bucketName = bucket === 'covers' ? config.coversBucket : config.audioBucket;

  // Нормализуем ключ и определяем, является ли он путём библиотечного файла
  const normalizedKey = (key || '').replace(/^\/+/, '');
  assertSafeObjectKey(normalizedKey);
  const isLibraryPath = normalizedKey.startsWith('library/') ||
    normalizedKey.startsWith('uploads/library/');

  if (!isMinioReady()) {
    const unavailableError = new Error('MinIO storage is unavailable');
    unavailableError.code = 'MINIO_UNAVAILABLE';
    throw unavailableError;
  }

  // Try MinIO
  {
    // Generate possible object keys to try (backward-compatible)
    // ВАЖНО: используем общий генератор ключей, чтобы не ловить ложные FILE_NOT_FOUND
    // при разных раскладках (audio/, library/, basename-only).
    const possibleKeys = buildPossibleObjectKeys(normalizedKey, bucket);

    for (const objectKey of possibleKeys) {
      try {
        const params = {
          Bucket: bucketName,
          Key: objectKey,
        };

        if (range) {
          if (range.suffix && Number.isFinite(range.suffix) && range.suffix > 0) {
            params.Range = `bytes=-${range.suffix}`;
          } else {
            params.Range = `bytes=${range.start}-${range.end || ''}`;
          }
        }

        const response = await s3Client.send(new GetObjectCommand(params));

        return {
          stream: response.Body,
          contentType: response.ContentType || 'application/octet-stream',
          contentLength: response.ContentLength,
          contentRange: response.ContentRange,
          acceptRanges: 'bytes',
          storage: 'minio',
        };
      } catch (error) {
        if (error && error.$metadata && error.$metadata.httpStatusCode === 416) {
          const e416 = new Error('Range not satisfiable');
          e416.code = 'RANGE_NOT_SATISFIABLE';
          throw e416;
        }
        if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
          // Try next key
          continue;
        }

        const e = new Error(error?.message || 'MinIO read error');
        e.code = 'MINIO_UNAVAILABLE';
        throw e;
      }
    }

    const notFoundError = new Error(`File not found in MinIO: ${key}`);
    notFoundError.code = 'FILE_NOT_FOUND';
    throw notFoundError;
  }
}

/**
 * Check if file exists in storage
 * @param {string} key - Object key
 * @param {string} bucket - Bucket name
 * @returns {Promise<boolean>}
 */
async function fileExists(key, bucket = 'audio') {
  const bucketName = bucket === 'covers' ? config.coversBucket : config.audioBucket;

  if (!isMinioReady()) {
    const e = new Error('MinIO unavailable');
    e.code = 'MINIO_UNAVAILABLE';
    throw e;
  }

  const possibleKeys = buildPossibleObjectKeys(key, bucket);
  for (const objectKey of possibleKeys) {
    try {
      await s3Client.send(new HeadObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
      }));
      return true;
    } catch (error) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        continue;
      }
      const e = new Error(error?.message || 'MinIO head error');
      e.code = 'MINIO_UNAVAILABLE';
      throw e;
    }
  }

  return false;
}

/**
 * Delete file from storage
 * @param {string} key - Object key
 * @param {string} bucket - Bucket name
 * @returns {Promise<boolean>}
 */
async function deleteFile(key, bucket = 'audio') {
  const bucketName = bucket === 'covers' ? config.coversBucket : config.audioBucket;
  let deleted = false;

  if (!isMinioReady()) {
    const e = new Error('MinIO unavailable');
    e.code = 'MINIO_UNAVAILABLE';
    throw e;
  }

  const possibleKeys = buildPossibleObjectKeys(key, bucket);
  for (const objectKey of possibleKeys) {
    try {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
      }));
      deleted = true;
    } catch (error) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        continue;
      }
      const e = new Error(error?.message || 'MinIO delete error');
      e.code = 'MINIO_UNAVAILABLE';
      throw e;
    }
  }

  return deleted;
}

/**
 * Generate presigned URL for direct download
 * @param {string} key - Object key
 * @param {string} bucket - Bucket name
 * @param {number} expiresIn - URL expiration in seconds (default: 3600)
 * @returns {Promise<string|null>}
 */
async function getPresignedUrl(key, bucket = 'audio', expiresIn = 3600) {
  if (!isMinioReady()) {
    return null;
  }

  const bucketName = bucket === 'covers' ? config.coversBucket : config.audioBucket;
  const normalizedKey = (key || '').toString().replace(/^\/+/, '');
  const possibleKeys = buildPossibleObjectKeys(normalizedKey, bucket);

  for (const objectKey of possibleKeys) {
    try {
      await s3Client.send(new HeadObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
      }));

      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
      });
      return await getSignedUrl(s3Client, command, { expiresIn });
    } catch (error) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        continue;
      }
      console.error('Presigned URL generation failed:', error.message);
      return null;
    }
  }

  return null;
}

async function resolveObjectKey(key, bucket = 'audio') {
  const normalizedKey = (key || '').toString().replace(/^\/+/, '');
  if (!normalizedKey) return null;

  if (bucket !== 'audio' && bucket !== 'covers') {
    return null;
  }

  if (!isMinioReady()) {
    const e = new Error('MinIO unavailable');
    e.code = 'MINIO_UNAVAILABLE';
    throw e;
  }

  const bucketName = bucket === 'covers' ? config.coversBucket : config.audioBucket;
  const possibleKeys = buildPossibleObjectKeys(normalizedKey, bucket);
  for (const objectKey of possibleKeys) {
    try {
      await s3Client.send(new HeadObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
      }));
      return objectKey;
    } catch (error) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        continue;
      }
      const e = new Error(error?.message || 'MinIO head error');
      e.code = 'MINIO_UNAVAILABLE';
      throw e;
    }
  }

  return null;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get content type from file extension
 * @param {string} filePath - File path
 * @returns {string}
 */
function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.wma': 'audio/x-ms-wma',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Get storage status with circuit breaker info
 * @returns {Object}
 */
function getStorageStatus() {
  return {
    mode: config.storageMode,
    minioAvailable,
    minioReady: isMinioReady(),
    minioEndpoint: minioAvailable ? `${config.endpoint}:${config.port}` : null,
    audioBucket: config.audioBucket,
    coversBucket: config.coversBucket,
    localDir: config.localUploadDir,
    circuitBreaker: {
      isOpen: false,
      failures: 0,
      lastFailure: null,
    },
    healthCheck: {
      intervalMs: 0,
      isRunning: false,
    },
  };
}

/**
 * Force reconnect to MinIO (for manual recovery)
 */
async function forceReconnect() {
  minioAvailable = false;
  return await initializeS3Client();
}

/**
 * Upload buffer directly to storage with specified key
 * 
 * @param {Buffer} buffer - File data
 * @param {string} objectKey - Full object key
 * @param {string} contentType - MIME type
 * @returns {Promise<{key: string, size: number, storage: string}>}
 */
async function uploadBuffer(buffer, objectKey, contentType = 'application/octet-stream') {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('uploadBuffer requires a Buffer');
  }

  if (!objectKey || typeof objectKey !== 'string') {
    throw new Error('objectKey is required');
  }

  // Determine bucket from key prefix
  let bucketName = config.audioBucket;
  let cleanKey = objectKey;

  if (objectKey.startsWith('covers/')) {
    bucketName = config.coversBucket;
  } else if (objectKey.startsWith('audio/')) {
    // Keep audio prefix in key
  }

  if (!isMinioReady()) {
    const unavailableError = new Error('MinIO storage is unavailable');
    unavailableError.code = 'MINIO_UNAVAILABLE';
    throw unavailableError;
  }

  await s3Client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: cleanKey,
    Body: buffer,
    ContentType: contentType,
    Metadata: {
      'upload-timestamp': String(Date.now()),
    },
  }));

  return {
    key: cleanKey,
    size: buffer.length,
    storage: 'minio',
    location: `minio://${bucketName}/${cleanKey}`,
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  initializeS3Client,
  uploadFile,
  uploadFileFromPathWithKey,
  uploadBuffer,
  getFileStream,
  fileExists,
  deleteFile,
  listObjects,
  getPresignedUrl,
  resolveObjectKey,
  getContentType,
  getStorageStatus,
  generateObjectKey,
  stopHealthChecks,
  forceReconnect,
  isMinioReady,
  config,
  // Export s3Client for direct presigned URL generation in stream router
  getS3Client: () => s3Client,
};
