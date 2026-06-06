import type { QualityOption } from './types';
import type { BandwidthEstimator } from './BandwidthEstimator';

export type QualityPreference = 'auto' | 'low' | 'medium' | 'high' | 'lossless';

const BITRATE_HEADROOM_FACTOR = 1.3;

const PREFERENCE_MAX_BITRATE: Record<string, number> = {
    low: 160_000,
    medium: 260_000,
    high: 400_000,
    lossless: Infinity,
};

function codecPriority(codec: string | undefined): number {
    const c = String(codec || '').toLowerCase();
    if (c === 'opus') return 3;
    if (c === 'aac') return 2;
    if (c === 'flac') return 1;
    return 0;
}

function isCodecSupported(mime: string): boolean {
    if (typeof MediaSource !== 'undefined' && typeof MediaSource.isTypeSupported === 'function') {
        try {
            if (MediaSource.isTypeSupported(mime)) return true;
        } catch {
        }
    }

    if (typeof document !== 'undefined') {
        try {
            const audio = document.createElement('audio');
            const result = audio.canPlayType(mime);
            return result === 'probably' || result === 'maybe';
        } catch {
        }
    }

    return false;
}

let codecCache: Map<string, boolean> | null = null;

function canPlayMime(mime: string): boolean {
    codecCache ??= new Map();
    const cached = codecCache.get(mime);
    if (cached !== undefined) return cached;

    const supported = isCodecSupported(mime);
    codecCache.set(mime, supported);
    return supported;
}

function filterPlayable(qualities: QualityOption[]): QualityOption[] {
    return qualities.filter((q) => {
        if (!q.mime) return true;
        return canPlayMime(q.mime);
    });
}

function filterByPreference(qualities: QualityOption[], preference: QualityPreference): QualityOption[] {
    if (preference === 'auto' || preference === 'lossless') return qualities;
    const maxBitrate = PREFERENCE_MAX_BITRATE[preference] ?? Infinity;
    const filtered = qualities.filter((q) => q.bitrate <= maxBitrate);
    return filtered.length > 0 ? filtered : qualities;
}

function filterByBandwidth(qualities: QualityOption[], estimator: BandwidthEstimator | null): QualityOption[] {
    if (!estimator?.isConfident()) return qualities;

    const bwBps = estimator.getEstimateBps();
    if (bwBps === null || bwBps <= 0) return qualities;

    const maxBitrate = bwBps / BITRATE_HEADROOM_FACTOR;
    const affordable = qualities.filter((q) => q.bitrate <= maxBitrate);
    return affordable.length > 0 ? affordable : [selectLowest(qualities)];
}

function selectLowest(qualities: QualityOption[]): QualityOption {
    let best = qualities[0];
    for (let i = 1; i < qualities.length; i++) {
        if (qualities[i].bitrate < best.bitrate) {
            best = qualities[i];
        }
    }
    return best;
}

function selectHighest(candidates: QualityOption[]): QualityOption {
    let best = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
        const q = candidates[i];
        const dominated = q.bitrate > best.bitrate
            || (q.bitrate === best.bitrate && codecPriority(q.codec) > codecPriority(best.codec));
        if (dominated) {
            best = q;
        }
    }
    return best;
}

export function selectQuality(
    qualities: QualityOption[] | null | undefined,
    preference: QualityPreference,
    estimator: BandwidthEstimator | null,
): QualityOption | null {
    if (!qualities || qualities.length === 0) return null;

    const nonSource = qualities.filter((q) => q.tag !== 'source');
    if (nonSource.length === 0) return null;

    const playable = filterPlayable(nonSource);
    if (playable.length === 0) return null;

    if (preference === 'lossless') {
        const lossless = playable.filter((q) => {
            const c = String(q.codec || '').toLowerCase();
            return c === 'flac';
        });
        if (lossless.length > 0) return selectHighest(lossless);
        return selectHighest(playable);
    }

    const prefFiltered = filterByPreference(playable, preference);

    if (preference !== 'auto') {
        return selectHighest(prefFiltered);
    }

    const bwFiltered = filterByBandwidth(prefFiltered, estimator);
    return selectHighest(bwFiltered);
}

export function resetCodecCache(): void {
    codecCache = null;
}
