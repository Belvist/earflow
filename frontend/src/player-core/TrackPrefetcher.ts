import type { TrackLike } from '../playback/types';

export interface TrackPrefetcherDeps {
    getCoverUrl: (_track: TrackLike) => string;
    requestLyrics: (_songId: string) => void;
}

export class TrackPrefetcher {
    private deps: TrackPrefetcherDeps;
    private lastPrefetchedId = '';
    private imageHandle: HTMLImageElement | null = null;

    constructor(deps: TrackPrefetcherDeps) {
        this.deps = deps;
    }

    setDeps(deps: TrackPrefetcherDeps): void {
        this.deps = deps;
    }

    update(tracks: ReadonlyArray<TrackLike>, currentIndex: number): void {
        const nextIndex = currentIndex + 1;
        if (nextIndex >= tracks.length) return;

        const next = tracks[nextIndex];
        if (!next) return;

        const id = String(next.id ?? '').trim();
        if (!id || id === this.lastPrefetchedId) return;

        this.lastPrefetchedId = id;
        this.prefetchCoverArt(next);
        this.prefetchLyrics(id);
    }

    reset(): void {
        this.lastPrefetchedId = '';
        this.imageHandle = null;
    }

    private prefetchCoverArt(track: TrackLike): void {
        try {
            const url = this.deps.getCoverUrl(track);
            if (!url || typeof url !== 'string') return;
            const img = new Image();
            img.src = url;
            this.imageHandle = img;
        } catch {
        }
    }

    private prefetchLyrics(songId: string): void {
        try {
            this.deps.requestLyrics(songId);
        } catch {
        }
    }
}
