import { HeadObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import path from 'node:path';

export function createS3Client(cfg: {
    endpoint: string;
    port: number;
    useSsl: boolean;
    accessKeyId: string;
    secretAccessKey: string;
}): S3Client {
    const protocol = cfg.useSsl ? 'https' : 'http';
    const endpoint = `${protocol}://${cfg.endpoint}:${cfg.port}`;

    const requestHandler = new NodeHttpHandler({
        httpAgent: new HttpAgent({ keepAlive: true, maxSockets: 256, maxFreeSockets: 64, keepAliveMsecs: 30_000 }),
        httpsAgent: new HttpsAgent({ keepAlive: true, maxSockets: 256, maxFreeSockets: 64, keepAliveMsecs: 30_000 }),
    });

    return new S3Client({
        region: 'us-east-1',
        endpoint,
        forcePathStyle: true,
        requestHandler,
        credentials: {
            accessKeyId: cfg.accessKeyId,
            secretAccessKey: cfg.secretAccessKey,
        },
    });
}

function normalizeObjectKey(raw: string): string {
    const s = String(raw || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
    if (!s) return '';
    if (s.includes('..')) return '';
    return s;
}

function buildPossibleObjectKeys(filePath: string): string[] {
    const normalizedKey = normalizeObjectKey(filePath);
    if (!normalizedKey) return [];

    const bucketPrefix = 'audio/';

    if (normalizedKey.startsWith(bucketPrefix)) {
        return [normalizedKey];
    }

    if (normalizedKey.startsWith('library/')) {
        return [`${bucketPrefix}${normalizedKey}`];
    }

    return [`${bucketPrefix}${normalizedKey}`, `${bucketPrefix}library/${normalizedKey}`];
}

export async function resolveAudioObjectKey(params: {
    s3: S3Client;
    bucket: string;
    filePath: string;
}): Promise<string | null> {
    const keys = buildPossibleObjectKeys(params.filePath);
    for (const key of keys) {
        try {
            await params.s3.send(new HeadObjectCommand({ Bucket: params.bucket, Key: key }));
            return key;
        } catch (e: any) {
            const st = e?.$metadata?.httpStatusCode;
            if (st === 404 || e?.name === 'NotFound') {
                continue;
            }
            throw new Error('MINIO_UNAVAILABLE');
        }
    }
    return null;
}

export async function presignGetObjectUrl(params: {
    s3: S3Client;
    bucket: string;
    key: string;
    expiresInSeconds: number;
}): Promise<string> {
    const expires = Number.isFinite(params.expiresInSeconds) ? Math.floor(params.expiresInSeconds) : 0;
    if (!Number.isInteger(expires) || expires <= 0 || expires > 3600) {
        throw new Error('INVALID_PRESIGN_EXPIRES');
    }

    const command = new GetObjectCommand({ Bucket: params.bucket, Key: params.key });
    return await getSignedUrl(params.s3, command, { expiresIn: expires });
}

export async function headObject(params: {
    s3: S3Client;
    bucket: string;
    key: string;
    timeoutMs?: number;
}): Promise<boolean> {
    const timeoutMs = Math.max(1, Math.trunc(params.timeoutMs ?? 5000));
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        await params.s3.send(
            new HeadObjectCommand({ Bucket: params.bucket, Key: normalizeObjectKey(params.key) }),
            { abortSignal: ctrl.signal, requestTimeout: timeoutMs }
        );
        return true;
    } catch {
        return false;
    } finally {
        clearTimeout(timeout);
    }
}

export async function headObjectInfo(params: {
    s3: S3Client;
    bucket: string;
    key: string;
    timeoutMs?: number;
}): Promise<{ contentLength: number; contentType: string | null } | null> {
    const key = normalizeObjectKey(params.key);
    if (!key) return null;
    const timeoutMs = Math.max(1, Math.trunc(params.timeoutMs ?? 5000));
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const resp: any = await params.s3.send(
            new HeadObjectCommand({ Bucket: params.bucket, Key: key }),
            { abortSignal: ctrl.signal, requestTimeout: timeoutMs }
        );
        const contentLength = Number(resp.ContentLength);
        if (!Number.isFinite(contentLength) || contentLength < 0) return null;
        return {
            contentLength: Math.trunc(contentLength),
            contentType: typeof resp.ContentType === 'string' ? resp.ContentType : null,
        };
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

export async function getObjectRange(params: {
    s3: S3Client;
    bucket: string;
    key: string;
    start: number;
    end: number;
    timeoutMs?: number;
}): Promise<{ body: ReadableStream<Uint8Array>; contentLength: number; contentType: string | null }> {
    const key = normalizeObjectKey(params.key);
    if (!key) throw new Error('S3_BAD_KEY');
    const start = Math.max(0, Math.trunc(params.start));
    const end = Math.max(start, Math.trunc(params.end));
    const timeoutMs = Math.max(1, Math.trunc(params.timeoutMs ?? 5000));
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const resp: any = await params.s3.send(
            new GetObjectCommand({ Bucket: params.bucket, Key: key, Range: `bytes=${start}-${end}` }),
            { abortSignal: ctrl.signal, requestTimeout: timeoutMs }
        );
        const body: any = resp.Body;
        if (!body) throw new Error('S3_BODY_MISSING');
        const stream = new Response(body as any).body;
        if (!stream) throw new Error('S3_STREAM_MISSING');
        const contentLength = Number(resp.ContentLength);
        return {
            body: stream as ReadableStream<Uint8Array>,
            contentLength: Number.isFinite(contentLength) && contentLength >= 0 ? Math.trunc(contentLength) : end - start + 1,
            contentType: typeof resp.ContentType === 'string' ? resp.ContentType : null,
        };
    } finally {
        clearTimeout(timeout);
    }
}

export async function getObjectBytesCapped(params: {
    s3: S3Client;
    bucket: string;
    key: string;
    maxBytes: number;
    timeoutMs?: number;
}): Promise<{ bytes: Uint8Array; contentType: string | null }> {
    const key = normalizeObjectKey(params.key);
    if (!key) throw new Error('S3_BAD_KEY');
    const maxBytes = Math.max(1, Math.trunc(params.maxBytes));
    const timeoutMs = Math.max(1, Math.trunc(params.timeoutMs ?? 5000));
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const resp: any = await params.s3.send(
            new GetObjectCommand({ Bucket: params.bucket, Key: key }),
            { abortSignal: ctrl.signal, requestTimeout: timeoutMs }
        );
        const body: any = resp.Body;
        if (!body) throw new Error('S3_BODY_MISSING');

        const stream = new Response(body as any).body;
        if (!stream) throw new Error('S3_STREAM_MISSING');

        const reader = stream.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                if (!(value instanceof Uint8Array)) throw new Error('S3_BAD_CHUNK');
                total += value.byteLength;
                if (total > maxBytes) throw new Error('S3_OBJECT_TOO_LARGE');
                chunks.push(value);
            }
        } finally {
            await reader.cancel().catch(() => undefined);
        }

        const out = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            out.set(chunk, offset);
            offset += chunk.byteLength;
        }

        return {
            bytes: out,
            contentType: typeof resp.ContentType === 'string' ? resp.ContentType : null,
        };
    } finally {
        clearTimeout(timeout);
    }
}
