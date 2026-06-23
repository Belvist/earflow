import type { ApiClientLike, LoudnessInfo, PlaybackSession, QualityOption, SessionEventMap } from '../types';
import { clamp01, clampPlaybackRate } from '../types';
import { EventBus } from '../events';
import { isIosWebKit } from '../../utils/platform';
import { getSharedBandwidthEstimator } from '../BandwidthEstimator';
import { selectQuality, type QualityPreference } from '../QualitySelector';
import type Hls from 'hls.js';

function newStreamRequestId(): string {
    const cryptoRef = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
    if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
        return cryptoRef.randomUUID().replace(/-/g, '');
    }
    if (cryptoRef && typeof cryptoRef.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        cryptoRef.getRandomValues(bytes);
        return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
}

export class DirectSession implements PlaybackSession {
    readonly protocol = 'direct' as const;
    readonly trackId: string;

    private readonly apiClient: ApiClientLike;
    private readonly audio: HTMLAudioElement;
    private readonly bus = new EventBus<SessionEventMap>();
    private hls: Hls | null = null;
    private hlsErrorUnsub: (() => void) | null = null;

    private url: string | null = null;
    private playbackSessionId: string | null = null;
    private playbackToken: string | null = null;
    private tokenExpiresAtMs: number | null = null;
    private expiresAtMs: number | null = null;
    private mime: string | null = null;
    private qualities: QualityOption[] | null = null;
    private loudness: LoudnessInfo | null = null;
    private selectedQuality: QualityOption | null = null;
    private activeStreamUrl: string | null = null;
    private activeStreamMime: string | null = null;
    private readonly qualityPreference: QualityPreference;

    private volume = 1;
    private rate = 1;

    private playing = false;

    private lastProgressAtMs: number | null = null;
    private lastProgressTimeSeconds: number | null = null;

    private watchdogTimerId: number | null = null;
    private recovering = false;

    private renewTimerId: number | null = null;

    private seekTargetSeconds: number | null = null;
    private seekDeadlineAtMs: number | null = null;

    private lastRecoverAtMs: number | null = null;

    private networkErrorStreak = 0;
    private networkRecoverTimerId: number | null = null;
    private networkOnlineHandlerBound = false;

    private endedEmitted = false;
    private hasStartedPlayback = false;

    private pendingPlay = false;
    private hiddenWatchdogTimerId: number | null = null;
    private lastHiddenAtMs: number | null = null;
    private visibilityUnsub: (() => void) | null = null;

    private unsubscribers: Array<() => void> = [];
    private offlineObjectUrl: string | null = null;

    private readonly loadTimeoutMs = 15_000;
    private readonly stallThresholdMs = 8000;
    private readonly backgroundStallThresholdMs = 15_000;
    private readonly watchdogIntervalMs = 500;
    private readonly seekTimeoutMs = 8000;
    private readonly recoverCooldownMs = 1200;

    private readonly refreshTimeoutMs = 8000;
    private readonly recoveryWindowMs = 60_000;
    private readonly maxRecoveryAttemptsPerWindow = 6;

    private recoveryAttemptAtMs: number[] = [];
    private consecutiveRecoveryFailures = 0;
    private fatalErrorEmitted = false;
    private authRetryAttempted = false;

    constructor(params: { trackId: string; apiClient: ApiClientLike; audio: HTMLAudioElement; qualityPreference?: QualityPreference }) {
        this.trackId = params.trackId;
        this.apiClient = params.apiClient;
        this.audio = params.audio;
        this.qualityPreference = params.qualityPreference || 'auto';
    }

    on<E extends keyof SessionEventMap>(event: E, listener: SessionEventMap[E]): () => void {
        return this.bus.on(event, listener);
    }

    private stopWatchdog(): void {
        if (this.watchdogTimerId == null) return;
        try {
            clearInterval(this.watchdogTimerId);
        } catch {
        }
        this.watchdogTimerId = null;
    }

    private stopRenewTimer(): void {
        if (this.renewTimerId == null) return;
        try {
            clearTimeout(this.renewTimerId);
        } catch {
        }
        this.renewTimerId = null;
    }

    private isDocumentVisible(): boolean {
        try {
            return typeof document !== 'undefined' && document.visibilityState === 'visible';
        } catch {
            return true;
        }
    }

    private tryDrainPendingPlay(): void {
        if (!this.pendingPlay) return;
        try {
            const p = this.audio.play();
            if (p && typeof (p as any).then === 'function') {
                p.then(
                    () => { this.pendingPlay = false; },
                    () => { this.pendingPlay = true; },
                );
            }
        } catch {
        }
    }

    private stopHiddenWatchdog(): void {
        if (this.hiddenWatchdogTimerId == null) return;
        try {
            clearInterval(this.hiddenWatchdogTimerId);
        } catch {
        }
        this.hiddenWatchdogTimerId = null;
    }

    private startHiddenWatchdog(): void {
        this.stopHiddenWatchdog();
        if (this.isDocumentVisible()) return;

        const w = globalThis.window;
        if (!w) return;

        const ios = isIosWebKit();
        const intervalMs = ios ? 3000 : 1000;

        const tick = () => {
            try {
                if (this.isDocumentVisible()) {
                    this.stopHiddenWatchdog();
                    return;
                }

                if (this.pendingPlay) {
                    this.tryDrainPendingPlay();
                }

                if (this.endedEmitted) return;

                if (this.audio.ended) {
                    this.playing = false;
                    this.endedEmitted = true;
                    this.bus.emit('ended');
                    return;
                }

                const now = Date.now();
                const t = Number(this.audio.currentTime);
                if (Number.isFinite(t) && t >= 0) {
                    const lastT = this.lastProgressTimeSeconds;
                    if (lastT == null || t > lastT + 0.01) {
                        this.lastProgressTimeSeconds = t;
                        this.lastProgressAtMs = now;
                    }
                }

                if (ios && this.hasStartedPlayback && this.wantsToPlay() && !this.recovering) {
                    const isPaused = (() => { try { return this.audio.paused === true; } catch { return false; } })();
                    if (isPaused) {
                        this.pendingPlay = true;
                        this.tryDrainPendingPlay();
                    }
                }

                if (this.hasStartedPlayback && this.wantsToPlay() && !this.recovering) {
                    const lpAt = this.lastProgressAtMs;
                    if (lpAt != null && now - lpAt > this.backgroundStallThresholdMs) {
                        void this.tryRecover({ renewOnly: false });
                        return;
                    }
                }

                if (this.shouldRefreshSoon()) {
                    void this.tryRecover({ renewOnly: true });
                }
            } catch {
            }
        };

        this.hiddenWatchdogTimerId = w.setInterval(tick, intervalMs);
        tick();
    }

    private bindVisibilityEvents(): void {
        if (this.visibilityUnsub) return;
        const onVisibility = () => {
            const nowMs = Date.now();
            if (!this.isDocumentVisible()) {
                this.lastHiddenAtMs = nowMs;
                this.stopWatchdog();
                this.startHiddenWatchdog();
                return;
            }

            const hiddenForMs = this.lastHiddenAtMs != null ? Math.max(0, nowMs - this.lastHiddenAtMs) : 0;
            this.lastHiddenAtMs = null;

            this.stopHiddenWatchdog();
            this.resetProgressTracking();
            this.startWatchdog();

            if (hiddenForMs >= 2000 && this.wantsToPlay() && !this.recovering) {
                const audioStalled = (() => {
                    try { return this.audio.paused || this.audio.readyState < 2; }
                    catch { return true; }
                })();
                if (audioStalled) {
                    void this.tryRecover({ renewOnly: false });
                } else if (this.shouldRefreshSoon()) {
                    void this.tryRecover({ renewOnly: true });
                }
            }

            if (this.pendingPlay) {
                this.tryDrainPendingPlay();
            }
        };
        try {
            document.addEventListener('visibilitychange', onVisibility);
        } catch {
        }

        onVisibility();
        this.visibilityUnsub = () => {
            try {
                document.removeEventListener('visibilitychange', onVisibility);
            } catch {
            }
            this.visibilityUnsub = null;
        };
    }

    private startWatchdog(): void {
        this.stopWatchdog();
        if (!this.isDocumentVisible()) return;
        const w = globalThis.window;
        if (w == null) return;
        const tick = () => {
            void this.watchdogTick();
        };
        this.watchdogTimerId = w.setInterval(tick, this.watchdogIntervalMs);
    }

    private scheduleRenew(): void {
        this.stopRenewTimer();
        const exp = this.expiresAtMs;
        if (exp == null || !Number.isFinite(exp) || exp <= 0) return;

        const now = Date.now();
        const refreshLeadMs = 30_000;
        const delayMs = Math.max(1000, Math.min(5 * 60_000, exp - now - refreshLeadMs));

        const w = globalThis.window;
        if (w == null) return;
        this.renewTimerId = w.setTimeout(() => {
            void this.tryRecover({ renewOnly: true });
        }, delayMs);
    }

    private resetProgressTracking(): void {
        this.lastProgressAtMs = Date.now();
        const t = Number(this.audio.currentTime);
        this.lastProgressTimeSeconds = Number.isFinite(t) && t >= 0 ? t : null;
    }

    private resolveRestoreSeconds(fallbackSeconds: number): number {
        const seek = this.seekTargetSeconds;
        if (seek != null && Number.isFinite(seek) && seek > 0) return seek;
        const t = Number(fallbackSeconds);
        return Number.isFinite(t) && t > 0 ? t : 0;
    }

    private async applyRestorePosition(seconds: number): Promise<void> {
        const target = Number(seconds);
        if (!Number.isFinite(target) || target <= 0) return;

        const audio = this.audio;
        const deadlineAt = Date.now() + 5000;

        await new Promise<void>((resolve) => {
            const tryApply = () => {
                try {
                    const d = Number(audio.duration);
                    let clamped = target;
                    if (Number.isFinite(d) && d > 0 && d !== Number.POSITIVE_INFINITY) {
                        clamped = Math.min(target, Math.max(0, d - 0.1));
                    }
                    audio.currentTime = clamped;
                    this.bus.emit('time', clamped);
                    if (this.seekTargetSeconds != null && Math.abs(clamped - this.seekTargetSeconds) <= 0.5) {
                        this.seekTargetSeconds = null;
                        this.seekDeadlineAtMs = null;
                    }
                } catch {
                }
            };

            const d0 = Number(audio.duration);
            if (Number.isFinite(d0) && d0 > 0 && d0 !== Number.POSITIVE_INFINITY) {
                tryApply();
                resolve();
                return;
            }

            let timeoutId: ReturnType<typeof setTimeout> | null = null;
            const cleanup = () => {
                if (timeoutId != null) {
                    try { clearTimeout(timeoutId); } catch { }
                    timeoutId = null;
                }
                try { audio.removeEventListener('loadedmetadata', onReady); } catch { }
                try { audio.removeEventListener('durationchange', onReady); } catch { }
            };

            const onReady = () => {
                cleanup();
                tryApply();
                resolve();
            };

            audio.addEventListener('loadedmetadata', onReady, { once: true });
            audio.addEventListener('durationchange', onReady, { once: true });
            timeoutId = setTimeout(() => {
                cleanup();
                tryApply();
                resolve();
            }, Math.max(500, deadlineAt - Date.now()));
        });
    }

    private emitBuffering(b: boolean): void {
        this.bus.emit('buffering', b);
    }

    private wantsToPlay(): boolean {
        return this.playing;
    }

    private getErrorStatus(e: unknown): number | null {
        const anyE = e as any;
        const st = anyE && (anyE.status ?? anyE.responseStatus);
        if (typeof st === 'number' && Number.isFinite(st)) return st;
        return null;
    }

    private isFatalStatus(status: number): boolean {
        return status === 401 || status === 403 || status === 404 || status === 410;
    }

    private canAttemptRecovery(nowMs: number): boolean {
        const w = this.recoveryWindowMs;
        this.recoveryAttemptAtMs = this.recoveryAttemptAtMs.filter((t) => nowMs - t < w);
        return this.recoveryAttemptAtMs.length < this.maxRecoveryAttemptsPerWindow;
    }

    private noteRecoveryAttempt(nowMs: number): void {
        this.recoveryAttemptAtMs.push(nowMs);
    }

    private emitFatalOnce(code: string): void {
        if (this.fatalErrorEmitted) return;
        this.fatalErrorEmitted = true;
        this.bus.emit('error', new Error(code));
    }

    private configureCrossOrigin(absoluteUrl: string): void {
        try {
            const u = new URL(absoluteUrl, typeof window !== 'undefined' ? window.location.href : undefined);
            const isSameOrigin = typeof window !== 'undefined' && u.origin === window.location.origin;
            this.audio.crossOrigin = isSameOrigin ? '' : 'use-credentials';
        } catch {
            this.audio.crossOrigin = '';
        }
    }

    private isProtectedHlsSession(): boolean {
        const mime = String(this.activeStreamMime || this.mime || '').toLowerCase();
        const url = String(this.activeStreamUrl || this.url || '').toLowerCase();
        return mime.includes('mpegurl') || url.includes('.m3u8');
    }

    private destroyHls(): void {
        const hls = this.hls;
        this.hls = null;
        if (this.hlsErrorUnsub) {
            try { this.hlsErrorUnsub(); } catch { }
            this.hlsErrorUnsub = null;
        }
        if (!hls) return;
        try { (hls as any).stopLoad?.(); } catch { }
        try { (hls as any).detachMedia?.(); } catch { }
        try { (hls as any).destroy?.(); } catch { }
    }

    private async attachProtectedHls(url: string, signal: AbortSignal): Promise<void> {
        if (signal.aborted) {
            const e = new Error('ABORTED');
            (e as any).name = 'AbortError';
            throw e;
        }
        if (!this.playbackSessionId || !this.playbackToken) throw new Error('HLS_AUTH_MISSING');

        this.destroyHls();
        const mod = await import('hls.js');
        const HlsCtor = (mod as any).default as typeof import('hls.js').default;
        if (!HlsCtor || typeof HlsCtor.isSupported !== 'function' || HlsCtor.isSupported() !== true) {
            throw new Error('HLS_NOT_SUPPORTED');
        }

        await new Promise<void>((resolve, reject) => {
            let done = false;
            let hls: any = null;
            let timerId: any = null;

            const headers = () => ({
                Authorization: `Bearer ${this.playbackToken || ''}`,
                'X-Playback-Session': this.playbackSessionId || '',
            });

            const cleanup = (removeErrorListener: boolean) => {
                if (done) return;
                done = true;
                if (timerId) {
                    try { clearTimeout(timerId); } catch { }
                    timerId = null;
                }
                try { signal.removeEventListener('abort', onAbort); } catch { }
                if (hls) {
                    try { hls.off(HlsCtor.Events.MANIFEST_PARSED, onReady); } catch { }
                    if (removeErrorListener) {
                        try { hls.off(HlsCtor.Events.ERROR, onError); } catch { }
                    }
                }
            };

            const onAbort = () => {
                cleanup(true);
                this.destroyHls();
                const e = new Error('ABORTED');
                (e as any).name = 'AbortError';
                reject(e);
            };

            const onReady = () => {
                cleanup(false);
                resolve();
            };

            const onError = (_evt: any, data: any) => {
                const code = Number(data?.response?.code ?? data?.response?.status ?? 0);
                if (code === 401 || code === 403) {
                    this.authRetryAttempted = false;
                    void this.tryRecover({ renewOnly: false });
                }
                if (!data?.fatal) return;
                cleanup(true);
                this.destroyHls();
                const e = new Error('HLSJS_FATAL');
                (e as any).status = code || undefined;
                (e as any).responseStatus = code || undefined;
                reject(e);
            };

            try { signal.addEventListener('abort', onAbort, { once: true }); } catch { }
            timerId = setTimeout(() => {
                cleanup(true);
                this.destroyHls();
                reject(new Error('HLSJS_TIMEOUT'));
            }, this.loadTimeoutMs);

            try {
                hls = new HlsCtor({
                    enableWorker: true,
                    lowLatencyMode: false,
                    backBufferLength: 30,
                    maxBufferLength: 45,
                    maxMaxBufferLength: 90,
                    maxBufferHole: 0.3,
                    xhrSetup: (xhr: any) => {
                        const h = headers();
                        try { xhr.withCredentials = false; } catch { }
                        try { xhr.setRequestHeader('Authorization', h.Authorization); } catch { }
                        try { xhr.setRequestHeader('X-Playback-Session', h['X-Playback-Session']); } catch { }
                    },
                    fetchSetup: (_ctx: any, init: any) => {
                        const h = headers();
                        const nextInit = init && typeof init === 'object' ? { ...init } : {};
                        const nextHeaders = new Headers((nextInit as any).headers || undefined);
                        nextHeaders.set('Authorization', h.Authorization);
                        nextHeaders.set('X-Playback-Session', h['X-Playback-Session']);
                        (nextInit as any).headers = nextHeaders;
                        (nextInit as any).credentials = 'omit';
                        return nextInit;
                    },
                });
            } catch {
                cleanup(true);
                reject(new Error('HLSJS_INIT_FAILED'));
                return;
            }

            this.hls = hls;
            try {
                hls.on(HlsCtor.Events.MANIFEST_PARSED, onReady);
                hls.on(HlsCtor.Events.ERROR, onError);
                this.hlsErrorUnsub = () => {
                    try { hls?.off(HlsCtor.Events.ERROR, onError); } catch { }
                };
                hls.attachMedia(this.audio);
                hls.loadSource(url);
            } catch {
                cleanup(true);
                this.destroyHls();
                reject(new Error('HLSJS_LOAD_FAILED'));
            }
        });
    }

    private stopNetworkRecoverTimer(): void {
        if (this.networkRecoverTimerId == null) return;
        try {
            clearTimeout(this.networkRecoverTimerId);
        } catch {
        }
        this.networkRecoverTimerId = null;
    }

    private bindOnlineEvent(): void {
        if (this.networkOnlineHandlerBound) return;
        const w = globalThis.window;
        if (!w) return;

        const onOnline = () => {
            if (!this.wantsToPlay()) return;
            if (this.recovering) return;
            if (this.networkErrorStreak <= 0) return;
            this.stopNetworkRecoverTimer();
            void this.tryRecover({ renewOnly: false });
        };

        try {
            w.addEventListener('online', onOnline);
            this.networkOnlineHandlerBound = true;
            this.unsubscribers.push(() => {
                try {
                    w.removeEventListener('online', onOnline);
                } catch {
                }
                this.networkOnlineHandlerBound = false;
            });
        } catch {
        }
    }

    private scheduleNetworkRecovery(): void {
        this.bindOnlineEvent();
        this.stopNetworkRecoverTimer();

        const w = globalThis.window;
        if (!w) return;

        const streak = Math.min(6, Math.max(1, this.networkErrorStreak));
        const delayMs = Math.min(12_000, 400 * (2 ** (streak - 1)));

        this.networkRecoverTimerId = w.setTimeout(() => {
            this.networkRecoverTimerId = null;
            if (!this.wantsToPlay()) return;
            if (this.recovering) return;
            void this.tryRecover({ renewOnly: false });
        }, delayMs);
    }

    private bindAudioEvents(): void {
        const onTimeUpdate = () => {
            const t = Number(this.audio.currentTime);
            if (!Number.isFinite(t) || t < 0) return;
            this.bus.emit('time', t);
        };
        const onDuration = () => {
            const d = Number(this.audio.duration);
            if (!Number.isFinite(d) || d <= 0 || d === Number.POSITIVE_INFINITY) return;
            this.bus.emit('duration', d);
        };
        const onWaiting = () => {
            this.emitBuffering(true);
            this.lastProgressAtMs ??= Date.now();
        };
        const onPlaying = () => {
            this.hasStartedPlayback = true;
            this.pendingPlay = false;
            this.emitBuffering(false);
            this.networkErrorStreak = 0;
            this.stopNetworkRecoverTimer();
            this.resetProgressTracking();
        };
        const onCanPlay = () => {
            this.emitBuffering(false);
            this.networkErrorStreak = 0;
            this.stopNetworkRecoverTimer();
            this.resetProgressTracking();
            this.tryDrainPendingPlay();
        };
        const onEnded = () => {
            const d = Number(this.audio.duration);
            const t = Number(this.audio.currentTime);
            const hasDuration = Number.isFinite(d) && d > 0 && d !== Number.POSITIVE_INFINITY;
            const hasTime = Number.isFinite(t) && t >= 0;

            if (hasDuration && hasTime) {
                const endThresholdSeconds = isIosWebKit() ? 2.0 : 0.75;
                const nearEnd = t >= d - endThresholdSeconds;
                if (!nearEnd && d >= 5 && this.recoveryAttemptAtMs.length === 0) {
                    if (!this.isDocumentVisible()) {
                        this.emitBuffering(true);
                        this.pendingPlay = true;
                        this.tryDrainPendingPlay();
                        return;
                    }
                    void this.tryRecover({ renewOnly: false });
                    return;
                }
            }

            if (!this.endedEmitted) {
                if (hasDuration && hasTime && d - t > 1.0) {
                    this.bus.emit('duration', Math.max(t, 1.0));
                }
                this.playing = false;
                this.endedEmitted = true;
                this.bus.emit('ended');
            }
        };
        const onSeeked = () => {
            const target = this.seekTargetSeconds;
            const actual = Number(this.audio.currentTime);
            if (target != null && Number.isFinite(actual) && Math.abs(actual - target) > 0.5) {
                this.bus.emit('time', actual);
            }
        };
        const onPause = () => {
            if (!this.audio.ended) return;
            if (this.endedEmitted) return;
            this.playing = false;
            this.endedEmitted = true;
            this.bus.emit('ended');
        };
        const onError = () => {
            if (this.endedEmitted) return;
            this.networkErrorStreak = Math.min(8, this.networkErrorStreak + 1);
            this.emitBuffering(true);
            this.scheduleNetworkRecovery();
        };

        this.audio.addEventListener('timeupdate', onTimeUpdate);
        this.audio.addEventListener('loadedmetadata', onDuration);
        this.audio.addEventListener('durationchange', onDuration);
        this.audio.addEventListener('waiting', onWaiting);
        this.audio.addEventListener('stalled', onWaiting);
        this.audio.addEventListener('playing', onPlaying);
        this.audio.addEventListener('canplay', onCanPlay);
        this.audio.addEventListener('loadeddata', onCanPlay);
        this.audio.addEventListener('ended', onEnded);
        this.audio.addEventListener('seeked', onSeeked);
        this.audio.addEventListener('pause', onPause);
        this.audio.addEventListener('error', onError);

        this.unsubscribers.push(
            () => this.audio.removeEventListener('timeupdate', onTimeUpdate),
            () => this.audio.removeEventListener('loadedmetadata', onDuration),
            () => this.audio.removeEventListener('durationchange', onDuration),
            () => this.audio.removeEventListener('waiting', onWaiting),
            () => this.audio.removeEventListener('stalled', onWaiting),
            () => this.audio.removeEventListener('playing', onPlaying),
            () => this.audio.removeEventListener('canplay', onCanPlay),
            () => this.audio.removeEventListener('loadeddata', onCanPlay),
            () => this.audio.removeEventListener('ended', onEnded),
            () => this.audio.removeEventListener('seeked', onSeeked),
            () => this.audio.removeEventListener('pause', onPause),
            () => this.audio.removeEventListener('error', onError),
        );
    }

    private async waitForReady(signal: AbortSignal): Promise<void> {
        if (signal.aborted) {
            const e = new Error('ABORTED');
            (e as any).name = 'AbortError';
            throw e;
        }

        const audio = this.audio;
        const deadlineAt = Date.now() + this.loadTimeoutMs;

        await new Promise<void>((resolve, reject) => {
            let pollId: number | null = null;
            const cleanup = () => {
                if (pollId != null) {
                    try {
                        clearInterval(pollId);
                    } catch {
                    }
                    pollId = null;
                }
                try {
                    audio.removeEventListener('loadedmetadata', onReady);
                } catch {
                }
                try {
                    audio.removeEventListener('canplay', onReady);
                } catch {
                }
                try {
                    audio.removeEventListener('error', onFail);
                } catch {
                }
                try {
                    signal.removeEventListener('abort', onAbort);
                } catch {
                }
            };

            const onAbort = () => {
                cleanup();
                const e = new Error('ABORTED');
                (e as any).name = 'AbortError';
                reject(e);
            };

            const onFail = () => {
                cleanup();
                reject(new Error('DIRECT_LOAD_FAILED'));
            };

            const onReady = () => {
                cleanup();
                resolve();
            };

            try {
                signal.addEventListener('abort', onAbort, { once: true });
            } catch {
            }

            try {
                audio.addEventListener('loadedmetadata', onReady);
            } catch {
            }
            try {
                audio.addEventListener('canplay', onReady);
            } catch {
            }
            try {
                audio.addEventListener('error', onFail);
            } catch {
            }

            const w = globalThis.window;
            if (w == null) {
                cleanup();
                reject(new Error('DIRECT_ENV_NO_WINDOW'));
                return;
            }

            pollId = w.setInterval(() => {
                try {
                    if (signal.aborted) {
                        onAbort();
                        return;
                    }
                    if (Date.now() > deadlineAt) {
                        cleanup();
                        reject(new Error('DIRECT_LOAD_TIMEOUT'));
                        return;
                    }
                    if (audio.readyState >= 1) {
                        cleanup();
                        resolve();
                        return;
                    }
                } catch {
                }
            }, 200);
        });
    }

    private applyQualitySelection(): void {
        const estimator = getSharedBandwidthEstimator();
        const chosen = selectQuality(this.qualities, this.qualityPreference, estimator);
        this.selectedQuality = chosen;

        if (chosen) {
            this.activeStreamUrl = chosen.url;
            this.activeStreamMime = chosen.mime || null;
            if (chosen.loudness) {
                this.loudness = chosen.loudness;
            }
        } else {
            this.activeStreamUrl = this.url;
            this.activeStreamMime = this.mime;
        }
    }

    /** Appends _s=request id so DevTools lists distinct range requests; ignored by direct-stream-service. */
    private resolveActiveUrl(): string {
        const raw = this.activeStreamUrl || this.url || '';
        const base = this.apiClient.streamingBaseUrl || this.apiClient.baseUrl || '';
        try {
            const u = new URL(raw, base);
            u.searchParams.set('_s', newStreamRequestId());
            return u.toString();
        } catch {
            return raw;
        }
    }

    private releaseOfflineObjectUrl(): void {
        if (this.offlineObjectUrl) {
            try { URL.revokeObjectURL(this.offlineObjectUrl); } catch { /* noop */ }
            this.offlineObjectUrl = null;
        }
    }

    private measureBandwidth(): void {
        if (typeof performance === 'undefined') return;
        if (typeof performance.getEntriesByType !== 'function') return;

        const estimator = getSharedBandwidthEstimator();
        const url = this.activeStreamUrl || this.url || '';
        if (!url) return;

        try {
            const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
            for (let i = entries.length - 1; i >= 0; i--) {
                const entry = entries[i];
                if (!entry.name.includes(url.slice(0, 64))) continue;

                const bytes = entry.transferSize || entry.encodedBodySize;
                const durationMs = entry.responseEnd - entry.responseStart;
                if (bytes > 0 && durationMs > 0) {
                    estimator.addSample(bytes, durationMs);
                }
                break;
            }
        } catch {
        }
    }

    private async refreshSession(signal: AbortSignal): Promise<void> {
        const canRefresh = this.playbackSessionId && typeof this.apiClient.refreshSongDirectSession === 'function';
        const res = canRefresh
            ? await this.apiClient.refreshSongDirectSession!(this.playbackSessionId!, {
                signal,
                trackId: this.trackId,
            })
            : await this.apiClient.getSongDirectSession(this.trackId, { signal });
        const url = res && typeof res.url === 'string' ? res.url : '';
        if (!url) {
            const e = new Error('DIRECT_SESSION_INVALID');
            (e as any).status = 502;
            throw e;
        }
        this.url = url;
        this.expiresAtMs = typeof res.expiresAtMs === 'number' && Number.isFinite(res.expiresAtMs) ? res.expiresAtMs : null;
        this.playbackSessionId = typeof (res as any).sessionId === 'string' ? (res as any).sessionId : this.playbackSessionId;
        this.playbackToken = typeof (res as any).playbackToken === 'string' ? (res as any).playbackToken : this.playbackToken;
        this.tokenExpiresAtMs = typeof (res as any).tokenExpiresAtMs === 'number' && Number.isFinite((res as any).tokenExpiresAtMs)
            ? (res as any).tokenExpiresAtMs
            : this.expiresAtMs;
        this.mime = res && typeof res.mime === 'string' ? res.mime : null;

        if (Array.isArray((res as any).qualities)) {
            this.qualities = (res as any).qualities;
            const withLoudness = this.qualities?.find((q: QualityOption) => q.loudness && typeof q.loudness.inputLufs === 'number');
            if (withLoudness?.loudness) {
                this.loudness = withLoudness.loudness;
            }
        }

        this.scheduleRenew();
    }

    private async refreshSessionWithTimeout(parentSignal: AbortSignal): Promise<void> {
        const ctrl = new AbortController();
        const onAbort = () => {
            try {
                ctrl.abort();
            } catch {
            }
        };
        try {
            if (parentSignal.aborted) {
                const e = new Error('ABORTED');
                (e as any).name = 'AbortError';
                throw e;
            }
            try {
                parentSignal.addEventListener('abort', onAbort, { once: true });
            } catch {
            }

            const w = globalThis.window;
            if (!w) {
                const e = new Error('DIRECT_ENV_NO_WINDOW');
                (e as any).status = 503;
                throw e;
            }

            const timeoutId = w.setTimeout(() => {
                try {
                    ctrl.abort();
                } catch {
                }
            }, this.refreshTimeoutMs);
            try {
                await this.refreshSession(ctrl.signal);
            } finally {
                try {
                    clearTimeout(timeoutId);
                } catch {
                }
            }
        } finally {
            try {
                parentSignal.removeEventListener('abort', onAbort);
            } catch {
            }
        }
    }

    private shouldRefreshSoon(): boolean {
        const exp = this.expiresAtMs;
        if (!exp || !Number.isFinite(exp) || exp <= 0) return false;
        const now = Date.now();
        const refreshLeadMs = this.isDocumentVisible() ? 30_000 : 120_000;
        return now + refreshLeadMs >= exp;
    }

    async load(signal: AbortSignal): Promise<void> {
        this.bindAudioEvents();
        this.bindVisibilityEvents();

        const offlineLoaded = await this.tryLoadFromOfflineCache(signal);
        if (offlineLoaded) {
            this.audio.volume = this.volume;
            this.audio.playbackRate = this.rate;
            await this.waitForReady(signal);
            this.hasStartedPlayback = false;
            this.resetProgressTracking();
            this.startWatchdog();
            return;
        }

        if (!this.url) {
            await this.refreshSession(signal);
        }

        if (signal.aborted) {
            const e = new Error('ABORTED');
            (e as any).name = 'AbortError';
            throw e;
        }

        this.applyQualitySelection();

        const absoluteUrl = this.resolveActiveUrl();
        if (!absoluteUrl) throw new Error('DIRECT_URL_INVALID');

        this.configureCrossOrigin(absoluteUrl);

        const effectiveMime = this.activeStreamMime || this.mime;
        if (effectiveMime) {
            try {
                this.audio.setAttribute('type', effectiveMime);
            } catch {
            }
        }

        if (this.isProtectedHlsSession()) {
            await this.attachProtectedHls(absoluteUrl, signal);
        } else {
            this.destroyHls();
            this.audio.preload = 'auto';
            this.audio.src = absoluteUrl;
            this.audio.load();
        }

        this.audio.volume = this.volume;
        this.audio.playbackRate = this.rate;

        if (!this.isProtectedHlsSession()) {
            await this.waitForReady(signal);
        }

        this.measureBandwidth();

        this.hasStartedPlayback = false;

        this.resetProgressTracking();
        this.startWatchdog();
    }

    private async tryLoadFromOfflineCache(signal: AbortSignal): Promise<boolean> {
        try {
            const { getTrackBlob } = await import('../../offline/OfflineStorage');
            const blob = await getTrackBlob(this.trackId);
            if (!blob) return false;
            if (signal.aborted) {
                const e = new Error('ABORTED');
                (e as any).name = 'AbortError';
                throw e;
            }

            this.releaseOfflineObjectUrl();
            const objectUrl = URL.createObjectURL(blob);
            this.offlineObjectUrl = objectUrl;

            try {
                this.audio.crossOrigin = null as any;
            } catch { }

            const mime = blob.type || 'audio/mpeg';
            try {
                this.audio.setAttribute('type', mime);
            } catch { }

            this.audio.preload = 'auto';
            this.audio.src = objectUrl;
            this.audio.load();

            this.activeStreamMime = mime;
            this.activeStreamUrl = objectUrl;

            return true;
        } catch (e) {
            if ((e as Error)?.name === 'AbortError') throw e;
            return false;
        }
    }

    async preloadSession(signal: AbortSignal): Promise<void> {
        if (this.url && this.expiresAtMs && Date.now() < this.expiresAtMs - 30_000) return;
        await this.refreshSession(signal);
        this.applyQualitySelection();
    }

    async play(): Promise<void> {
        this.playing = true;
        this.endedEmitted = false;
        const bg = !this.isDocumentVisible();
        if (bg) {
            this.pendingPlay = true;
            try {
                const p = this.audio.play();
                if (p && typeof (p as any).then === 'function') {
                    p.then(
                        () => { this.pendingPlay = false; },
                        () => { this.pendingPlay = true; },
                    );
                }
            } catch {
            }
            return;
        }
        await this.audio.play();
        this.pendingPlay = false;
    }

    async pause(): Promise<void> {
        this.playing = false;
        this.pendingPlay = false;
        this.audio.pause();
    }

    async seek(seconds: number): Promise<void> {
        const s = Number(seconds);
        if (!Number.isFinite(s) || s < 0) return;
        const bg = !this.isDocumentVisible();
        const wasPlaying = (() => { try { return this.audio.paused === false; } catch { return false; } })();
        const target = this.clampSeekTarget(s);
        this.seekTargetSeconds = target;
        this.seekDeadlineAtMs = Date.now() + this.seekTimeoutMs;
        this.audio.currentTime = target;
        this.resetProgressTracking();
        this.endedEmitted = false;

        if (bg && isIosWebKit() && wasPlaying) {
            this.pendingPlay = true;
            this.tryDrainPendingPlay();
        }
    }

    private clampSeekTarget(seconds: number): number {
        const s = Math.max(0, Number(seconds) || 0);
        try {
            const d = Number(this.audio.duration);
            if (Number.isFinite(d) && d > 0 && d !== Number.POSITIVE_INFINITY) {
                const maxT = Math.max(0, d - 0.1);
                if (s > maxT) return maxT;
            }
        } catch {
        }
        return s;
    }

    async destroy(): Promise<void> {
        this.playing = false;
        this.pendingPlay = false;
        this.stopWatchdog();
        this.stopHiddenWatchdog();
        this.stopRenewTimer();
        this.stopNetworkRecoverTimer();
        this.destroyHls();
        this.releaseOfflineObjectUrl();

        this.unsubscribers.forEach((fn) => fn());
        this.unsubscribers = [];

        if (this.visibilityUnsub) {
            this.visibilityUnsub();
        }

        if (!isIosWebKit()) {
            try { this.audio.pause(); } catch { }
            try { this.audio.removeAttribute('src'); } catch { }
            try { this.audio.load(); } catch { }
        }

        this.bus.clear();
    }

    setVolume(volume: number): void {
        this.volume = clamp01(volume);
        try {
            this.audio.volume = this.volume;
        } catch {
        }
    }

    setPlaybackRate(rate: number): void {
        this.rate = clampPlaybackRate(rate);
        try {
            this.audio.playbackRate = this.rate;
        } catch {
        }
    }

    getCurrentTime(): number {
        const t = Number(this.audio.currentTime);
        return Number.isFinite(t) ? t : 0;
    }

    getDuration(): number {
        const d = Number(this.audio.duration);
        return Number.isFinite(d) ? d : 0;
    }

    isPlaying(): boolean {
        return this.playing && !this.audio.paused;
    }

    getLoudness(): LoudnessInfo | null {
        return this.loudness;
    }

    getQualities(): QualityOption[] | null {
        return this.qualities;
    }

    private async watchdogTick(): Promise<void> {
        if (this.recovering) return;
        if (!this.wantsToPlay()) return;

        const now = Date.now();
        const t = Number(this.audio.currentTime);
        const isTimeValid = Number.isFinite(t) && t >= 0;
        if (!isTimeValid) return;

        const lastT = this.lastProgressTimeSeconds;
        const hasAdvanced = lastT == null ? true : t > lastT + 0.01;

        if (hasAdvanced) {
            this.lastProgressTimeSeconds = t;
            this.lastProgressAtMs = now;
        } else {
            this.lastProgressAtMs ??= now;
        }

        if (this.seekTargetSeconds != null && this.seekDeadlineAtMs != null) {
            const target = this.seekTargetSeconds;
            const reached = Math.abs(t - target) <= 0.35 || (t > target && t - target <= 1.0);
            if (reached) {
                this.seekTargetSeconds = null;
                this.seekDeadlineAtMs = null;
            }
        }

        if (this.seekDeadlineAtMs != null && now > this.seekDeadlineAtMs) {
            await this.tryRecover();
            return;
        }

        if (!this.hasStartedPlayback) {
            return;
        }

        if (this.lastProgressAtMs != null && now - this.lastProgressAtMs > this.stallThresholdMs) {
            await this.tryRecover({ renewOnly: false });
            return;
        }

        if (this.shouldRefreshSoon()) {
            await this.tryRecover({ renewOnly: true });
        }
    }

    private async tryAuthRefreshAndRetry(opts?: { renewOnly?: boolean }): Promise<boolean> {
        if (typeof this.apiClient.refreshSession !== 'function') return false;
        this.authRetryAttempted = true;
        try {
            const refreshed = await this.apiClient.refreshSession();
            if (!refreshed) return false;

            this.recovering = false;
            this.lastRecoverAtMs = null;
            await this.tryRecover(opts);
            return !this.fatalErrorEmitted;
        } catch {
            return false;
        }
    }

    private async tryRecover(opts?: { renewOnly?: boolean }): Promise<void> {
        if (this.recovering) return;

        const now = Date.now();
        if (this.lastRecoverAtMs != null && now - this.lastRecoverAtMs < this.recoverCooldownMs) {
            return;
        }

        if (!this.canAttemptRecovery(now)) {
            this.emitFatalOnce('DIRECT_RECOVERY_BUDGET_EXCEEDED');
            return;
        }

        this.recovering = true;
        this.lastRecoverAtMs = now;
        this.noteRecoveryAttempt(now);
        try {
            const restoreSeconds = this.resolveRestoreSeconds(Number(this.audio.currentTime));
            const wasPlaying = !this.audio.paused;

            const oldUrl = this.activeStreamUrl || this.url;

            const parentCtrl = new AbortController();
            await this.refreshSessionWithTimeout(parentCtrl.signal);
            this.applyQualitySelection();

            const absoluteUrl = this.resolveActiveUrl();
            if (!absoluteUrl) throw new Error('DIRECT_URL_INVALID');

            const newUrl = this.activeStreamUrl || this.url;
            const shouldSwap = oldUrl !== newUrl;
            if (opts?.renewOnly === true && !shouldSwap) {
                this.consecutiveRecoveryFailures = 0;
                return;
            }

            this.emitBuffering(true);

            if (this.isDocumentVisible() || !isIosWebKit()) {
                try { this.audio.pause(); } catch { }
            }

            this.configureCrossOrigin(absoluteUrl);

            if (this.isProtectedHlsSession()) {
                await this.attachProtectedHls(absoluteUrl, parentCtrl.signal);
            } else {
                this.destroyHls();
                this.audio.preload = 'auto';
                this.audio.src = absoluteUrl;
                this.audio.load();
            }

            await this.applyRestorePosition(restoreSeconds);

            if (wasPlaying) {
                if (!this.isDocumentVisible()) {
                    this.pendingPlay = true;
                    this.tryDrainPendingPlay();
                } else {
                    await this.audio.play().catch(() => undefined);
                }
            }

            this.consecutiveRecoveryFailures = 0;
        } catch (e) {
            const st = this.getErrorStatus(e);
            if (st != null && this.isFatalStatus(st)) {
                if ((st === 401 || st === 403) && !this.authRetryAttempted) {
                    const recovered = await this.tryAuthRefreshAndRetry(opts);
                    if (recovered) return;
                }
                this.emitFatalOnce('DIRECT_RECOVERY_FATAL');
                return;
            }

            this.consecutiveRecoveryFailures = Math.min(20, this.consecutiveRecoveryFailures + 1);
            if (this.consecutiveRecoveryFailures >= 3) {
                this.emitFatalOnce('DIRECT_RECOVERY_FAILED');
                return;
            }

            this.networkErrorStreak = Math.min(8, this.networkErrorStreak + 1);
            this.scheduleNetworkRecovery();
        } finally {
            this.resetProgressTracking();
            this.recovering = false;
        }
    }
}
