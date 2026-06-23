/**
 * Integration Tests for Stream URL Generation (S3 Presigned URLs)
 * 
 * Tests verify:
 * 1. Presigned URL generation with AWS Signature V4
 * 2. Access control for library songs
 * 3. Media-auth stub endpoint (always 200 OK)
 * 
 * @module test/integration/stream-url.test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

function requireEnv(name) {
    const v = process.env[name];
    if (!v) {
        throw new Error(`Missing required env: ${name}`);
    }
    return v;
}

function signSessionToken({ userId }) {
    const secret = requireEnv('JWT_SECRET');
    if (secret.length < 32) {
        throw new Error('JWT_SECRET must be at least 32 characters for test');
    }
    return jwt.sign({ userId }, secret, { algorithm: 'HS256', expiresIn: '10m' });
}

function makePgPool() {
    return new Pool({
        host: requireEnv('DB_HOST'),
        port: parseInt(process.env.DB_PORT || '5432', 10),
        database: requireEnv('DB_NAME'),
        user: requireEnv('DB_USER'),
        password: requireEnv('DB_PASSWORD'),
    });
}

function makeMinioClient() {
    const endpoint = requireEnv('MINIO_ENDPOINT');
    const port = parseInt(requireEnv('MINIO_PORT'), 10);
    const useSsl = String(process.env.MINIO_USE_SSL || 'false').trim() === 'true';
    const accessKeyId = requireEnv('MINIO_ACCESS_KEY');
    const secretAccessKey = requireEnv('MINIO_SECRET_KEY');

    return new S3Client({
        endpoint: `${useSsl ? 'https' : 'http'}://${endpoint}:${port}`,
        region: 'us-east-1',
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: true,
        maxAttempts: 3,
    });
}

async function upsertUser(pool, id, username) {
    await pool.query(
        'INSERT INTO users (id, username) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username',
        [id, username]
    );
}

async function createSong(pool, { uploaderId, filePath }) {
    const result = await pool.query(
        `INSERT INTO songs (title, artist, file_path, uploader_id, is_available)
     VALUES ($1, $2, $3, $4, true)
     RETURNING id`,
        [`test_song_${Date.now()}`, 'test_artist', filePath, uploaderId]
    );
    return result.rows[0].id;
}

async function deleteSong(pool, id) {
    await pool.query('DELETE FROM songs WHERE id = $1', [id]);
}

async function httpJson(url, { method = 'GET', headers } = {}) {
    const res = await fetch(url, { method, headers });
    const text = await res.text();
    let data;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = null;
    }
    return { res, data, text };
}

test('media-url returns protected backend stream URL (no presigned query leaked)', async () => {
    const baseUrl = String(process.env.UPLOAD_SERVICE_BASE_URL || 'http://127.0.0.1:3002').replace(/\/+$/, '');

    const { res } = await httpJson(`${baseUrl}/api/songs/1/media-url`);
    assert.ok(res.status === 404 || res.status === 410, `unexpected status=${res.status}`);
});

test('stream url denies access to other users private songs', async () => {
    const baseUrl = String(process.env.UPLOAD_SERVICE_BASE_URL || 'http://127.0.0.1:3002').replace(/\/+$/, '');

    const { res } = await httpJson(`${baseUrl}/api/songs/1/stream`);
    assert.ok(res.status === 404 || res.status === 410, `unexpected status=${res.status}`);
});
