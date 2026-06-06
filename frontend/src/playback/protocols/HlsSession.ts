import type { ApiClientLike, LoudnessInfo, PlaybackSession, QualityOption, SessionEventMap } from '../types';
import { clamp01, clampPlaybackRate } from '../types';
import { EventBus } from '../events';
import type Hls from 'hls.js';
import { isIosWebKit } from '../../utils/platform';

export class HlsSession implements PlaybackSession {
    readonly protocol = 'hls' as const;
    readonly trackId: string;

    private readonly apiClient: ApiClientLike;
    private readonly audio: HTMLAudioElement;
    private readonly bus = new EventBus<SessionEventMap>();

    private hls: Hls | null = null;

    private hlsErrorUnsub: (() => void) | null = null;

    private masterUrl: string | null = null;

    private seekTargetSeconds: number | null = null;
    private seekDeadlineAtMs: number | null = null;

    private lastProgressAtMs: number | null = null;
    private lastProgressTimeSeconds: number | null = null;

    private watchdogTimerId: number | null = null;
    private hiddenWatchdogTimerId: number | null = null;
    private recovering = false;
    private recoveryStep: 0 | 1 | 2 | 3 = 0;

    private recoveryWindowStartAtMs: number | null = null;
    private recoveryCountInWindow = 0;

    private lastHiddenAtMs: number | null = null;

    private visibilityUnsub: (() => void) | null = null;

    private pendingPlay = false;

    private endedEmitted = false;

    private volume = 1;
    private rate = 1;

    private unsubscribers: Array<() => void> = [];

    private readonly loadTimeoutMs = 15_000;
    private readonly watchdogIntervalMs = 500;
    private readonly stallThresholdMs: number;
    private readonly seekTimeoutMs = 8000;
    private readonly backgroundRecoverDelayMs = 250;

    private readonly recoveryWindowMs = 30_000;
    private readonly maxRecoveriesPerWindow = 3;

    constructor(params: { trackId: string; apiClient: ApiClientLike; audio: HTMLAudioElement }) {
        this.trackId = params.trackId;
        this.apiClient = params.apiClient;
        this.audio = params.audio;

        this.stallThresholdMs = isIosWebKit() ? 12_000 : 8000;
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
                    () => {
                        this.pendingPlay = false;
                    },
                    () => {
                        this.pendingPlay = true;
                    },
                );
            }
        } catch {
        }
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

            if (this.seekTargetSeconds != null && this.seekDeadlineAtMs != null && nowMs > this.seekDeadlineAtMs) {
                const t = Number(this.audio.currentTime);
                if (Number.isFinite(t) && Math.abs(t - this.seekTargetSeconds) <= 0.75) {
                    this.seekTargetSeconds = null;
                    this.seekDeadlineAtMs = null;
                } else {
                    this.seekDeadlineAtMs = nowMs + this.seekTimeoutMs;
                }
            }

            this.resetProgressTracking();
            this.startWatchdog();

            if (hiddenForMs >= 1500) {
                const audioStalled = (() => {
                    try { return this.audio.paused || this.audio.readyState < 2; }
                    catch { return true; }
                })();
                if (audioStalled) {
                    const delayMs = hiddenForMs >= 10_000 ? this.backgroundRecoverDelayMs : 1000;
                    void this.scheduleBackgroundRecovery(delayMs);
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

    private stopWatchdog(): void {
        if (this.watchdogTimerId == null) return;
        try {
            clearInterval(this.watchdogTimerId);
        } catch {
        }
        this.watchdogTimerId = null;
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

        const w = typeof window !== 'undefined' ? window : null;
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
                    this.endedEmitted = true;
                    this.bus.emit('ended');
                    return;
                }
            } catch {
            }
        };

        this.hiddenWatchdogTimerId = w.setInterval(tick, intervalMs);
        tick();
    }

    private startWatchdog(): void {
        this.stopWatchdog();
        if (!this.isDocumentVisible()) return;

        const w = typeof window !== 'undefined' ? window : null;
        if (!w) return;
        const tick = () => {
            void this.watchdogTick();
        };
        this.watchdogTimerId = w.setInterval(tick, this.watchdogIntervalMs);
    }

    private async watchdogTick(): Promise<void> {
        if (!this.isDocumentVisible()) return;
        if (this.recovering) return;
        if (!this.isPlaying()) return;

        const now = Date.now();
        const t = Number(this.audio.currentTime);
        const isTimeValid = Number.isFinite(t) && t >= 0;
        if (!isTimeValid) return;

        const lastT = this.lastProgressTimeSeconds;
        const hasAdvanced = lastT == null ? true : t > lastT + 0.01;

        if (hasAdvanced) {
            this.lastProgressTimeSeconds = t;
            this.lastProgressAtMs = now;
        } else if (this.lastProgressAtMs == null) {
            this.lastProgressAtMs = now;
        }

        if (this.seekDeadlineAtMs != null && now > this.seekDeadlineAtMs) {
            await this.tryRecover('seek_timeout');
            return;
        }

        if (this.lastProgressAtMs != null && now - this.lastProgressAtMs > this.stallThresholdMs) {
            await this.tryRecover('stalled');
        }
    }

    private async scheduleBackgroundRecovery(delayMs = this.backgroundRecoverDelayMs): Promise<void> {
        if (!this.isDocumentVisible()) return;
        if (this.recovering) return;
        if (!this.isPlaying()) return;

        const startTime = Number(this.audio.currentTime);
        const hasStartTime = Number.isFinite(startTime) && startTime >= 0;
        await new Promise<void>((resolve) => {
            const wait = Math.max(0, Number(delayMs) || 0);
            const id = window.setTimeout(() => resolve(), wait);
            if (id == null) resolve();
        });

        if (this.recovering) return;
        if (!this.isPlaying()) return;

        const nowTime = Number(this.audio.currentTime);
        if (hasStartTime && Number.isFinite(nowTime) && nowTime >= 0) {
            if (nowTime <= startTime + 0.01) {
                await this.tryRecover('background_resume_no_progress');
            }
            return;
        }

        const now = Date.now();
        const last = this.lastProgressAtMs;
        if (last != null && now - last > this.stallThresholdMs) {
            await this.tryRecover('background_resume_stall');
        }
    }

    private resetProgressTracking(): void {
        this.lastProgressAtMs = Date.now();
        this.lastProgressTimeSeconds = Number.isFinite(Number(this.audio.currentTime)) ? Number(this.audio.currentTime) : null;
    }

    private async tryRecover(reason: string): Promise<void> {
        if (this.recovering) return;
        const bg = !this.isDocumentVisible();
        const iosNative = bg && isIosWebKit() && this.hls == null && this.canPlayNativeHls();
        if (bg && !iosNative) {
            void reason;
            return;
        }

        const now = Date.now();
        const windowStart = this.recoveryWindowStartAtMs;
        if (windowStart == null || now - windowStart > this.recoveryWindowMs) {
            this.recoveryWindowStartAtMs = now;
            this.recoveryCountInWindow = 0;
        }
        this.recoveryCountInWindow += 1;
        if (this.recoveryCountInWindow > this.maxRecoveriesPerWindow) {
            this.stopWatchdog();
            this.bus.emit('error', new Error('HLS_RECOVERY_LIMIT'));
            return;
        }

        this.recovering = true;
        try {
            const nativeHls = this.hls == null && isIosWebKit() && this.canPlayNativeHls();
            if (nativeHls) {
                const ok = await this.softRecoverNative();
                if (ok) {
                    this.recoveryStep = 0;
                    return;
                }
            }

            const step = this.recoveryStep;
            if (step === 0) {
                const ok = await this.recoverWithRecoverMediaError();
                this.recoveryStep = ok ? 0 : 1;
                if (ok) return;
            }

            if (this.recoveryStep === 1) {
                const ok = await this.recoverWithStopStartLoad();
                this.recoveryStep = ok ? 0 : 2;
                if (ok) return;
            }

            if (this.recoveryStep === 2) {
                const ok = await this.recoverWithSessionRefresh();
                this.recoveryStep = ok ? 0 : 3;
                if (ok) return;
            }

            await this.recoverWithHardReset();
            this.recoveryStep = 0;
        } finally {
            this.resetProgressTracking();
            this.recovering = false;
            void reason;
        }
    }

    private async softRecoverNative(): Promise<boolean> {
        if (this.hls != null) return false;
        if (!isIosWebKit()) return false;
        if (!this.canPlayNativeHls()) return false;

        const a = this.audio;
        const paused = (() => {
            try { return a.paused === true; } catch { return false; }
        })();
        if (paused) return false;

        const t0 = Number(a.currentTime);
        const hasT0 = Number.isFinite(t0) && t0 >= 0;

        try {
            this.resumeOrPendPlay();
        } catch {
        }

        const w = typeof window !== 'undefined' ? window : null;
        if (w) {
            await new Promise<void>((resolve) => {
                try {
                    w.setTimeout(() => resolve(), 650);
                } catch {
                    resolve();
                }
            });
        }

        const t1 = Number(a.currentTime);
        if (hasT0 && Number.isFinite(t1) && t1 >= 0) {
            return t1 > t0 + 0.01;
        }

        const rs = Number(a.readyState);
        return Number.isFinite(rs) && rs >= 2;
    }

    private async recoverWithRecoverMediaError(): Promise<boolean> {
        const hls: any = this.hls as any;
        if (!hls) return false;
        if (typeof hls.recoverMediaError !== 'function') return false;
        try {
            hls.recoverMediaError();
            await this.audio.play().catch(() => { });
            return true;
        } catch {
            return false;
        }
    }

    private async recoverWithStopStartLoad(): Promise<boolean> {
        const hls: any = this.hls as any;
        if (!hls) return false;
        if (typeof hls.stopLoad !== 'function' || typeof hls.startLoad !== 'function') return false;
        try {
            const at = this.audio.currentTime || 0;
            hls.stopLoad();
            hls.startLoad(Math.max(0, at - 0.5));
            await this.audio.play().catch(() => { });
            return true;
        } catch {
            return false;
        }
    }

    private resumeOrPendPlay(): void {
        if (!this.isDocumentVisible()) {
            this.pendingPlay = true;
            this.tryDrainPendingPlay();
            return;
        }
        this.audio.play().catch(() => { });
    }

    private async recoverWithSessionRefresh(): Promise<boolean> {
        const masterUrl = this.masterUrl;
        if (!masterUrl) return false;

        const ctrl = new AbortController();
        const timeout = window.setTimeout(() => ctrl.abort(), this.loadTimeoutMs);

        try {
            const res = await this.apiClient.getSongHlsSession(this.trackId, { signal: ctrl.signal });
            const nextMaster = res && typeof res.masterUrl === 'string' ? res.masterUrl : '';
            if (!nextMaster) return false;

            this.masterUrl = nextMaster;
            const pos = this.audio.currentTime || 0;
            await this.reinitPipeline(nextMaster, pos, ctrl.signal);
            this.resumeOrPendPlay();
            return true;
        } catch (e) {
            const st = (e as any)?.status ?? (e as any)?.responseStatus;
            if ((st === 401 || st === 403) && typeof this.apiClient.refreshSession === 'function') {
                try {
                    const refreshed = await this.apiClient.refreshSession();
                    if (refreshed) {
                        const ctrl2 = new AbortController();
                        const timeout2 = window.setTimeout(() => ctrl2.abort(), this.loadTimeoutMs);
                        try {
                            const res2 = await this.apiClient.getSongHlsSession(this.trackId, { signal: ctrl2.signal });
                            const m2 = res2 && typeof res2.masterUrl === 'string' ? res2.masterUrl : '';
                            if (m2) {
                                this.masterUrl = m2;
                                const pos = this.audio.currentTime || 0;
                                await this.reinitPipeline(m2, pos, ctrl2.signal);
                                this.resumeOrPendPlay();
                                return true;
                            }
                        } finally {
                            try { clearTimeout(timeout2); } catch { }
                        }
                    }
                } catch {
                }
            }
            return false;
        } finally {
            try {
                clearTimeout(timeout);
            } catch {
            }
        }
    }

    private async recoverWithHardReset(): Promise<void> {
        const masterUrl = this.masterUrl;
        if (!masterUrl) {
            this.bus.emit('error', new Error('HLS_RECOVERY_FAILED'));
            return;
        }
        const ctrl = new AbortController();
        const timeout = window.setTimeout(() => ctrl.abort(), this.loadTimeoutMs);

        try {
            const pos = this.seekTargetSeconds != null ? this.seekTargetSeconds : this.audio.currentTime || 0;
            await this.reinitPipeline(masterUrl, pos, ctrl.signal);
            this.resumeOrPendPlay();
        } catch {
            this.bus.emit('error', new Error('HLS_RECOVERY_FAILED'));
        } finally {
            try {
                clearTimeout(timeout);
            } catch {
            }
        }
    }

    private async reinitPipeline(masterUrl: string, resumeAtSeconds: number, signal: AbortSignal): Promise<void> {
        this.destroyHls();
        if (!this.isDocumentVisible() && isIosWebKit()) {
            /* skip pause — killing audio focus on locked iOS screen */
        } else {
            try {
                if (this.audio.paused !== true) this.audio.pause();
            } catch { }
        }

        if (this.canPlayNativeHls()) {
            await this.setSourceAndWait(masterUrl, signal);
        } else {
            await this.attachWithHlsJs(masterUrl, signal);
        }

        this.audio.volume = this.volume;
        this.audio.playbackRate = this.rate;

        const t = Number(resumeAtSeconds);
        if (Number.isFinite(t) && t >= 0) {
            try {
                this.audio.currentTime = t;
            } catch {
            }
        }
    }

    on<E extends keyof SessionEventMap>(event: E, listener: SessionEventMap[E]): () => void {
        return this.bus.on(event, listener);
    }

    async load(signal: AbortSignal): Promise<void> {
        const res = await this.apiClient.getSongHlsSession(this.trackId, { signal });
        if (signal.aborted) {
            const e = new Error('ABORTED');
            (e as any).name = 'AbortError';
            throw e;
        }

        const masterUrl = res && typeof res.masterUrl === 'string' ? res.masterUrl : '';
        if (!masterUrl) throw new Error('HLS_SESSION_INVALID');

        this.masterUrl = masterUrl;
        this.recovering = false;
        this.recoveryStep = 0;
        this.seekTargetSeconds = null;
        this.seekDeadlineAtMs = null;
        this.lastProgressAtMs = null;
        this.lastProgressTimeSeconds = null;
        this.endedEmitted = false;

        this.bindAudioEvents();
        this.bindVisibilityEvents();

        try {
            const u = new URL(masterUrl, typeof window !== 'undefined' ? window.location.href : undefined);
            const isSameOrigin = typeof window !== 'undefined' && u.origin === window.location.origin;
            this.audio.crossOrigin = isSameOrigin ? '' : 'use-credentials';
        } catch {
            this.audio.crossOrigin = '';
        }
        this.audio.preload = 'metadata';

        if (this.canPlayNativeHls()) {
            await this.setSourceAndWait(masterUrl, signal);
        } else {
            await this.attachWithHlsJs(masterUrl, signal);
        }

        this.audio.volume = this.volume;
        this.audio.playbackRate = this.rate;

        this.startWatchdog();
    }

    private canPlayNativeHls(): boolean {
        try {
            const a = this.audio;
            const v1 = a.canPlayType('application/vnd.apple.mpegurl');
            const v2 = a.canPlayType('application/x-mpegURL');
            return v1 === 'probably' || v1 === 'maybe' || v2 === 'probably' || v2 === 'maybe';
        } catch {
            return false;
        }
    }

    private destroyHls(): void {
        const hls = this.hls;
        this.hls = null;
        if (this.hlsErrorUnsub) {
            try {
                this.hlsErrorUnsub();
            } catch {
            }
            this.hlsErrorUnsub = null;
        }
        if (!hls) return;
        try {
            hls.stopLoad();
        } catch {
        }
        try {
            hls.detachMedia();
        } catch {
        }
        try {
            hls.destroy();
        } catch {
        }
    }

    private async attachWithHlsJs(url: string, signal: AbortSignal): Promise<void> {
        if (signal.aborted) {
            const e = new Error('ABORTED');
            (e as any).name = 'AbortError';
            throw e;
        }

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

            const cleanup = () => {
                if (done) return;
                done = true;

                if (timerId) {
                    try {
                        clearTimeout(timerId);
                    } catch {
                    }
                    timerId = null;
                }

                try {
                    signal.removeEventListener('abort', onAbort);
                } catch {
                }

                if (hls) {
                    try {
                        hls.off(HlsCtor.Events.MANIFEST_PARSED, onReady);
                    } catch {
                    }
                    try {
                        hls.off(HlsCtor.Events.ERROR, onError);
                    } catch {
                    }
                }
            };

            const onAbort = () => {
                cleanup();
                this.destroyHls();
                const e = new Error('ABORTED');
                (e as any).name = 'AbortError';
                reject(e);
            };

            const onTimeout = () => {
                cleanup();
                this.destroyHls();
                reject(new Error('HLSJS_TIMEOUT'));
            };

            const onReady = () => {
                cleanup();
                resolve();
            };

            const onError = (_evt: any, data: any) => {
                const fatal = !!data?.fatal;
                if (!fatal) return;
                cleanup();
                this.destroyHls();
                reject(new Error('HLSJS_FATAL'));
            };

            try {
                signal.addEventListener('abort', onAbort, { once: true });
            } catch {
            }

            timerId = setTimeout(onTimeout, this.loadTimeoutMs);

            const bufferProfile = getAdaptiveBufferProfile();

            try {
                hls = new HlsCtor({
                    enableWorker: true,
                    lowLatencyMode: false,
                    backBufferLength: bufferProfile.backBufferLength,
                    startLevel: -1,
                    maxBufferLength: bufferProfile.maxBufferLength,
                    maxMaxBufferLength: bufferProfile.maxMaxBufferLength,
                    maxBufferHole: 0.3,
                    abrEwmaDefaultEstimate: bufferProfile.abrEwmaDefaultEstimate,
                    xhrSetup: (xhr: any) => {
                        try {
                            xhr.withCredentials = true;
                        } catch {
                        }
                    },
                    fetchSetup: (_ctx: any, init: any) => {
                        const nextInit = init && typeof init === 'object' ? { ...init } : {};
                        (nextInit as any).credentials = 'include';
                        return nextInit;
                    },
                });
            } catch {
                cleanup();
                reject(new Error('HLSJS_INIT_FAILED'));
                return;
            }

            this.hls = hls;

            const onRuntimeError = (_evt: any, data: any) => {
                const code = Number(data?.response?.code ?? data?.response?.status ?? 0);
                if (code !== 401 && code !== 403) return;
                if (this.recovering) return;
                this.recoveryStep = 2;
                void this.tryRecover('unauthorized');
            };

            try {
                hls.on(HlsCtor.Events.ERROR, onRuntimeError);
                this.hlsErrorUnsub = () => {
                    try {
                        hls?.off(HlsCtor.Events.ERROR, onRuntimeError);
                    } catch {
                    }
                };
            } catch {
                this.hlsErrorUnsub = null;
            }

            try {
                hls.on(HlsCtor.Events.MANIFEST_PARSED, onReady);
                hls.on(HlsCtor.Events.ERROR, onError);
            } catch {
                cleanup();
                this.destroyHls();
                reject(new Error('HLSJS_BIND_FAILED'));
                return;
            }

            try {
                hls.attachMedia(this.audio);
                hls.loadSource(url);
            } catch {
                cleanup();
                this.destroyHls();
                reject(new Error('HLSJS_LOAD_FAILED'));
                return;
            }
        });
    }

    private bindAudioEvents(): void {
        this.unsubscribers.forEach((fn) => fn());
        this.unsubscribers = [];

        const onTimeUpdate = () => {
            const t = this.audio.currentTime || 0;
            this.bus.emit('time', t);
            const now = Date.now();
            const lastT = this.lastProgressTimeSeconds;
            if (lastT == null || t > lastT + 0.01) {
                this.lastProgressTimeSeconds = t;
                this.lastProgressAtMs = now;
                if (this.seekTargetSeconds != null) {
                    const target = this.seekTargetSeconds;
                    if (Math.abs(t - target) <= 0.75) {
                        this.seekTargetSeconds = null;
                        this.seekDeadlineAtMs = null;
                    }
                }
            }
        };
        const onDuration = () => {
            const d = Number(this.audio.duration);
            if (Number.isFinite(d) && d > 0) this.bus.emit('duration', d);
        };
        const onSeeked = () => {
            const target = this.seekTargetSeconds;
            const actual = Number(this.audio.currentTime);
            if (target != null && Number.isFinite(actual) && Math.abs(actual - target) > 0.5) {
                this.bus.emit('time', actual);
            }
            this.seekTargetSeconds = null;
            this.seekDeadlineAtMs = null;
            this.lastProgressAtMs = Date.now();
            this.lastProgressTimeSeconds = Number.isFinite(actual) ? actual : null;
        };
        const onEnded = () => {
            const d = Number(this.audio.duration);
            const t = Number(this.audio.currentTime);
            const hasDuration = Number.isFinite(d) && d > 0 && d !== Number.POSITIVE_INFINITY;
            const hasTime = Number.isFinite(t) && t >= 0;

            if (hasDuration && hasTime) {
                const endThresholdSeconds = isIosWebKit() ? 2.0 : 0.75;
                const nearEnd = t >= d - endThresholdSeconds;
                if (!nearEnd && d >= 5 && this.recoveryCountInWindow === 0) {
                    if (!this.isDocumentVisible()) {
                        this.bus.emit('buffering', true);
                        this.pendingPlay = true;
                        this.tryDrainPendingPlay();
                        return;
                    }

                    void this.tryRecover('early_ended');
                    return;
                }
            }

            if (!this.endedEmitted) {
                if (hasDuration && hasTime && d - t > 1.0) {
                    this.bus.emit('duration', Math.max(t, 1.0));
                }
                this.endedEmitted = true;
                this.bus.emit('ended');
            }
        };
        const onPause = () => {
            if (!this.audio.ended) return;
            if (this.endedEmitted) return;
            this.endedEmitted = true;
            this.bus.emit('ended');
        };
        const onWaiting = () => {
            this.bus.emit('buffering', true);
            this.lastProgressAtMs = Date.now();
        };
        const onCanPlay = () => {
            this.bus.emit('buffering', false);
            this.resetProgressTracking();
            this.tryDrainPendingPlay();
        };
        const onPlaying = () => {
            this.bus.emit('buffering', false);
            this.resetProgressTracking();
            this.pendingPlay = false;
        };
        const onError = () => {
            const code = this.audio.error?.code ?? 0;
            this.bus.emit('error', new Error(`HLS_AUDIO_ERROR_${code}`));
        };

        this.audio.addEventListener('timeupdate', onTimeUpdate);
        this.audio.addEventListener('durationchange', onDuration);
        this.audio.addEventListener('seeked', onSeeked);
        this.audio.addEventListener('ended', onEnded);
        this.audio.addEventListener('pause', onPause);
        this.audio.addEventListener('waiting', onWaiting);
        this.audio.addEventListener('stalled', onWaiting);
        this.audio.addEventListener('playing', onPlaying);
        this.audio.addEventListener('canplay', onCanPlay);
        this.audio.addEventListener('loadeddata', onCanPlay);
        this.audio.addEventListener('error', onError);

        this.unsubscribers.push(() => this.audio.removeEventListener('timeupdate', onTimeUpdate));
        this.unsubscribers.push(() => this.audio.removeEventListener('durationchange', onDuration));
        this.unsubscribers.push(() => this.audio.removeEventListener('seeked', onSeeked));
        this.unsubscribers.push(() => this.audio.removeEventListener('ended', onEnded));
        this.unsubscribers.push(() => this.audio.removeEventListener('pause', onPause));
        this.unsubscribers.push(() => this.audio.removeEventListener('waiting', onWaiting));
        this.unsubscribers.push(() => this.audio.removeEventListener('stalled', onWaiting));
        this.unsubscribers.push(() => this.audio.removeEventListener('playing', onPlaying));
        this.unsubscribers.push(() => this.audio.removeEventListener('canplay', onCanPlay));
        this.unsubscribers.push(() => this.audio.removeEventListener('loadeddata', onCanPlay));
        this.unsubscribers.push(() => this.audio.removeEventListener('error', onError));
    }

    private async waitForPlayableState(timeoutMs: number): Promise<boolean> {
        const dur = Number(timeoutMs);
        const timeout = Number.isFinite(dur) && dur > 0 ? dur : 2500;

        const isPlayableNow = () => {
            const rs = Number(this.audio.readyState);
            return Number.isFinite(rs) && rs >= 2;
        };

        if (isPlayableNow()) return true;

        return await new Promise<boolean>((resolve) => {
            let settled = false;
            let timerId: any = null;
            let pollId: any = null;

            const cleanup = () => {
                if (settled) return;
                settled = true;
                if (timerId) {
                    try { clearTimeout(timerId); } catch { }
                    timerId = null;
                }
                if (pollId) {
                    try { clearInterval(pollId); } catch { }
                    pollId = null;
                }
                try { this.audio.removeEventListener('canplay', onOk); } catch { }
                try { this.audio.removeEventListener('playing', onOk); } catch { }
                try { this.audio.removeEventListener('loadeddata', onOk); } catch { }
            };

            const onOk = () => {
                if (!isPlayableNow()) return;
                cleanup();
                resolve(true);
            };

            timerId = setTimeout(() => {
                cleanup();
                resolve(isPlayableNow());
            }, timeout);

            pollId = setInterval(() => {
                if (isPlayableNow()) {
                    onOk();
                }
            }, 200);

            try { this.audio.addEventListener('canplay', onOk); } catch { }
            try { this.audio.addEventListener('playing', onOk); } catch { }
            try { this.audio.addEventListener('loadeddata', onOk); } catch { }
        });
    }

    private async setSourceAndWait(url: string, signal: AbortSignal): Promise<void> {
        if (signal.aborted) {
            const e = new Error('ABORTED');
            (e as any).name = 'AbortError';
            throw e;
        }

        await new Promise<void>((resolve, reject) => {
            let done = false;
            let timerId: any = null;
            let pollId: any = null;

            const isBackground = !this.isDocumentVisible();

            const cleanup = () => {
                if (done) return;
                done = true;
                if (timerId) {
                    try { clearTimeout(timerId); } catch { }
                    timerId = null;
                }
                if (pollId) {
                    try { clearInterval(pollId); } catch { }
                    pollId = null;
                }
                try { this.audio.removeEventListener('loadedmetadata', onReady); } catch { }
                try { this.audio.removeEventListener('canplay', onReady); } catch { }
                try { this.audio.removeEventListener('error', onFail); } catch { }
                try { signal.removeEventListener('abort', onAbort); } catch { }
            };

            const onReady = () => {
                cleanup();
                resolve();
            };

            const tryResolveIfReady = () => {
                if (done) return;
                const rs = Number(this.audio.readyState);
                if (Number.isFinite(rs) && rs >= 1) {
                    onReady();
                }
            };

            const onFail = () => {
                cleanup();
                reject(new Error('HLS_LOAD_FAILED'));
            };

            const onAbort = () => {
                cleanup();
                const e = new Error('ABORTED');
                (e as any).name = 'AbortError';
                reject(e);
            };

            const onTimeout = () => {
                cleanup();
                if (isBackground) {
                    resolve();
                    return;
                }
                reject(new Error('HLS_LOAD_TIMEOUT'));
            };

            try { signal.addEventListener('abort', onAbort, { once: true }); } catch { }
            this.audio.addEventListener('loadedmetadata', onReady, { once: true });
            this.audio.addEventListener('canplay', onReady, { once: true });
            this.audio.addEventListener('error', onFail, { once: true });

            if (isBackground) {
                pollId = setInterval(tryResolveIfReady, 200);
            }

            timerId = setTimeout(onTimeout, isBackground ? 1500 : this.loadTimeoutMs);

            if (!(isBackground && isIosWebKit())) {
                try {
                    this.audio.pause();
                } catch { }
            }

            this.audio.src = url;
            this.audio.load();

            this.tryDrainPendingPlay();

            tryResolveIfReady();
        });
    }

    async play(): Promise<void> {
        const bg = !this.isDocumentVisible();
        if (bg) {
            this.pendingPlay = true;
            try {
                const p = this.audio.play();
                if (p && typeof (p as any).then === 'function') {
                    p.then(
                        () => {
                            this.pendingPlay = false;
                        },
                        () => {
                            this.pendingPlay = true;
                        },
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
        this.pendingPlay = false;
        this.audio.pause();
    }

    async seek(seconds: number): Promise<void> {
        const s = Number(seconds);
        if (!Number.isFinite(s) || s < 0) return;
        const bg = !this.isDocumentVisible();
        const wasPlaying = (() => {
            try {
                return this.audio.paused === false;
            } catch {
                return false;
            }
        })();
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
        this.stopWatchdog();
        this.stopHiddenWatchdog();

        this.unsubscribers.forEach((fn) => fn());
        this.unsubscribers = [];

        if (this.visibilityUnsub) {
            this.visibilityUnsub();
        }

        this.destroyHls();

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
        try {
            const t = Number(this.audio.currentTime);
            return Number.isFinite(t) && t >= 0 ? t : 0;
        } catch {
            return 0;
        }
    }

    getDuration(): number {
        try {
            const d = Number(this.audio.duration);
            return Number.isFinite(d) && d > 0 ? d : 0;
        } catch {
            return 0;
        }
    }

    isPlaying(): boolean {
        try {
            return !this.audio.paused;
        } catch {
            return false;
        }
    }

    getLoudness(): LoudnessInfo | null {
        return null;
    }

    getQualities(): QualityOption[] | null {
        return null;
    }
}

type AdaptiveBufferProfile = {
    backBufferLength: number;
    maxBufferLength: number;
    maxMaxBufferLength: number;
    abrEwmaDefaultEstimate: number;
};

function getAdaptiveBufferProfile(): AdaptiveBufferProfile {
    try {
        const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
        const conn = nav?.connection || nav?.mozConnection || nav?.webkitConnection || null;
        const effectiveType = conn && typeof conn.effectiveType === 'string' ? String(conn.effectiveType) : '';
        const saveData = Boolean(conn?.saveData);

        if (saveData || effectiveType === 'slow-2g' || effectiveType === '2g') {
            return {
                backBufferLength: 30,
                maxBufferLength: 120,
                maxMaxBufferLength: 240,
                abrEwmaDefaultEstimate: 300_000,
            };
        }

        if (effectiveType === '3g') {
            return {
                backBufferLength: 45,
                maxBufferLength: 90,
                maxMaxBufferLength: 180,
                abrEwmaDefaultEstimate: 600_000,
            };
        }

        return {
            backBufferLength: 60,
            maxBufferLength: 60,
            maxMaxBufferLength: 120,
            abrEwmaDefaultEstimate: 1_000_000,
        };
    } catch {
        return {
            backBufferLength: 60,
            maxBufferLength: 60,
            maxMaxBufferLength: 120,
            abrEwmaDefaultEstimate: 1_000_000,
        };
    }
}
