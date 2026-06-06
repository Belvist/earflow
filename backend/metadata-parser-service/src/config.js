'use strict';

function requireEnv(key) {
    const v = process.env[key];
    if (!v) throw new Error(`Missing required env: ${key}`);
    return v;
}

module.exports = {
    port: parseInt(process.env.PORT || '3072', 10),
    databaseUrl: requireEnv('DATABASE_URL'),
    dbMaxConnections: Math.max(1, Math.min(parseInt(process.env.DB_MAX_CONNECTIONS || '5', 10) || 5, 50)),
    minioEndpoint: process.env.MINIO_ENDPOINT || 'minio',
    minioPort: parseInt(process.env.MINIO_PORT || '9000', 10),
    minioUseSsl: process.env.MINIO_USE_SSL === 'true',
    minioAccessKey: requireEnv('MINIO_ACCESS_KEY'),
    minioSecretKey: requireEnv('MINIO_SECRET_KEY'),
    minioBucketAudio: process.env.MINIO_BUCKET_AUDIO || 'music-audio',
    minioBucketCovers: process.env.MINIO_BUCKET_COVERS || 'music-covers',
    pollIntervalMs: parseInt(process.env.METADATA_POLL_MS || '5000', 10),
    concurrency: parseInt(process.env.METADATA_CONCURRENCY || '2', 10),
    maxFileSizeBytes: parseInt(process.env.METADATA_MAX_FILE_BYTES || '524288', 10),
};
