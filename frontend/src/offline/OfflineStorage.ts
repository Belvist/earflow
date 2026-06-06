/**
 * Низкоуровневая обёртка над IndexedDB для офлайн-хранения треков.
 * Две object-store:
 *   - tracks: метаданные { id, title, artist, durationSec, coverUrl, addedAt, sizeBytes, mime }
 *   - blobs:  запись вида { mime: string, data: ArrayBuffer } под ключом id
 *
 * Формат записи внутри STORE_BLOBS выбран как { mime, data: ArrayBuffer } вместо
 * Blob напрямую по двум причинам:
 *   1. ArrayBuffer — cloneable primitive, идентично ведёт себя в любом рантайме
 *      (браузер / jsdom / Node), Blob же сериализуется по-разному и плохо
 *      переживает structuredClone-polyfills в тестах.
 *   2. В браузере IDB одинаково эффективно хранит ArrayBuffer на диске
 *      (у Chrome — через SQLite levelDB), но без скрытых ссылок на файл-хендлы,
 *      что повышает детерминизм и портабельность.
 *
 * Безопасность:
 *   - Храним только id/title/artist и производные (coverUrl) — без JWT, без URL с токенами
 *   - Все операции wrapped в promisified API с proper error handling
 *   - При quota overflow upstream получает явный OFFLINE_QUOTA_EXCEEDED и не падает тихо
 */

export interface OfflineTrackMeta {
    id: string;
    title: string;
    artist: string;
    album?: string;
    durationSec: number;
    coverUrl?: string;
    addedAt: number;
    sizeBytes: number;
    mime: string;
    quality?: string;
}

interface StoredBlobRecord {
    mime: string;
    data: ArrayBuffer;
}

const DB_NAME = 'earflow_offline_v1';
const DB_VERSION = 1;
const STORE_TRACKS = 'tracks';
const STORE_BLOBS = 'blobs';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    if (typeof indexedDB === 'undefined') {
        return Promise.reject(new Error('OFFLINE_INDEXEDDB_UNAVAILABLE'));
    }

    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        let req: IDBOpenDBRequest;
        try {
            req = indexedDB.open(DB_NAME, DB_VERSION);
        } catch (e) {
            reject(e instanceof Error ? e : new Error('OFFLINE_DB_OPEN_FAILED'));
            return;
        }

        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_TRACKS)) {
                const tracks = db.createObjectStore(STORE_TRACKS, { keyPath: 'id' });
                tracks.createIndex('addedAt', 'addedAt', { unique: false });
            }
            if (!db.objectStoreNames.contains(STORE_BLOBS)) {
                db.createObjectStore(STORE_BLOBS);
            }
        };

        req.onsuccess = () => {
            const db = req.result;
            db.onversionchange = () => {
                try { db.close(); } catch { }
                dbPromise = null;
            };
            resolve(db);
        };

        req.onerror = () => {
            dbPromise = null;
            reject(req.error || new Error('OFFLINE_DB_OPEN_FAILED'));
        };

        req.onblocked = () => {
            dbPromise = null;
            reject(new Error('OFFLINE_DB_BLOCKED'));
        };
    });

    return dbPromise;
}

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IDB_REQUEST_FAILED'));
    });
}

function isBlobLike(value: unknown): value is Blob {
    if (!value || typeof value !== 'object') return false;
    const v = value as { size?: unknown; type?: unknown; arrayBuffer?: unknown };
    return typeof v.size === 'number'
        && typeof v.type === 'string'
        && typeof v.arrayBuffer === 'function';
}

function isArrayBufferLike(value: unknown): value is ArrayBuffer {
    if (!value || typeof value !== 'object') return false;
    if (value instanceof ArrayBuffer) return true;
    const byteLength = (value as { byteLength?: unknown }).byteLength;
    const slice = (value as { slice?: unknown }).slice;
    return typeof byteLength === 'number' && typeof slice === 'function';
}

function isStoredBlobRecord(value: unknown): value is StoredBlobRecord {
    if (!value || typeof value !== 'object') return false;
    const v = value as { mime?: unknown; data?: unknown };
    return typeof v.mime === 'string' && isArrayBufferLike(v.data);
}

function toBlobPart(data: unknown): BlobPart {
    if (data instanceof ArrayBuffer) return data;
    if (ArrayBuffer.isView(data)) {
        const view = data as ArrayBufferView;
        return new Uint8Array(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength);
    }
    return data as BlobPart;
}

async function toStoredRecord(blob: Blob): Promise<StoredBlobRecord> {
    const data = await blob.arrayBuffer();
    return { mime: blob.type || 'application/octet-stream', data };
}

function fromStoredRecord(record: StoredBlobRecord): Blob {
    return new Blob([toBlobPart(record.data)], { type: record.mime || 'application/octet-stream' });
}

export async function saveTrack(meta: OfflineTrackMeta, blob: Blob): Promise<void> {
    if (!meta?.id) throw new Error('OFFLINE_INVALID_META');
    if (!isBlobLike(blob)) throw new Error('OFFLINE_INVALID_BLOB');

    const record = await toStoredRecord(blob);
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_TRACKS, STORE_BLOBS], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('OFFLINE_TX_FAILED'));
        tx.onabort = () => {
            const err = tx.error;
            if (err && err.name === 'QuotaExceededError') {
                reject(new Error('OFFLINE_QUOTA_EXCEEDED'));
            } else {
                reject(err || new Error('OFFLINE_TX_ABORTED'));
            }
        };

        try {
            tx.objectStore(STORE_TRACKS).put(meta);
            tx.objectStore(STORE_BLOBS).put(record, meta.id);
        } catch (e) {
            try { tx.abort(); } catch { }
            reject(e instanceof Error ? e : new Error('OFFLINE_PUT_FAILED'));
        }
    });
}

export async function getTrackMeta(id: string): Promise<OfflineTrackMeta | null> {
    if (!id) return null;
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_TRACKS, 'readonly');
        const store = tx.objectStore(STORE_TRACKS);
        const meta = await promisifyRequest<OfflineTrackMeta | undefined>(store.get(id));
        return meta ?? null;
    } catch {
        return null;
    }
}

export async function getTrackBlob(id: string): Promise<Blob | null> {
    if (!id) return null;
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_BLOBS, 'readonly');
        const store = tx.objectStore(STORE_BLOBS);
        const raw = await promisifyRequest<unknown>(store.get(id));
        if (isStoredBlobRecord(raw)) return fromStoredRecord(raw);
        if (isBlobLike(raw)) return raw;
        return null;
    } catch {
        return null;
    }
}

export async function hasTrack(id: string): Promise<boolean> {
    if (!id) return false;
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_TRACKS, 'readonly');
        const store = tx.objectStore(STORE_TRACKS);
        const key = await promisifyRequest<IDBValidKey | undefined>(store.getKey(id));
        return key !== undefined;
    } catch {
        return false;
    }
}

export async function deleteTrack(id: string): Promise<void> {
    if (!id) return;
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_TRACKS, STORE_BLOBS], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('OFFLINE_DELETE_FAILED'));
        try {
            tx.objectStore(STORE_TRACKS).delete(id);
            tx.objectStore(STORE_BLOBS).delete(id);
        } catch (e) {
            try { tx.abort(); } catch { }
            reject(e instanceof Error ? e : new Error('OFFLINE_DELETE_FAILED'));
        }
    });
}

export async function listTracks(): Promise<OfflineTrackMeta[]> {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_TRACKS, 'readonly');
        const store = tx.objectStore(STORE_TRACKS);
        const all = await promisifyRequest<OfflineTrackMeta[]>(store.getAll());
        return Array.isArray(all) ? all : [];
    } catch {
        return [];
    }
}

export async function listTrackIds(): Promise<string[]> {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_TRACKS, 'readonly');
        const store = tx.objectStore(STORE_TRACKS);
        const keys = await promisifyRequest<IDBValidKey[]>(store.getAllKeys());
        return Array.isArray(keys) ? keys.map((k) => String(k)) : [];
    } catch {
        return [];
    }
}

export async function clearAll(): Promise<void> {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_TRACKS, STORE_BLOBS], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('OFFLINE_CLEAR_FAILED'));
        try {
            tx.objectStore(STORE_TRACKS).clear();
            tx.objectStore(STORE_BLOBS).clear();
        } catch (e) {
            try { tx.abort(); } catch { }
            reject(e instanceof Error ? e : new Error('OFFLINE_CLEAR_FAILED'));
        }
    });
}

export async function computeTotalBytes(): Promise<number> {
    const tracks = await listTracks();
    let total = 0;
    for (const t of tracks) {
        const n = Number(t.sizeBytes);
        if (Number.isFinite(n) && n > 0) total += n;
    }
    return total;
}

export interface StorageQuota {
    usage: number;
    quota: number;
    usageRatio: number;
}

export async function getStorageQuota(): Promise<StorageQuota | null> {
    try {
        const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
        if (!nav?.storage?.estimate) return null;
        const est = await nav.storage.estimate();
        const usage = Number(est.usage) || 0;
        const quota = Number(est.quota) || 0;
        return {
            usage,
            quota,
            usageRatio: quota > 0 ? usage / quota : 0,
        };
    } catch {
        return null;
    }
}

export async function requestPersistentStorage(): Promise<boolean> {
    try {
        const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
        if (!nav?.storage?.persist) return false;
        const persisted = await nav.storage.persisted();
        if (persisted) return true;
        return Boolean(await nav.storage.persist());
    } catch {
        return false;
    }
}
