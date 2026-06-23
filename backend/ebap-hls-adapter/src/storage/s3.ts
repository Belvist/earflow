import { GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';

export type S3Config = {
    endpoint: string;
    port: number;
    useSsl: boolean;
    accessKeyId: string;
    secretAccessKey: string;
};

export function createS3Client(cfg: S3Config): S3Client {
    const protocol = cfg.useSsl ? 'https' : 'http';
    const endpoint = `${protocol}://${cfg.endpoint}:${cfg.port}`;

    const requestHandler = new NodeHttpHandler({
        httpAgent: new HttpAgent({ keepAlive: true, maxSockets: 1024, maxFreeSockets: 256, keepAliveMsecs: 30_000 }),
        httpsAgent: new HttpsAgent({ keepAlive: true, maxSockets: 1024, maxFreeSockets: 256, keepAliveMsecs: 30_000 }),
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

export async function headObject(params: { s3: S3Client; bucket: string; key: string; timeoutMs: number }): Promise<boolean> {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
        try {
            ctrl.abort();
        } catch {
        }
    }, params.timeoutMs);

    try {
        await params.s3.send(new HeadObjectCommand({ Bucket: params.bucket, Key: params.key }), { abortSignal: ctrl.signal, requestTimeout: params.timeoutMs });
        return true;
    } catch {
        return false;
    } finally {
        clearTimeout(t);
    }
}

export async function headObjectMeta(params: {
    s3: S3Client;
    bucket: string;
    key: string;
    timeoutMs: number;
}): Promise<{ etag: string | null; contentLength: number | null; lastModifiedMs: number | null } | null> {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
        try {
            ctrl.abort();
        } catch {
        }
    }, params.timeoutMs);

    try {
        const resp: any = await params.s3.send(
            new HeadObjectCommand({ Bucket: params.bucket, Key: params.key }),
            { abortSignal: ctrl.signal, requestTimeout: params.timeoutMs }
        );

        const etag = typeof resp?.ETag === 'string' && resp.ETag.trim() ? String(resp.ETag).trim() : null;
        const contentLength = typeof resp?.ContentLength === 'number' && Number.isFinite(resp.ContentLength) ? resp.ContentLength : null;
        const lm = resp?.LastModified instanceof Date ? resp.LastModified.getTime() : null;
        const lastModifiedMs = typeof lm === 'number' && Number.isFinite(lm) ? lm : null;

        return { etag, contentLength, lastModifiedMs };
    } catch {
        return null;
    } finally {
        clearTimeout(t);
    }
}

export async function headBucket(params: { s3: S3Client; bucket: string; timeoutMs: number }): Promise<boolean> {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
        try {
            ctrl.abort();
        } catch {
        }
    }, params.timeoutMs);

    try {
        await params.s3.send(new HeadBucketCommand({ Bucket: params.bucket }), { abortSignal: ctrl.signal, requestTimeout: params.timeoutMs });
        return true;
    } catch {
        return false;
    } finally {
        clearTimeout(t);
    }
}

export async function getObjectBytesCapped(params: {
    s3: S3Client;
    bucket: string;
    key: string;
    maxBytes: number;
    timeoutMs: number;
    range?: { start: number; end?: number } | { suffix: number };
}): Promise<{ bytes: Uint8Array; contentType: string | null; contentRange: string | null; contentLength: number | null }> {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
        try {
            ctrl.abort();
        } catch {
        }
    }, params.timeoutMs);

    try {
        const rangeHeader = (() => {
            const r = params.range;
            if (!r) return undefined;
            if ('suffix' in r) return `bytes=-${r.suffix}`;
            if (r.end === undefined) return `bytes=${r.start}-`;
            return `bytes=${r.start}-${r.end}`;
        })();

        let resp: any;
        try {
            resp = await params.s3.send(
                new GetObjectCommand({ Bucket: params.bucket, Key: params.key, Range: rangeHeader }),
                { abortSignal: ctrl.signal, requestTimeout: params.timeoutMs }
            );
        } catch (e) {
            if (ctrl.signal.aborted) {
                throw new Error('S3_TIMEOUT');
            }
            throw e;
        }

        const body: any = resp.Body;
        if (!body) throw new Error('S3_BODY_MISSING');

        const stream = new Response(body as any).body;
        if (!stream) throw new Error('S3_STREAM_MISSING');

        const reader = stream.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;

        try {
            while (true) {
                if (ctrl.signal.aborted) throw new Error('S3_TIMEOUT');
                const { value, done } = await reader.read();
                if (done) break;
                if (!(value instanceof Uint8Array)) throw new Error('S3_BAD_CHUNK');
                total += value.byteLength;
                if (total > params.maxBytes) throw new Error('S3_OBJECT_TOO_LARGE');
                chunks.push(value);
            }
        } finally {
            try {
                await reader.cancel();
            } catch {
            }
        }

        if (ctrl.signal.aborted) throw new Error('S3_TIMEOUT');

        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
            out.set(c, off);
            off += c.byteLength;
        }

        const ct = typeof resp.ContentType === 'string' ? resp.ContentType : null;
        const cr = typeof resp.ContentRange === 'string' ? resp.ContentRange : null;
        const cl = typeof resp.ContentLength === 'number' && Number.isFinite(resp.ContentLength) ? resp.ContentLength : null;

        return { bytes: out, contentType: ct, contentRange: cr, contentLength: cl };
    } finally {
        clearTimeout(t);
    }
}

export async function putObjectBytes(params: {
    s3: S3Client;
    bucket: string;
    key: string;
    bytes: Uint8Array;
    contentType?: string;
    cacheControl?: string;
    timeoutMs: number;
}): Promise<void> {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
        try {
            ctrl.abort();
        } catch {
        }
    }, params.timeoutMs);

    try {
        await params.s3.send(
            new PutObjectCommand({
                Bucket: params.bucket,
                Key: params.key,
                Body: params.bytes,
                ContentType: params.contentType,
                CacheControl: params.cacheControl,
            }),
            { abortSignal: ctrl.signal, requestTimeout: params.timeoutMs }
        );
    } finally {
        clearTimeout(t);
    }
}
