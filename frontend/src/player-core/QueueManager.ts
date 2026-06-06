import type { TrackLike } from '../playback/types';
import type { PlayerStore } from './PlayerStore';
import type { QueueSource, CustomQueueMeta } from './types';

type SourcePosition = { trackId: string; index: number };

function toTrackId(track: TrackLike | null | undefined): string {
    if (track?.id != null) return String(track.id);
    return '';
}

function clampIndex(index: number, length: number): number {
    if (length <= 0) return 0;
    return Math.max(0, Math.min(Math.floor(index), length - 1));
}

function findTrackIndex(tracks: readonly TrackLike[], trackId: string): number {
    if (!trackId) return -1;
    return tracks.findIndex((t) => toTrackId(t) === trackId);
}

function generateShuffleOrder(length: number, currentIdx: number): number[] {
    const indices = Array.from({ length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    if (currentIdx >= 0 && currentIdx < length) {
        const pos = indices.indexOf(currentIdx);
        if (pos !== 0) {
            [indices[0], indices[pos]] = [indices[pos], indices[0]];
        }
    }
    return indices;
}

export type QueueManagerDeps = {
    store: PlayerStore;
    setCurrentTrackIndex: (_index: number) => void;
    setQueueSource: (_source: QueueSource) => void;
    setQueueName: (_name: string) => void;
    setCustomQueue: (_tracks: readonly TrackLike[]) => void;
    setCustomQueueMeta: (_meta: CustomQueueMeta) => void;
    syncQueueSnapshot?: (_tracks: readonly TrackLike[]) => void;
    setShuffleEnabled: (_enabled: boolean) => void;
    setShuffleOrder: (_order: number[]) => void;
    setIsPlaying: (_playing: boolean) => void;
};

export class QueueManager {
    private deps: QueueManagerDeps;

    private libTracks: readonly TrackLike[] = [];
    private recoTracks: readonly TrackLike[] = [];
    private _likedTracks: readonly TrackLike[] = [];
    private customTracks: readonly TrackLike[] = [];
    private snapshotTracks: readonly TrackLike[] = [];

    private readonly lastPositionBySource = new Map<string, SourcePosition>();
    private readonly _listeners = new Set<() => void>();
    private _version = 0;

    constructor(deps: QueueManagerDeps) {
        this.deps = deps;
    }

    setDeps(deps: QueueManagerDeps): void {
        this.deps = deps;
    }

    setLibraryTracks(tracks: readonly TrackLike[]): void {
        this.libTracks = tracks;
        this.recompute();
    }

    setRecommendationTracks(tracks: readonly TrackLike[]): void {
        this.recoTracks = tracks;
        this.recompute();
    }

    setLikedTracks(tracks: readonly TrackLike[]): void {
        this._likedTracks = tracks;
        this.recompute();
    }

    setCustomTracks(tracks: readonly TrackLike[]): void {
        this.customTracks = tracks;
        this.recompute();
    }

    setSnapshotTracks(tracks: readonly TrackLike[]): void {
        this.snapshotTracks = tracks;
        this.recompute();
    }

    get libraryTracks(): readonly TrackLike[] {
        return this.libTracks;
    }

    get recommendationTracks(): readonly TrackLike[] {
        return this.recoTracks;
    }

    get likedQueueTracks(): readonly TrackLike[] {
        return this._likedTracks;
    }

    get effectiveTracks(): readonly TrackLike[] {
        const source = this.deps.store.get('queueSource');
        const candidates = this.getCandidateTracks(source);
        const snap = this.snapshotTracks;
        if (snap.length > 0) return snap;
        return candidates;
    }

    get currentTrack(): TrackLike | null {
        const tracks = this.effectiveTracks;
        const idx = this.deps.store.get('currentTrackIndex');
        return tracks[idx] ?? null;
    }

    get version(): number {
        return this._version;
    }

    subscribe(fn: () => void): () => void {
        this._listeners.add(fn);
        return () => { this._listeners.delete(fn); };
    }

    recordPosition(): void {
        const source = this.deps.store.get('queueSource');
        const idx = this.deps.store.get('currentTrackIndex');
        const track = this.currentTrack;
        const trackId = toTrackId(track);
        if (!source || !trackId) return;
        this.lastPositionBySource.set(source, { trackId, index: idx });
    }

    toggleShuffle(): void {
        const current = this.deps.store.get('shuffleEnabled');
        const next = !current;
        if (next && this.effectiveTracks.length > 0) {
            const idx = this.deps.store.get('currentTrackIndex');
            this.deps.setShuffleOrder(generateShuffleOrder(this.effectiveTracks.length, idx));
        } else {
            this.deps.setShuffleOrder([]);
        }
        this.deps.setShuffleEnabled(next);
    }

    switchToRecommendations(freshRecoTracks?: readonly TrackLike[], options?: { startFresh?: boolean }): void {
        const previousTrackId = toTrackId(this.currentTrack);
        const previousSource = this.deps.store.get('queueSource');
        const targetTracks = freshRecoTracks ?? this.recoTracks;

        this.deps.setQueueSource('auto');
        if (targetTracks.length === 0) return;
        this.deps.setQueueName('Recommendations');
        this.deps.setCustomQueue([]);
        this.deps.setCustomQueueMeta(null);

        if (typeof this.deps.syncQueueSnapshot === 'function') {
            this.deps.syncQueueSnapshot(targetTracks);
        }

        if (options?.startFresh === true && previousSource !== 'auto') {
            const firstDifferent = targetTracks.findIndex((t) => toTrackId(t) !== previousTrackId);
            this.deps.setCurrentTrackIndex(firstDifferent >= 0 ? firstDifferent : 0);
            return;
        }

        this.resolvePosition('auto', targetTracks);
    }

    switchToLibrary(): void {
        this.deps.setQueueSource('library');
        this.deps.setQueueName('My Tracks');
        this.deps.setCustomQueue([]);
        this.deps.setCustomQueueMeta(null);

        const currentSource = this.deps.store.get('queueSource');
        if (currentSource === 'library') return;

        this.resolvePosition('library', this.libTracks);
    }

    switchToLiked(): void {
        this.deps.setQueueSource('liked');
        this.deps.setQueueName('Liked');
        this.deps.setCustomQueue([]);
        this.deps.setCustomQueueMeta(null);

        const currentSource = this.deps.store.get('queueSource');
        if (currentSource === 'liked') return;

        this.resolvePosition('liked', this._likedTracks);
    }

    playPlaylist(tracks: readonly TrackLike[], name: string, meta?: { playlistId?: string } | null): void {
        if (!tracks.length) return;
        this.deps.setCustomQueue(tracks);
        const playlistId = meta?.playlistId ? String(meta.playlistId) : null;
        this.deps.setCustomQueueMeta(playlistId ? { type: 'playlist', playlistId } : null);
        this.deps.setQueueSource('custom');
        this.deps.setQueueName(name || 'Playlist');
        this.deps.setCurrentTrackIndex(0);
        this.deps.setIsPlaying(true);
    }

    syncSnapshot(candidateTracks: readonly TrackLike[]): void {
        if (typeof this.deps.syncQueueSnapshot !== 'function') return;
        const hasNext = candidateTracks.length > 0;
        const hasExisting = this.snapshotTracks.length > 0;
        if (!hasNext && hasExisting) return;
        this.deps.syncQueueSnapshot(candidateTracks);
    }

    private getCandidateTracks(source: QueueSource): readonly TrackLike[] {
        switch (source) {
            case 'auto':
                return this.recoTracks;
            case 'library':
                return this.libTracks;
            case 'liked':
                return this._likedTracks;
            case 'custom':
                return this.customTracks.length > 0 ? this.customTracks : this.libTracks;
            default:
                return this.libTracks;
        }
    }

    private resolvePosition(targetSource: QueueSource, targetTracks: readonly TrackLike[]): void {
        if (targetTracks.length === 0) return;

        const currentTrack = this.currentTrack;
        const currentId = toTrackId(currentTrack);
        if (currentId) {
            const idx = findTrackIndex(targetTracks, currentId);
            if (idx >= 0) {
                this.deps.setCurrentTrackIndex(idx);
                return;
            }
        }

        const remembered = this.lastPositionBySource.get(targetSource);
        if (remembered) {
            const idx = findTrackIndex(targetTracks, remembered.trackId);
            if (idx >= 0) {
                this.deps.setCurrentTrackIndex(idx);
                return;
            }
            if (Number.isFinite(remembered.index)) {
                this.deps.setCurrentTrackIndex(clampIndex(remembered.index, targetTracks.length));
                return;
            }
        }

        const lastTrackId = this.readLastTrackId();
        if (lastTrackId) {
            const idx = findTrackIndex(targetTracks, lastTrackId);
            if (idx >= 0) {
                this.deps.setCurrentTrackIndex(idx);
                return;
            }
        }

        const currentIdx = this.deps.store.get('currentTrackIndex');
        this.deps.setCurrentTrackIndex(clampIndex(currentIdx, targetTracks.length));
    }

    private readLastTrackId(): string {
        try {
            if (typeof localStorage === 'undefined') return '';
            const raw = localStorage.getItem('lastTrackId');
            return raw ? String(raw) : '';
        } catch {
            return '';
        }
    }

    private recompute(): void {
        this._version++;
        for (const fn of this._listeners) {
            try { fn(); } catch { }
        }
    }
}
