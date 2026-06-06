import type { TrackLike } from '../playback/types';
import { isIosSafari } from '../utils/platform';
import { buildReturnToFromCurrentLocation, redirectToAuth } from '../utils/authRedirect';

import { AbortError, SerialCommandQueue, isAbortError } from './SerialCommandQueue';
import { PlayerFSM } from './PlayerFSM';
import type { PlayerCoreDeps } from './types';

function clampIndex(index: number, length: number): number {
    const len = Number(length);
    if (!Number.isFinite(len) || len <= 0) return 0;
    const idx = Number(index);
    const base = Number.isFinite(idx) ? Math.floor(idx) : 0;
    return Math.max(0, Math.min(len - 1, base));
}

function toStableId(value: unknown): string {
    if (typeof value === 'string') {
        const s = value.trim();
        return s || '';
    }
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'bigint') return String(value);
    return '';
}

function isBackground(): boolean {
    try {
        if (typeof document === 'undefined') return false;
        if (document.visibilityState !== 'visible') return true;
        if (isIosSafari() && typeof document.hasFocus === 'function' && !document.hasFocus()) return true;
        return false;
    } catch {
        return false;
    }
}

function delayMs(ms: number, signal: AbortSignal): Promise<void> {
    const dur = Number(ms);
    if (!Number.isFinite(dur) || dur <= 0) return Promise.resolve();
    if (typeof window === 'undefined') return Promise.resolve();
    if (signal.aborted) return Promise.reject(new AbortError());
    try {
        if (typeof document !== 'undefined' && document.hidden === true) return Promise.resolve();
    } catch {
    }

    return new Promise<void>((resolve, reject) => {
        const id = window.setTimeout(() => {
            cleanup();
            resolve();
        }, Math.floor(dur));

        const onAbort = () => {
            cleanup();
            reject(new AbortError());
        };

        const cleanup = () => {
            window.clearTimeout(id);
            signal.removeEventListener('abort', onAbort);
        };

        signal.addEventListener('abort', onAbort, { passive: true });
    });
}

export class PlayerCore {
    private deps: PlayerCoreDeps;
    private readonly queue = new SerialCommandQueue();
    private readonly seekQueue = new SerialCommandQueue();
    readonly fsm = new PlayerFSM();

    private lastHandledEnded: { trackId: string; atMs: number } = { trackId: '', atMs: 0 };

    constructor(deps: PlayerCoreDeps) {
        this.deps = deps;
    }

    setDeps(deps: PlayerCoreDeps): void {
        this.deps = deps;
    }

    abort(): void {
        this.queue.abort();
        this.seekQueue.abort();
    }

    notifySeekComplete(): void {
        const wasSeekingInStore = this.deps.store?.getSnapshot().isSeeking;
        this.fsm.exitSeeking();
        if (wasSeekingInStore) {
            this.deps.store?.patch({ isSeeking: false, fsmState: this.fsm.current });
        }
        this.deps.intent.setSeeking?.(false);
    }

    private requireAuth(reason: string): boolean {
        if (this.deps.auth.isAuthenticated()) return true;
        redirectToAuth({
            reason: String(reason || 'auth_required').slice(0, 64),
            returnTo: buildReturnToFromCurrentLocation(),
            replace: true,
        });
        return false;
    }

    private maybeActivateAudio(requiresGesture: boolean): void {
        try {
            this.deps.audio.ensureAudioContext(requiresGesture);
        } catch {
        }
        try {
            this.deps.audio.rebuildGraph();
        } catch {
        }
    }

    private applyCustomQueue(tracks: ReadonlyArray<TrackLike>, queueName: string, startIndex: number): TrackLike | null {
        try {
            this.deps.queueControl.setCustomQueue(tracks);
            this.deps.queueControl.setCustomQueueMeta(null);
            this.deps.queueControl.setQueueSource('custom');
            this.deps.queueControl.setQueueName(queueName);
            this.deps.queueControl.syncQueueSnapshot?.(tracks);
            this.deps.queue.setIndex(startIndex);
        } catch {
            return null;
        }
        return tracks[startIndex] || null;
    }

    private getCurrentTrack(): TrackLike | null {
        const tracks = this.deps.queue.getTracks();
        if (!Array.isArray(tracks) || tracks.length === 0) return null;
        const idx = clampIndex(this.deps.queue.getIndex(), tracks.length);
        return tracks[idx] || null;
    }

    private computeNextIndex(dir: 1 | -1): { nextIndex: number; shouldStopAtEnd: boolean } {
        const tracks = this.deps.queue.getTracks();
        const len = Array.isArray(tracks) ? tracks.length : 0;
        if (len <= 0) return { nextIndex: 0, shouldStopAtEnd: true };

        const repeatMode = this.deps.queue.getRepeatMode();
        const current = clampIndex(this.deps.queue.getIndex(), len);

        if (dir === 1) {
            const isLast = current >= len - 1;
            if (isLast && repeatMode !== 'all') {
                return { nextIndex: current, shouldStopAtEnd: true };
            }
            return { nextIndex: isLast ? 0 : current + 1, shouldStopAtEnd: false };
        }

        const isFirst = current <= 0;
        if (isFirst) {
            return { nextIndex: repeatMode === 'all' ? len - 1 : 0, shouldStopAtEnd: false };
        }
        return { nextIndex: current - 1, shouldStopAtEnd: false };
    }

    private buildUniqueTracks(input: ReadonlyArray<TrackLike>): TrackLike[] {
        const unique: TrackLike[] = [];
        const seen = new Set<string>();
        for (const t of input) {
            const id = toStableId(t?.id);
            if (!id) continue;
            if (seen.has(id)) continue;
            seen.add(id);
            unique.push(t);
        }
        return unique;
    }

    private firePrefetchNextTracks(): void {
        const fn = this.deps.prefetchSessionsFor;
        if (!fn) return;
        const tracks = this.deps.queue.getTracks();
        if (!Array.isArray(tracks) || tracks.length === 0) return;
        const currentIdx = clampIndex(this.deps.queue.getIndex(), tracks.length);
        const ids: number[] = [];
        for (let i = 1; i <= 5; i++) {
            const idx = currentIdx + i;
            if (idx >= tracks.length) break;
            const track = tracks[idx];
            const numId = Number(track?.id);
            if (Number.isFinite(numId) && numId > 0) ids.push(numId);
        }
        if (ids.length > 0) {
            try { fn(ids); } catch { }
        }
    }

    private async startPlaybackForTrack(track: TrackLike, signal: AbortSignal): Promise<void> {
        await this.playTrackWithRetry(track, signal, { requiresGesture: true, fadeInMs: 80 });
    }

    private async playTrackWithRetry(
        track: TrackLike,
        signal: AbortSignal,
        opts: { requiresGesture: boolean; fadeInMs: number }
    ): Promise<void> {
        if (signal.aborted) throw new AbortError();

        this.deps.intent.setWanted(true);
        this.fsm.transition('LOADING');
        this.deps.store?.patch({ isPlaying: true, isBuffering: true, fsmState: this.fsm.current });
        this.deps.audio.applyMetadataEager?.(track);
        this.maybeActivateAudio(opts.requiresGesture);
        if (!isBackground()) this.deps.audio.primeFadeFromSilence?.();

        try {
            await this.deps.playback.play(track);
            this.deps.audio.fadeIn?.(opts.fadeInMs);
            this.fsm.transition('PLAYING');
            this.deps.store?.patch({ isBuffering: false, fsmState: this.fsm.current });
            setTimeout(() => this.firePrefetchNextTracks(), 0);
            return;
        } catch (e) {
            if (isAbortError(e)) {
                this.deps.store?.patch({ isBuffering: false });
                throw e;
            }
        }

        if (isIosSafari() && typeof this.deps.playback.hardReset === 'function') {
            await this.deps.playback.hardReset('play_failed').catch(() => undefined);
            if (signal.aborted) {
                this.deps.store?.patch({ isBuffering: false });
                throw new AbortError();
            }
            this.maybeActivateAudio(false);
        }

        await delayMs(250, signal).catch(() => undefined);
        if (signal.aborted) {
            this.deps.store?.patch({ isBuffering: false });
            throw new AbortError();
        }

        try {
            await this.deps.playback.play(track);
            this.deps.audio.fadeIn?.(opts.fadeInMs);
            this.fsm.transition('PLAYING');
            this.deps.store?.patch({ isBuffering: false, fsmState: this.fsm.current });
            setTimeout(() => this.firePrefetchNextTracks(), 0);
        } catch (e) {
            this.deps.store?.patch({ isBuffering: false });
            if (!isAbortError(e)) {
                this.deps.intent.setWanted(false);
                this.fsm.transition('ERROR');
                this.deps.store?.patch({ isPlaying: false, fsmState: this.fsm.current });
            }
            this.deps.audio.fadeIn?.(0);
        }
    }

    private async playTrackAtIndex(tracks: ReadonlyArray<TrackLike>, targetIndex: number, signal: AbortSignal): Promise<boolean> {
        if (!Array.isArray(tracks) || tracks.length === 0) return false;

        const current = clampIndex(this.deps.queue.getIndex(), tracks.length);
        const clampedTarget = clampIndex(targetIndex, tracks.length);

        if (clampedTarget === current) {
            const wanted = this.deps.intent.getWanted();
            if (wanted) {
                await this.pauseInternal(signal);
            } else {
                await this.playInternal(true, signal);
            }
            return true;
        }

        this.deps.audio.setSwitchingUntil?.(Date.now() + 6_000);
        this.deps.audio.fadeOut?.(60);
        await delayMs(60, signal).catch(() => undefined);
        if (signal.aborted) throw new AbortError();

        const nextTrack = tracks[clampedTarget];
        if (!nextTrack) return false;

        this.deps.queue.setIndex(clampedTarget);
        this.deps.store?.patch({ currentTrackIndex: clampedTarget });
        this.deps.intent.setWanted(true);

        await this.playTrackWithRetry(nextTrack, signal, { requiresGesture: true, fadeInMs: 80 });

        return true;
    }

    private async restartCurrentTrack(signal: AbortSignal): Promise<void> {
        const track = this.getCurrentTrack();
        if (!track) {
            this.deps.intent.setWanted(false);
            return;
        }

        if (signal.aborted) throw new AbortError();

        this.deps.intent.setWanted(true);
        const bg = isBackground();
        if (!bg) {
            this.maybeActivateAudio(false);
            this.deps.audio.primeFadeFromSilence?.();
        }

        try {
            await this.deps.playback.seek(0);
            if (signal.aborted) throw new AbortError();
            await this.deps.playback.resume();
            this.fsm.transition('PLAYING');
            this.deps.store?.patch({ isPlaying: true, isBuffering: false, fsmState: this.fsm.current });
            if (!bg) this.deps.audio.fadeIn?.(80);
            return;
        } catch (e) {
            if (isAbortError(e)) throw e;
        }

        if (signal.aborted) throw new AbortError();

        await this.playTrackWithRetry(track, signal, {
            requiresGesture: false,
            fadeInMs: bg ? 0 : 80,
        });
    }

    private async tryExtendQueue(signal: AbortSignal): Promise<TrackLike | null> {
        if (signal.aborted) return null;
        const fn = this.deps.onQueueExhausted;
        if (!fn) return null;
        try {
            const result = await fn();
            if (!result || !Array.isArray(result.tracks) || result.tracks.length === 0) return null;
            const currentTracks = this.deps.queue.getTracks();
            const merged = [...currentTracks, ...result.tracks];
            this.deps.queueControl.setCustomQueue(merged);
            if (result.queueName) this.deps.queueControl.setQueueName(result.queueName);
            this.deps.queueControl.syncQueueSnapshot?.(merged);
            const nextIdx = currentTracks.length;
            this.deps.queue.setIndex(nextIdx);
            this.deps.store?.patch({ currentTrackIndex: nextIdx });
            return result.tracks[0] ?? null;
        } catch {
            return null;
        }
    }

    private async advance(
        dir: 1 | -1,
        signal: AbortSignal,
        shouldContinue: boolean,
        requiresGesture: boolean,
        _opts?: { fadeOutMs?: number; waitMs?: number }
    ): Promise<void> {
        const tracks = this.deps.queue.getTracks();
        if (!Array.isArray(tracks) || tracks.length === 0) return;

        const bg = isBackground();

        if (bg) {
            const { nextIndex, shouldStopAtEnd } = this.computeNextIndex(dir);
            if (dir === 1 && shouldStopAtEnd) {
                const extended = await this.tryExtendQueue(signal);
                if (extended) {
                    this.deps.audio.setSwitchingUntil?.(Date.now() + 6_000);
                    try { this.deps.audio.applyMetadataEager?.(extended); } catch { }
                    await this.playTrackWithRetry(extended, signal, { requiresGesture: false, fadeInMs: 0 });
                    return;
                }
                this.deps.intent.setWanted(false);
                this.deps.store?.patch({ isPlaying: false });
                return;
            }

            const nextTrack = tracks[nextIndex];
            if (!nextTrack) return;

            this.deps.audio.setSwitchingUntil?.(Date.now() + 6_000);
            this.deps.queue.setIndex(nextIndex);
            this.deps.store?.patch({ currentTrackIndex: nextIndex });
            try { this.deps.audio.applyMetadataEager?.(nextTrack); } catch { }

            if (!shouldContinue) {
                this.deps.intent.setWanted(false);
                this.deps.store?.patch({ isPlaying: false });
                return;
            }

            await this.playTrackWithRetry(nextTrack, signal, { requiresGesture: false, fadeInMs: 0 });
            return;
        }

        this.deps.audio.setSwitchingUntil?.(Date.now() + 6_000);
        this.deps.audio.fadeOut?.(30);
        await delayMs(30, signal).catch(() => undefined);
        if (signal.aborted) throw new AbortError();

        const { nextIndex, shouldStopAtEnd } = this.computeNextIndex(dir);
        if (dir === 1 && shouldStopAtEnd) {
            const extended = await this.tryExtendQueue(signal);
            if (extended) {
                try { this.deps.audio.applyMetadataEager?.(extended); } catch { }
                await this.playTrackWithRetry(extended, signal, { requiresGesture, fadeInMs: 90 });
                return;
            }
            this.deps.intent.setWanted(false);
            this.deps.store?.patch({ isPlaying: false });
            this.deps.audio.fadeIn?.(0);
            return;
        }

        this.deps.queue.setIndex(nextIndex);
        this.deps.store?.patch({ currentTrackIndex: nextIndex });
        const track = tracks[nextIndex] || null;
        if (track) {
            try { this.deps.audio.applyMetadataEager?.(track); } catch { }
        }

        if (!shouldContinue) {
            this.deps.intent.setWanted(false);
            this.deps.store?.patch({ isPlaying: false });
            this.deps.audio.fadeIn?.(0);
            return;
        }

        if (!track) return;

        await this.playTrackWithRetry(track, signal, { requiresGesture, fadeInMs: 90 });
    }

    async togglePlayPause(): Promise<void> {
        return this.queue.run(async ({ signal }) => {
            if (!this.requireAuth('play')) return;

            const wanted = this.deps.intent.getWanted();
            if (wanted) {
                await this.pauseInternal(signal);
                return;
            }

            await this.playInternal(true, signal);
        });
    }

    async handleEnded(endedTrackId?: string | null): Promise<void> {
        return this.queue.run(async ({ signal }) => {
            const etid = endedTrackId != null ? toStableId(endedTrackId) : '';
            if (etid) {
                const active = toStableId(this.deps.playback.getActiveTrackId());
                if (active && active !== etid) return;

                const current = this.getCurrentTrack();
                const currentId = toStableId(current?.id);
                if (currentId && currentId !== etid) return;

                const now = Date.now();
                if (this.lastHandledEnded.trackId === etid && now - this.lastHandledEnded.atMs < 1500) {
                    return;
                }
                this.lastHandledEnded = { trackId: etid, atMs: now };
            }

            const wanted = this.deps.intent.getWanted();
            if (!wanted) return;

            const autoplayEnabled = this.deps.settings?.getAutoplayEnabled?.() !== false;
            if (!autoplayEnabled) {
                await this.pauseInternal(signal);
                return;
            }

            const repeatMode = this.deps.queue.getRepeatMode();
            if (repeatMode === 'one') {
                await this.restartCurrentTrack(signal);
                return;
            }

            await this.advance(1, signal, true, false, { fadeOutMs: 0, waitMs: 0 });
        });
    }

    async selectTrack(track: TrackLike): Promise<boolean> {
        return this.queue.run(async ({ signal }) => {
            if (!this.requireAuth('play')) return false;

            const requestedId = toStableId(track?.id);
            if (!requestedId) return false;

            const tracks = this.deps.queue.getTracks();
            if (!Array.isArray(tracks) || tracks.length === 0) return false;

            const targetIndex = tracks.findIndex((t) => toStableId(t?.id) === requestedId);
            if (targetIndex < 0) return false;

            return this.playTrackAtIndex(tracks, targetIndex, signal);
        });
    }

    async playFromList(tracks: ReadonlyArray<TrackLike>, startId?: unknown, queueName?: unknown): Promise<boolean> {
        return this.queue.run(async ({ signal }) => {
            if (!this.requireAuth('play')) return false;

            const input = Array.isArray(tracks) ? tracks : [];
            const unique = this.buildUniqueTracks(input);
            if (unique.length === 0) return false;

            const startKey = toStableId(startId);
            const rawIdx = startKey ? unique.findIndex((t) => toStableId(t?.id) === startKey) : 0;
            const startIndex = Math.max(0, rawIdx);

            const name = typeof queueName === 'string' && queueName.trim() ? queueName.trim() : 'Playlist';

            const track = this.applyCustomQueue(unique, name, startIndex);
            if (!track) return false;

            await this.startPlaybackForTrack(track, signal);

            return true;
        });
    }

    async playPlaylist(tracks: ReadonlyArray<TrackLike>, playlistName?: unknown): Promise<boolean> {
        return this.queue.run(async ({ signal }) => {
            if (!this.requireAuth('play')) return false;

            const input = Array.isArray(tracks) ? tracks : [];
            const unique = this.buildUniqueTracks(input);
            if (unique.length === 0) return false;

            const name = typeof playlistName === 'string' && playlistName.trim() ? playlistName.trim() : 'Playlist';
            const track = this.applyCustomQueue(unique, name, 0);
            if (!track) return false;

            await this.startPlaybackForTrack(track, signal);
            return true;
        });
    }

    async playTrackById(id: unknown, autoPlay: boolean = true): Promise<boolean> {
        return this.queue.run(async ({ signal }) => {
            if (!this.requireAuth('play')) return false;

            const targetId = toStableId(id);
            if (!targetId) return false;

            const tracks = this.deps.queue.getTracks();
            if (Array.isArray(tracks) && tracks.length > 0) {
                const idx = tracks.findIndex((t) => toStableId(t?.id) === targetId);
                if (idx >= 0) {
                    if (autoPlay) {
                        return this.playTrackAtIndex(tracks, idx, signal);
                    }
                    try {
                        this.deps.queue.setIndex(clampIndex(idx, tracks.length));
                    } catch {
                        return false;
                    }
                    return true;
                }
            }

            let fetched: TrackLike | null = null;
            try {
                fetched = await this.deps.catalog.fetchTrackById(targetId, signal);
            } catch (e) {
                if (isAbortError(e)) throw e;
                fetched = null;
            }
            const fetchedId = toStableId(fetched?.id);
            if (!fetched || !fetchedId) return false;

            if (!this.applyCustomQueue([fetched], 'Track', 0)) return false;

            if (!autoPlay) {
                return true;
            }

            await this.playTrackWithRetry({ ...fetched, id: fetchedId }, signal, { requiresGesture: true, fadeInMs: 80 });

            return true;
        });
    }

    async play(): Promise<void> {
        return this.queue.run(async ({ signal }) => {
            if (!this.requireAuth('play')) return;
            await this.playInternal(true, signal);
        });
    }

    async pause(): Promise<void> {
        return this.queue.run(async ({ signal }) => {
            await this.pauseInternal(signal);
        });
    }

    async seek(seconds: number): Promise<void> {
        return this.seekQueue.run(async ({ signal }) => {
            const s = Number(seconds);
            if (!Number.isFinite(s)) {
                this.deps.intent.setSeeking?.(false);
                return;
            }

            const current = this.fsm.current;
            if (current === 'IDLE' || current === 'LOADING') {
                this.deps.intent.setSeeking?.(false);
                return;
            }

            const target = Math.max(0, s);

            this.deps.intent.setSeeking?.(true);
            if (this.deps.store) {
                this.deps.store.patch({ isSeeking: true });
            }
            this.fsm.transition('SEEKING');
            this.deps.store?.patch({ fsmState: this.fsm.current });

            if (signal.aborted) {
                this.notifySeekComplete();
                return;
            }

            try {
                await this.deps.playback.seek(target);
            } catch {
            } finally {
                this.notifySeekComplete();
            }
        });
    }

    private async pauseInternal(_signal: AbortSignal): Promise<void> {
        this.deps.intent.setWanted(false);
        this.fsm.transition('PAUSED');
        const fadeMs = isIosSafari() && isBackground() ? 0 : 80;
        this.deps.store?.patch({ isPlaying: false, fsmState: this.fsm.current });
        this.deps.audio.fadeOut?.(fadeMs);
        await this.deps.playback.pause();
    }

    private async playInternal(requiresGesture: boolean, signal?: AbortSignal): Promise<void> {
        const track = this.getCurrentTrack();
        if (!track) return;

        this.deps.intent.setWanted(true);
        this.maybeActivateAudio(requiresGesture);
        this.deps.audio.primeFadeFromSilence?.();

        const activeId = this.deps.playback.getActiveTrackId();
        const wantsNew = !activeId || String(activeId) !== String(track.id);

        if (wantsNew) {
            if (signal) {
                await this.playTrackWithRetry(track, signal, { requiresGesture, fadeInMs: 80 });
            } else {
                this.fsm.transition('LOADING');
                this.deps.store?.patch({ isPlaying: true, isBuffering: true, fsmState: this.fsm.current });
                try {
                    await this.deps.playback.play(track);
                    this.deps.audio.fadeIn?.(80);
                    this.fsm.transition('PLAYING');
                    this.deps.store?.patch({ isBuffering: false, fsmState: this.fsm.current });
                } catch (e) {
                    this.deps.store?.patch({ isBuffering: false });
                    if (!isAbortError(e) && !isBackground()) {
                        this.deps.intent.setWanted(false);
                        this.fsm.transition('ERROR');
                        this.deps.store?.patch({ isPlaying: false, fsmState: this.fsm.current });
                    }
                    this.deps.audio.fadeIn?.(0);
                }
            }
            return;
        }

        try {
            await this.deps.playback.resume();
            this.deps.audio.fadeIn?.(80);
            this.fsm.transition('PLAYING');
            this.deps.store?.patch({ isPlaying: true, fsmState: this.fsm.current });
        } catch (e) {
            if (isAbortError(e)) {
                this.deps.audio.fadeIn?.(0);
                return;
            }

            if (isIosSafari() && typeof this.deps.playback.hardReset === 'function') {
                await this.deps.playback.hardReset('resume_failed').catch(() => undefined);
                if (signal?.aborted) {
                    this.deps.audio.fadeIn?.(0);
                    return;
                }
                this.maybeActivateAudio(false);
                try {
                    await this.deps.playback.play(track);
                    this.deps.audio.fadeIn?.(80);
                    this.fsm.transition('PLAYING');
                    this.deps.store?.patch({ isPlaying: true, fsmState: this.fsm.current });
                    return;
                } catch {
                }
            }

            if (!isBackground()) {
                this.deps.intent.setWanted(false);
                this.fsm.transition('ERROR');
                this.deps.store?.patch({ isPlaying: false, fsmState: this.fsm.current });
            }
            this.deps.audio.fadeIn?.(0);
        }
    }

    async next(): Promise<void> {
        return this.queue.run(async ({ signal }) => {
            const shouldContinue = this.deps.intent.getWanted();
            await this.advance(1, signal, shouldContinue, true);
        });
    }

    async prev(): Promise<void> {
        return this.queue.run(async ({ signal }) => {
            const shouldContinue = this.deps.intent.getWanted();
            await this.advance(-1, signal, shouldContinue, true);
        });
    }
}
