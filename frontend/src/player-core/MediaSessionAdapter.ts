import type { TrackLike } from '../playback/types';

export type MediaSessionCallbacks = {
    onPlay: () => void;
    onPause: () => void;
    onNext: () => void;
    onPrev: () => void;
    onSeekTo: (seconds: number) => void;
    onStop: () => void;
    getCoverUrl?: (track: TrackLike) => string;
};

type PositionSnapshot = {
    duration: number;
    position: number;
    playbackRate: number;
};

function safeNum(value: unknown, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function hasMediaSession(): boolean {
    return navigator !== undefined && 'mediaSession' in navigator;
}

function hasMediaMetadata(): boolean {
    return globalThis.window !== undefined && 'MediaMetadata' in globalThis.window;
}

function trackField(track: TrackLike, key: string): string {
    const v = (track as Record<string, unknown>)[key];
    if (v == null) return '';
    if (typeof v === 'object') return '';
    return String(v);
}

export class MediaSessionAdapter {
    private callbacks: MediaSessionCallbacks | null = null;
    private lastMetadataKey = '';
    private lastPositionUpdateMs = 0;
    private lastPosition: PositionSnapshot = { duration: 0, position: -1, playbackRate: 1 };
    private metadataSeq = 0;
    private lastSkipMs = 0;
    private positionInterval = 0;
    private bound = false;

    bind(callbacks: MediaSessionCallbacks): void {
        this.callbacks = callbacks;
        this.rebindHandlers();
    }

    unbind(): void {
        this.callbacks = null;
        if (this.positionInterval) {
            clearInterval(this.positionInterval);
            this.positionInterval = 0;
        }
        this.clearHandlers();
        this.bound = false;
    }

    updateMetadata(track: TrackLike | null, queueName: string): void {
        if (!track || !hasMediaSession() || !hasMediaMetadata()) return;

        const baseKey = `${trackField(track, 'id')}|${trackField(track, 'updated_at')}|${queueName}`;
        if (this.lastMetadataKey === baseKey) return;

        this.metadataSeq++;
        const seq = this.metadataSeq;
        this.lastMetadataKey = baseKey;

        try {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: trackField(track, 'title') || 'Unknown Title',
                artist: trackField(track, 'artist') || 'Unknown Artist',
                album: queueName || '',
                artwork: [],
            });
        } catch { }

        void this.loadArtwork(track, queueName, seq);
    }

    updatePosition(position: number, duration: number, playbackRate: number): void {
        if (!hasMediaSession()) return;
        if (typeof navigator.mediaSession.setPositionState !== 'function') return;

        const now = Date.now();
        if (now - this.lastPositionUpdateMs < 900) return;

        const pos = safeNum(position, -1);
        const dur = safeNum(duration, 0);
        const rate = safeNum(playbackRate, 1);
        if (pos < 0 || dur <= 0) return;

        const last = this.lastPosition;
        const changed =
            Math.abs(last.position - pos) > 0.25 ||
            Math.abs(last.duration - dur) > 0.5 ||
            Math.abs(last.playbackRate - rate) > 0.01;
        if (!changed) return;

        const snap: PositionSnapshot = {
            duration: dur,
            position: Math.min(pos, dur),
            playbackRate: rate > 0 ? rate : 1,
        };

        try {
            navigator.mediaSession.setPositionState(snap);
            this.lastPositionUpdateMs = now;
            this.lastPosition = snap;
        } catch { }
    }

    setPlaybackState(state: 'playing' | 'paused' | 'none'): void {
        if (!hasMediaSession()) return;
        try { navigator.mediaSession.playbackState = state; } catch { }
    }

    startPositionPolling(getPosition: () => PositionSnapshot | null): void {
        if (this.positionInterval) clearInterval(this.positionInterval);
        this.positionInterval = globalThis.window?.setInterval(() => {
            const snap = getPosition();
            if (snap) this.updatePosition(snap.position, snap.duration, snap.playbackRate);
        }, 1000) ?? 0;
    }

    stopPositionPolling(): void {
        if (this.positionInterval) {
            clearInterval(this.positionInterval);
            this.positionInterval = 0;
        }
    }

    private rebindHandlers(): void {
        if (!hasMediaSession()) return;
        const cb = this.callbacks;
        if (!cb) return;

        const ms = navigator.mediaSession;

        const throttledSkip = (fn: () => void) => () => {
            const now = Date.now();
            if (now - this.lastSkipMs < 350) return;
            this.lastSkipMs = now;
            fn();
        };

        const handlers: Array<[MediaSessionAction, MediaSessionActionHandler | null]> = [
            ['play', () => cb.onPlay()],
            ['pause', () => cb.onPause()],
            ['nexttrack', throttledSkip(() => cb.onNext())],
            ['previoustrack', throttledSkip(() => cb.onPrev())],
            ['seekto', (details) => {
                const t = safeNum(details?.seekTime, Number.NaN);
                if (Number.isFinite(t)) cb.onSeekTo(Math.max(0, t));
            }],
            ['seekforward', (details) => {
                const off = safeNum(details?.seekOffset, 15);
                const pos = this.lastPosition.position;
                cb.onSeekTo(pos + off);
            }],
            ['seekbackward', (details) => {
                const off = safeNum(details?.seekOffset, 15);
                const pos = this.lastPosition.position;
                cb.onSeekTo(Math.max(0, pos - off));
            }],
            ['stop', () => cb.onStop()],
        ];

        for (const [action, handler] of handlers) {
            try { ms.setActionHandler(action, handler); } catch { }
        }

        this.bound = true;
    }

    private clearHandlers(): void {
        if (!hasMediaSession()) return;
        const ms = navigator.mediaSession;
        const actions: MediaSessionAction[] = ['play', 'pause', 'nexttrack', 'previoustrack', 'seekto', 'seekforward', 'seekbackward', 'stop'];
        for (const action of actions) {
            try { ms.setActionHandler(action, null); } catch { }
        }
    }

    private async loadArtwork(track: TrackLike, queueName: string, seq: number): Promise<void> {
        if (!this.callbacks?.getCoverUrl) return;
        const coverUrl = this.callbacks.getCoverUrl(track);
        if (!coverUrl || seq !== this.metadataSeq) return;
        if (!hasMediaSession() || !hasMediaMetadata()) return;

        const key = `${trackField(track, 'id')}|${queueName}|${coverUrl}`;
        if (this.lastMetadataKey === key) return;

        const mime = inferArtworkMime(coverUrl);

        try {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: trackField(track, 'title') || 'Unknown Title',
                artist: trackField(track, 'artist') || 'Unknown Artist',
                album: queueName || '',
                artwork: [
                    { src: coverUrl, sizes: '96x96', type: mime },
                    { src: coverUrl, sizes: '128x128', type: mime },
                    { src: coverUrl, sizes: '192x192', type: mime },
                    { src: coverUrl, sizes: '256x256', type: mime },
                    { src: coverUrl, sizes: '384x384', type: mime },
                    { src: coverUrl, sizes: '512x512', type: mime },
                ],
            });
            this.lastMetadataKey = key;
        } catch { }
    }
}

function inferArtworkMime(url: string): string {
    const lower = String(url || '').toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.svg')) return 'image/svg+xml';
    if (lower.endsWith('.gif')) return 'image/gif';
    return 'image/jpeg';
}
