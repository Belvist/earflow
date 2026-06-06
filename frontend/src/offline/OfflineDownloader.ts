/**
 * Сервис скачивания треков для офлайн-режима.
 *
 * Использует Direct-Stream endpoint (те же signed URL что для стрима),
 * fetch с AbortController, progress через ReadableStream reader.
 *
 * Безопасность:
 *   - НЕ сохраняем signed URL или токены — только id + title + blob
 *   - Включаем credentials для корректной аутентификации cookie
 *   - Проверяем Content-Length от сервера чтобы не скачать "бесконечный" стрим
 *   - Ограничение на размер файла (MAX_TRACK_SIZE_MB) чтобы не DDoSнуть storage
 */

import { saveTrack, hasTrack, getStorageQuota, type OfflineTrackMeta } from './OfflineStorage';

const MAX_TRACK_SIZE_MB = 60;
const MAX_TRACK_SIZE_BYTES = MAX_TRACK_SIZE_MB * 1024 * 1024;
const QUOTA_SAFETY_RATIO = 0.85;

export type DownloadProgress = (_loaded: number, _total: number) => void;

export interface DownloadTrackInput {
    id: string;
    title: string;
    artist: string;
    album?: string;
    durationSec: number;
    coverUrl?: string;
    streamUrl: string;
    mime?: string;
    quality?: string;
}

export interface DownloadResult {
    ok: boolean;
    bytes: number;
    reason?: 'ALREADY_EXISTS' | 'ABORTED' | 'QUOTA_EXCEEDED' | 'TOO_LARGE' | 'FETCH_FAILED' | 'EMPTY';
}

interface DirectSessionQuality {
    tag?: string;
    bitrate?: number;
    codec?: string;
    url?: string;
    mime?: string;
}

interface DirectSessionResponse {
    url?: string;
    mime?: string | null;
    qualities?: DirectSessionQuality[] | null;
}

interface ApiClientLike {
    getSongDirectSession?: (_id: string | number, _opts?: { signal?: AbortSignal }) => Promise<DirectSessionResponse>;
}

async function ensureQuotaHasRoom(expectedBytes: number): Promise<boolean> {
    const q = await getStorageQuota();
    if (!q || q.quota === 0) return true;
    const projected = q.usage + expectedBytes;
    return projected < q.quota * QUOTA_SAFETY_RATIO;
}

export async function downloadTrack(
    input: DownloadTrackInput,
    signal?: AbortSignal,
    onProgress?: DownloadProgress,
): Promise<DownloadResult> {
    if (!input?.id || !input.streamUrl) {
        return { ok: false, bytes: 0, reason: 'FETCH_FAILED' };
    }
    if (signal?.aborted) {
        return { ok: false, bytes: 0, reason: 'ABORTED' };
    }

    const already = await hasTrack(input.id);
    if (already) {
        return { ok: true, bytes: 0, reason: 'ALREADY_EXISTS' };
    }
    if (signal?.aborted) {
        return { ok: false, bytes: 0, reason: 'ABORTED' };
    }

    let response: Response;
    try {
        response = await fetch(input.streamUrl, {
            method: 'GET',
            credentials: 'include',
            signal,
            cache: 'no-store',
        });
    } catch (e) {
        const name = (e as Error)?.name || '';
        if (name === 'AbortError') return { ok: false, bytes: 0, reason: 'ABORTED' };
        return { ok: false, bytes: 0, reason: 'FETCH_FAILED' };
    }

    if (!response.ok || !response.body) {
        try { response.body?.cancel(); } catch { }
        return { ok: false, bytes: 0, reason: 'FETCH_FAILED' };
    }

    if (signal?.aborted) {
        try { response.body.cancel(); } catch { }
        return { ok: false, bytes: 0, reason: 'ABORTED' };
    }

    const contentLengthRaw = response.headers.get('content-length');
    const contentLength = Number(contentLengthRaw);
    const expectedSize = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : 0;

    if (expectedSize > MAX_TRACK_SIZE_BYTES) {
        try { response.body.cancel(); } catch { }
        return { ok: false, bytes: 0, reason: 'TOO_LARGE' };
    }

    if (expectedSize > 0) {
        const hasRoom = await ensureQuotaHasRoom(expectedSize);
        if (!hasRoom) {
            try { response.body.cancel(); } catch { }
            return { ok: false, bytes: 0, reason: 'QUOTA_EXCEEDED' };
        }
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;

    try {
        while (true) {
            if (signal?.aborted) {
                try { reader.cancel(); } catch { }
                return { ok: false, bytes: loaded, reason: 'ABORTED' };
            }

            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;

            loaded += value.byteLength;

            if (loaded > MAX_TRACK_SIZE_BYTES) {
                try { reader.cancel(); } catch { }
                return { ok: false, bytes: loaded, reason: 'TOO_LARGE' };
            }

            chunks.push(value);
            try { onProgress?.(loaded, expectedSize); } catch { }
        }
    } catch (e) {
        const name = (e as Error)?.name || '';
        try { reader.cancel(); } catch { }
        if (name === 'AbortError') return { ok: false, bytes: loaded, reason: 'ABORTED' };
        return { ok: false, bytes: loaded, reason: 'FETCH_FAILED' };
    }

    if (loaded === 0) {
        return { ok: false, bytes: 0, reason: 'EMPTY' };
    }

    const mime = input.mime || response.headers.get('content-type') || 'audio/mpeg';
    const blob = new Blob(chunks as BlobPart[], { type: mime });

    const meta: OfflineTrackMeta = {
        id: String(input.id),
        title: String(input.title || ''),
        artist: String(input.artist || ''),
        album: input.album ? String(input.album) : undefined,
        durationSec: Number.isFinite(input.durationSec) ? Number(input.durationSec) : 0,
        coverUrl: input.coverUrl ? String(input.coverUrl) : undefined,
        addedAt: Date.now(),
        sizeBytes: loaded,
        mime,
        quality: input.quality,
    };

    try {
        await saveTrack(meta, blob);
        return { ok: true, bytes: loaded };
    } catch (e) {
        const msg = (e as Error)?.message || '';
        if (msg === 'OFFLINE_QUOTA_EXCEEDED') {
            return { ok: false, bytes: loaded, reason: 'QUOTA_EXCEEDED' };
        }
        return { ok: false, bytes: loaded, reason: 'FETCH_FAILED' };
    }
}

export async function resolveTrackStreamUrl(
    apiClient: ApiClientLike,
    trackId: string,
    signal?: AbortSignal,
): Promise<{ url: string; mime: string; quality: string } | null> {
    if (!apiClient || typeof apiClient.getSongDirectSession !== 'function') return null;
    try {
        const sess = await apiClient.getSongDirectSession(trackId, { signal });
        if (!sess) return null;
        const sessionUrl = typeof sess.url === 'string' && sess.url ? sess.url : '';
        const sessionMime = typeof sess.mime === 'string' && sess.mime ? sess.mime : '';

        const qualities: DirectSessionQuality[] = Array.isArray(sess.qualities) ? sess.qualities : [];
        const best = qualities
            .filter((q) => q && typeof q.url === 'string' && q.url)
            .sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0))[0];

        const bestUrl = (best?.url && String(best.url)) || sessionUrl;
        if (!bestUrl) return null;

        const bestMime = (best?.mime && String(best.mime)) || sessionMime || 'audio/mpeg';
        if (bestMime.toLowerCase().includes('mpegurl') || bestUrl.toLowerCase().includes('.m3u8')) return null;
        const quality = best?.tag ? String(best.tag) : 'auto';

        return { url: bestUrl, mime: bestMime, quality };
    } catch {
        return null;
    }
}
