const SLOW_PATH_INTERVAL_MS = 1000;
const PAUSED_SLOW_PATH_MS = 2000;
const MIN_PROGRESS_DELTA = 0.05;

function safeSetProperty(el: HTMLElement | null, prop: string, value: string): void {
    try { el?.style?.setProperty(prop, value); } catch { }
}

export type TimeTrackerSlowPath = (_currentTime: number, _duration: number) => void;

export class PlayerTimeTracker {
    private rafId = 0;
    private slowTimerId: ReturnType<typeof setTimeout> | null = null;
    private audio: HTMLAudioElement | null = null;
    private currentTimeRef: { current: number } | null = null;
    private seekingRef: { current: boolean } | null = null;
    private onSlowPath: TimeTrackerSlowPath | null = null;

    private lastProgress = -1;
    private lastDuration = -1;
    private lastSlowMs = 0;
    private isPaused = false;
    private isHidden = false;

    private boundPlay: (() => void) | null = null;
    private boundPause: (() => void) | null = null;
    private boundVisibility: (() => void) | null = null;

    private root: HTMLElement | null = null;
    private globalBar: HTMLElement | null = null;
    private mobileBar: HTMLElement | null = null;
    private miniBar: HTMLElement | null = null;
    private domQueried = false;

    attach(
        audio: HTMLAudioElement,
        currentTimeRef: { current: number },
        onSlowPath: TimeTrackerSlowPath,
        seekingRef?: { current: boolean },
    ): void {
        this.detach();
        this.audio = audio;
        this.currentTimeRef = currentTimeRef;
        this.seekingRef = seekingRef || null;
        this.onSlowPath = onSlowPath;
        this.lastProgress = -1;
        this.lastDuration = -1;
        this.lastSlowMs = 0;
        this.isPaused = audio.paused;
        this.isHidden = typeof document !== 'undefined' ? document.hidden : false;
        this.domQueried = false;

        this.boundPlay = () => { this.isPaused = false; this.scheduleLoop(); };
        this.boundPause = () => { this.isPaused = true; this.stopRaf(); this.scheduleSlowTimer(); };
        this.boundVisibility = () => {
            const hidden = typeof document !== 'undefined' ? document.hidden : false;
            if (hidden && !this.isHidden) {
                this.isHidden = true;
                this.stopRaf();
                this.scheduleSlowTimer();
            } else if (!hidden && this.isHidden) {
                this.isHidden = false;
                if (!this.isPaused) this.scheduleLoop();
            }
        };

        audio.addEventListener('play', this.boundPlay);
        audio.addEventListener('pause', this.boundPause);
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', this.boundVisibility);
        }

        if (!this.isPaused && !this.isHidden) {
            this.scheduleLoop();
        } else {
            this.scheduleSlowTimer();
        }
    }

    detach(): void {
        this.stopRaf();
        this.stopSlowTimer();

        if (this.audio && this.boundPlay) {
            this.audio.removeEventListener('play', this.boundPlay);
        }
        if (this.audio && this.boundPause) {
            this.audio.removeEventListener('pause', this.boundPause);
        }
        if (typeof document !== 'undefined' && this.boundVisibility) {
            document.removeEventListener('visibilitychange', this.boundVisibility);
        }

        this.audio = null;
        this.currentTimeRef = null;
        this.seekingRef = null;
        this.onSlowPath = null;
        this.boundPlay = null;
        this.boundPause = null;
        this.boundVisibility = null;
    }

    writeExternalProgress(time: number, duration: number): void {
        const t = Number.isFinite(time) && time >= 0 ? time : 0;
        const d = Number.isFinite(duration) && duration > 0 ? duration : 0;
        if (this.currentTimeRef) {
            this.currentTimeRef.current = t;
        }
        if (d > 0) {
            const pct = Math.max(0, Math.min(100, (t / d) * 100));
            this.lastProgress = pct;
            this.applyProgressCss(`${pct.toFixed(3)}%`);
        }
    }

    invalidateDomCache(): void {
        this.root = null;
        this.globalBar = null;
        this.mobileBar = null;
        this.miniBar = null;
        this.domQueried = false;
    }

    private scheduleLoop(): void {
        if (this.rafId || !this.audio) return;
        this.stopSlowTimer();
        this.rafId = requestAnimationFrame(() => this.tick());
    }

    private stopRaf(): void {
        if (this.rafId) {
            try { cancelAnimationFrame(this.rafId); } catch { }
            this.rafId = 0;
        }
    }

    private scheduleSlowTimer(): void {
        this.stopSlowTimer();
        if (!this.audio || !this.onSlowPath) return;
        this.slowTimerId = setTimeout(() => {
            this.slowTimerId = null;
            this.fireSlowPath();
            if (this.isPaused || this.isHidden) {
                this.scheduleSlowTimer();
            }
        }, this.isHidden ? PAUSED_SLOW_PATH_MS : PAUSED_SLOW_PATH_MS);
    }

    private stopSlowTimer(): void {
        if (this.slowTimerId != null) {
            clearTimeout(this.slowTimerId);
            this.slowTimerId = null;
        }
    }

    private tick(): void {
        this.rafId = 0;
        const audio = this.audio;
        if (!audio) return;

        if (this.isPaused || this.isHidden) {
            this.scheduleSlowTimer();
            return;
        }

        const ct = audio.currentTime;
        const rawDur = audio.duration;
        const t = Number.isFinite(ct) && ct >= 0 ? ct : 0;
        const d = Number.isFinite(rawDur) && rawDur > 0 ? rawDur : 0;

        const frozen = this.seekingRef?.current === true
            || audio.seeking === true
            || audio.readyState === 0;

        if (!frozen) {
            if (this.currentTimeRef) {
                this.currentTimeRef.current = t;
            }
            if (d > 0) {
                const pct = Math.max(0, Math.min(100, (t / d) * 100));
                if (Math.abs(pct - this.lastProgress) >= MIN_PROGRESS_DELTA) {
                    this.lastProgress = pct;
                    this.applyProgressCss(`${pct.toFixed(3)}%`);
                }
            }
        }

        this.fireSlowPathIfDue(t, d, frozen);
        this.rafId = requestAnimationFrame(() => this.tick());
    }

    private fireSlowPathIfDue(t: number, d: number, frozen: boolean): void {
        const now = performance.now();
        const durationChanged = Number.isFinite(d) && Math.abs(d - this.lastDuration) > 0.1;
        const slowPathDue = now - this.lastSlowMs >= SLOW_PATH_INTERVAL_MS;

        if ((durationChanged || slowPathDue) && this.onSlowPath) {
            if (durationChanged) this.lastDuration = d;
            if (slowPathDue) this.lastSlowMs = now;
            const effectiveTime = frozen
                ? (this.currentTimeRef ? this.currentTimeRef.current : t)
                : t;
            this.onSlowPath(effectiveTime, d);
        }
    }

    private fireSlowPath(): void {
        const audio = this.audio;
        if (!audio || !this.onSlowPath) return;
        const ct = audio.currentTime;
        const rawDur = audio.duration;
        const t = Number.isFinite(ct) && ct >= 0 ? ct : 0;
        const d = Number.isFinite(rawDur) && rawDur > 0 ? rawDur : 0;
        this.onSlowPath(t, d);
    }

    private applyProgressCss(value: string): void {
        if (typeof document === 'undefined') return;

        if (!this.domQueried) {
            this.domQueried = true;
            this.root = document.documentElement;
        }

        if (!this.globalBar?.isConnected) {
            this.globalBar = document.getElementById('global-progress-bar');
        }
        if (!this.mobileBar?.isConnected) {
            this.mobileBar = document.getElementById('mobile-progress-bar');
        }
        if (!this.miniBar?.isConnected) {
            this.miniBar = document.getElementById('mini-progress-bar');
        }

        safeSetProperty(this.root, '--player-progress', value);
        safeSetProperty(this.globalBar, '--progress', value);
        safeSetProperty(this.mobileBar, '--progress', value);
        safeSetProperty(this.miniBar, '--progress', value);
    }
}
