'use strict';

const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const cfg = require('./config');

const s3 = new S3Client({
    endpoint: `${cfg.minioUseSsl ? 'https' : 'http'}://${cfg.minioEndpoint}:${cfg.minioPort}`,
    region: 'us-east-1',
    credentials: {
        accessKeyId: cfg.minioAccessKey,
        secretAccessKey: cfg.minioSecretKey,
    },
    forcePathStyle: true,
});

async function downloadRange(bucket, key, maxBytes) {
    const cmd = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        Range: `bytes=0-${maxBytes - 1}`,
    });
    const resp = await s3.send(cmd);
    const chunks = [];
    for await (const chunk of resp.Body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

async function uploadBuffer(bucket, key, buf, contentType) {
    await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buf,
        ContentType: contentType,
        ContentLength: buf.length,
    }));
}

module.exports = { downloadRange, uploadBuffer };
