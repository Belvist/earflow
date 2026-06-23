import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import type { Config } from '../config';
import { createLinkedAbort } from '../lib/abort';

export function createS3Client(cfg: Config): S3Client {
    const protocol = cfg.minio.useSsl ? 'https' : 'http';
    const endpoint = `${protocol}://${cfg.minio.endpoint}:${cfg.minio.port}`;

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
            accessKeyId: cfg.minio.accessKeyId,
            secretAccessKey: cfg.minio.secretAccessKey,
        },
    });
}

export async function headObject(params: {
    s3: S3Client;
    bucket: string;
    key: string;
    timeoutMs: number;
    abortSignal?: AbortSignal;
}): Promise<boolean> {
    const linked = createLinkedAbort({ parent: params.abortSignal, timeoutMs: params.timeoutMs });
    try {
        await params.s3.send(new HeadObjectCommand({ Bucket: params.bucket, Key: params.key }), {
            abortSignal: linked.signal,
            requestTimeout: params.timeoutMs,
        } as any);
        return true;
    } catch (e: any) {
        const status = e?.$metadata?.httpStatusCode;
        if (status === 404 || e?.name === 'NotFound' || e?.Code === 'NotFound') {
            return false;
        }
        throw new Error('S3 headObject failed', { cause: e });
    } finally {
        linked.dispose();
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
    abortSignal?: AbortSignal;
}): Promise<void> {
    const linked = createLinkedAbort({ parent: params.abortSignal, timeoutMs: params.timeoutMs });
    try {
        await params.s3.send(
            new PutObjectCommand({
                Bucket: params.bucket,
                Key: params.key,
                Body: params.bytes,
                ContentType: params.contentType,
                CacheControl: params.cacheControl,
            }),
            { abortSignal: linked.signal, requestTimeout: params.timeoutMs } as any
        );
    } catch (e) {
        throw new Error('S3 putObject failed', { cause: e });
    } finally {
        linked.dispose();
    }
}

export async function getObjectToFile(params: {
    s3: S3Client;
    bucket: string;
    key: string;
    outPath: string;
    timeoutMs: number;
    abortSignal?: AbortSignal;
}): Promise<void> {
    const linked = createLinkedAbort({ parent: params.abortSignal, timeoutMs: params.timeoutMs });
    let resp: any;
    try {
        resp = await params.s3.send(new GetObjectCommand({ Bucket: params.bucket, Key: params.key }), {
            abortSignal: linked.signal,
            requestTimeout: params.timeoutMs,
        } as any);
    } catch (e) {
        linked.dispose();
        throw new Error('S3 getObject failed', { cause: e });
    }

    try {
        const body = resp?.Body;
        const stream = new Response(body as any).body;
        if (!stream) {
            throw new Error('S3 object stream missing');
        }

        const file = Bun.file(params.outPath);
        const writer = file.writer();
        const reader = stream.getReader();

        try {
            while (true) {
                const r = await reader.read();
                if (r.done) break;
                if (!(r.value instanceof Uint8Array)) {
                    throw new Error('Invalid S3 stream chunk');
                }
                writer.write(r.value);
            }
        } finally {
            try {
                await reader.cancel();
            } catch {
            }
            writer.end();
        }
    } finally {
        linked.dispose();
    }
}
