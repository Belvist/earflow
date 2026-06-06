import { loadImageForCanvas } from './imageLoader';

export type RgbColor = { r: number; g: number; b: number };

const CACHE_MAX = 64;
const cache = new Map<string, RgbColor | null>();
const inflight = new Map<string, Promise<RgbColor | null>>();

/**
 * Extract the dominant (most frequent) saturated color from an image URL.
 *
 * The returned color is the average of the most populated color bucket in
 * a 48x48 downscale of the image, excluding near-black, near-white, and
 * near-grayscale pixels that rarely represent a cover's "identity".
 *
 * Returns `null` on any failure (network, CORS, decode, tainted canvas).
 * Results are memoized per URL.
 */
export async function extractDominantColor(url: string): Promise<RgbColor | null> {
    if (!url) return null;
    if (cache.has(url)) return cache.get(url) ?? null;

    const pending = inflight.get(url);
    if (pending) return pending;

    const task = (async () => {
        try {
            const loaded = await loadImageForCanvas(url);
            if (!loaded) {
                setCache(url, null);
                return null;
            }
            try {
                const color = computeDominantColor(loaded.image);
                setCache(url, color);
                return color;
            } finally {
                loaded.revoke();
            }
        } catch {
            setCache(url, null);
            return null;
        } finally {
            inflight.delete(url);
        }
    })();

    inflight.set(url, task);
    return task;
}

/**
 * Darken a color by `factor` (0..1) and return it as an `rgba(...)` string
 * with the given alpha. Returns null if color is null.
 */
export function toDarkenedRgba(color: RgbColor | null, factor = 0.5, alpha = 1): string | null {
    if (!color) return null;
    const f = clamp01(factor);
    const a = clamp01(alpha);
    const r = Math.round(clampByte(color.r) * f);
    const g = Math.round(clampByte(color.g) * f);
    const b = Math.round(clampByte(color.b) * f);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Full-strength accent (e.g. left stripe on player bars). */
export function toRgba(color: RgbColor | null, alpha = 1): string | null {
    if (!color) return null;
    const a = clamp01(alpha);
    return `rgba(${clampByte(color.r)}, ${clampByte(color.g)}, ${clampByte(color.b)}, ${a})`;
}

function computeDominantColor(img: HTMLImageElement): RgbColor | null {
    const size = 48;
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    try {
        ctx.drawImage(img, 0, 0, size, size);
    } catch {
        return null;
    }

    let data: Uint8ClampedArray;
    try {
        data = ctx.getImageData(0, 0, size, size).data;
    } catch {
        return null;
    }

    const buckets = new Map<number, BucketEntry>();
    let best: BucketEntry | null = null;

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (a < 128) continue;

        const sum = r + g + b;
        if (sum < 45) continue;
        if (sum > 720) continue;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max - min < 18) continue;

        const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
        let entry = buckets.get(key);
        if (!entry) {
            entry = { r: 0, g: 0, b: 0, count: 0 };
            buckets.set(key, entry);
        }
        entry.r += r;
        entry.g += g;
        entry.b += b;
        entry.count += 1;

        if (!best || entry.count > best.count) best = entry;
    }

    if (!best || best.count === 0) return fallbackAverage(data);

    return {
        r: Math.round(best.r / best.count),
        g: Math.round(best.g / best.count),
        b: Math.round(best.b / best.count),
    };
}

function fallbackAverage(data: Uint8ClampedArray): RgbColor | null {
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];
        if (alpha < 128) continue;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        count += 1;
    }
    if (count === 0) return null;
    return {
        r: Math.round(r / count),
        g: Math.round(g / count),
        b: Math.round(b / count),
    };
}

function setCache(key: string, value: RgbColor | null): void {
    if (cache.size >= CACHE_MAX) {
        const firstKey = cache.keys().next().value;
        if (firstKey !== undefined) cache.delete(firstKey);
    }
    cache.set(key, value);
}

function clamp01(v: number): number {
    if (!Number.isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
}

function clampByte(v: number): number {
    if (!Number.isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 255) return 255;
    return v;
}

type BucketEntry = { r: number; g: number; b: number; count: number };
