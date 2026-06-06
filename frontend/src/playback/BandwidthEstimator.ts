const DEFAULT_EWMA_HALF_LIFE_MS = 8000;
const MIN_SAMPLE_BYTES = 4096;
const MAX_SAMPLES = 64;
const STALE_THRESHOLD_MS = 120_000;

type Sample = {
    bytes: number;
    durationMs: number;
    atMs: number;
};

export class BandwidthEstimator {
    private readonly halfLifeMs: number;
    private samples: Sample[] = [];
    private ewmaBps: number | null = null;
    private lastSampleAtMs = 0;

    constructor(halfLifeMs = DEFAULT_EWMA_HALF_LIFE_MS) {
        this.halfLifeMs = Math.max(1000, halfLifeMs);
    }

    addSample(bytes: number, durationMs: number): void {
        if (bytes < MIN_SAMPLE_BYTES || durationMs <= 0) return;

        const bps = (bytes * 8) / (durationMs / 1000);
        if (!Number.isFinite(bps) || bps <= 0) return;

        const now = Date.now();
        this.lastSampleAtMs = now;

        this.samples.push({ bytes, durationMs, atMs: now });
        if (this.samples.length > MAX_SAMPLES) {
            this.samples = this.samples.slice(-MAX_SAMPLES);
        }

        const alpha = 1 - Math.exp(-durationMs / this.halfLifeMs);
        const clampedAlpha = Math.max(0.05, Math.min(0.5, alpha));

        if (this.ewmaBps === null) {
            this.ewmaBps = bps;
        } else {
            this.ewmaBps = clampedAlpha * bps + (1 - clampedAlpha) * this.ewmaBps;
        }
    }

    getEstimateBps(): number | null {
        if (this.ewmaBps === null) return null;
        if (Date.now() - this.lastSampleAtMs > STALE_THRESHOLD_MS) return null;
        return this.ewmaBps;
    }

    getEstimateKbps(): number | null {
        const bps = this.getEstimateBps();
        return bps !== null ? bps / 1000 : null;
    }

    getSampleCount(): number {
        return this.samples.length;
    }

    isConfident(): boolean {
        return this.samples.length >= 3 && this.ewmaBps !== null;
    }

    reset(): void {
        this.samples = [];
        this.ewmaBps = null;
        this.lastSampleAtMs = 0;
    }
}

let sharedInstance: BandwidthEstimator | null = null;

export function getSharedBandwidthEstimator(): BandwidthEstimator {
    if (!sharedInstance) {
        sharedInstance = new BandwidthEstimator();
    }
    return sharedInstance;
}
