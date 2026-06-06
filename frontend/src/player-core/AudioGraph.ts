const EQ_FREQS = [60, 170, 310, 600, 1000, 10000, 16000] as const;
const EQ_INDEX_MAP = [0, 1, 2, 3, 4, 7, 9] as const;
const HEADROOM_DB = 1.5;
const FIXED_PREAMP_DB = 3;
const FIXED_PREAMP_LINEAR = Math.pow(10, FIXED_PREAMP_DB / 20);

function safeDisconnect(node: AudioNode | null): void {
    if (!node) return;
    try { node.disconnect(); } catch { }
}

export type AudioGraphParams = {
    audio: HTMLAudioElement;
    ctx: AudioContext;
    volume: number;
    eqEnabled: boolean;
    eqGains: readonly number[];
};

export type AudioGraphResult = {
    finalNode: GainNode | null;
    sourceConnected: boolean;
    mainGainValue: number;
};

export class AudioGraph {
    private source: MediaElementAudioSourceNode | null = null;
    private preampGain: GainNode | null = null;
    private mainGain: GainNode | null = null;
    private fadeGain: GainNode | null = null;
    private fadeTarget = 1;
    private filters: BiquadFilterNode[] = [];
    private graphCtx: AudioContext | null = null;
    private graphAudioEl: HTMLAudioElement | null = null;

    get hasSource(): boolean {
        return this.source !== null;
    }

    get mainGainNode(): GainNode | null {
        return this.mainGain;
    }

    get fadeGainNode(): GainNode | null {
        return this.fadeGain;
    }

    resetForNewContext(): void {
        this.source = null;
        this.preampGain = null;
        this.mainGain = null;
        this.fadeGain = null;
        this.filters = [];
        this.fadeTarget = 1;
    }

    rebuild(params: AudioGraphParams): AudioGraphResult {
        const { audio, ctx, volume, eqEnabled, eqGains } = params;

        if (this.graphAudioEl && this.graphAudioEl !== audio) {
            this.source = null;
        }
        this.graphAudioEl = audio;

        if (this.graphCtx && this.graphCtx !== ctx) {
            this.source = null;
            this.mainGain = null;
            this.fadeGain = null;
            this.filters = [];
            this.fadeTarget = 1;
        }
        this.graphCtx = ctx;

        const safeVol = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;

        if (!this.source) {
            try {
                this.source = ctx.createMediaElementSource(audio);
            } catch (e: unknown) {
                const name = e && typeof e === 'object' ? (e as { name?: string }).name : '';
                if (name !== 'InvalidStateError') {
                    this.source = null;
                }
            }
        }

        if (!this.preampGain) {
            this.preampGain = ctx.createGain();
            this.preampGain.gain.value = FIXED_PREAMP_LINEAR;
        }

        if (!this.mainGain) {
            this.mainGain = ctx.createGain();
        }

        this.disconnectAll();

        let chainStart: BiquadFilterNode | null = null;

        if (eqEnabled) {
            if (this.filters.length !== EQ_FREQS.length) {
                this.filters = EQ_FREQS.map((freq) => {
                    const f = ctx.createBiquadFilter();
                    f.type = 'peaking';
                    f.frequency.value = freq;
                    f.Q.value = 1;
                    f.gain.value = 0;
                    return f;
                });
            }

            const effectiveGains = this.getEffectiveEqGains(eqGains);
            for (let i = 0; i < this.filters.length; i++) {
                try { this.filters[i].gain.value = effectiveGains[i]; } catch { }
            }

            for (let i = 0; i < this.filters.length - 1; i++) {
                try { this.filters[i].connect(this.filters[i + 1]); } catch { }
            }
            chainStart = this.filters[0];
        }

        const connectToInput = (node: AudioNode | null): void => {
            if (!node) return;
            if (chainStart) {
                node.connect(chainStart);
            } else if (this.preampGain) {
                node.connect(this.preampGain);
            } else if (this.mainGain) {
                node.connect(this.mainGain);
            }
        };

        if (this.source) {
            connectToInput(this.source);
        }

        if (chainStart && this.preampGain) {
            const last = this.filters[this.filters.length - 1];
            last.connect(this.preampGain);
        } else if (chainStart && this.mainGain) {
            const last = this.filters[this.filters.length - 1];
            last.connect(this.mainGain);
        }

        if (this.preampGain && this.mainGain) {
            try { this.preampGain.connect(this.mainGain); } catch { }
        }

        const mainGainValue = (eqEnabled ? AudioGraph.computeHeadroomGain(this.getEffectiveEqGains(eqGains)) : 1) * safeVol;
        this.mainGain.gain.value = mainGainValue;

        const finalNode: GainNode = this.mainGain;

        if (!this.fadeGain) {
            this.fadeGain = ctx.createGain();
            this.fadeGain.gain.value = 1;
            this.fadeTarget = 1;
        }

        try { finalNode.connect(this.fadeGain); } catch { }

        return {
            finalNode: this.fadeGain,
            sourceConnected: this.source !== null,
            mainGainValue,
        };
    }

    disconnectForNativeFallback(ctx: AudioContext): void {
        safeDisconnect(this.source);
        this.filters.forEach(safeDisconnect);
        safeDisconnect(this.preampGain);
        safeDisconnect(this.mainGain);
        safeDisconnect(this.fadeGain);

        if (this.source) {
            try { this.source.connect(ctx.destination); } catch { }
        }
    }

    applyEqSettings(eqEnabled: boolean, eqGains: readonly number[], volume: number): void {
        if (this.mainGain) {
            const safeVol = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
            const effectiveGains = this.getEffectiveEqGains(eqGains);
            this.mainGain.gain.value = (eqEnabled ? AudioGraph.computeHeadroomGain(effectiveGains) : 1) * safeVol;
        }
        if (!eqEnabled) return;
        if (this.filters.length !== EQ_FREQS.length) return;
        const effectiveGains = this.getEffectiveEqGains(eqGains);
        for (let i = 0; i < this.filters.length; i++) {
            try { this.filters[i].gain.value = effectiveGains[i]; } catch { }
        }
    }

    setFadeGain(target: number, rampMs = 80): void {
        const ctx = this.graphCtx;
        const node = this.fadeGain;
        if (!ctx || !node) {
            if (Number.isFinite(target)) this.fadeTarget = target;
            return;
        }

        const clamped = Math.max(0, Math.min(1, target));
        if (Math.abs(this.fadeTarget - clamped) < 0.0001) return;
        this.fadeTarget = clamped;

        const t0 = ctx.currentTime;
        const dur = Math.max(0, rampMs) / 1000;
        try {
            const current = Number(node.gain.value);
            node.gain.cancelScheduledValues(t0);
            node.gain.setValueAtTime(Number.isFinite(current) ? current : 1, t0);
            if (dur <= 0) {
                node.gain.setValueAtTime(clamped, t0);
                return;
            }
            node.gain.linearRampToValueAtTime(clamped, t0 + dur);
        } catch { }
    }

    fadeOut(rampMs = 80): void {
        this.setFadeGain(0, rampMs);
    }

    fadeIn(rampMs = 80): void {
        this.setFadeGain(1, rampMs);
    }

    primeFadeFromSilence(): void {
        const ctx = this.graphCtx;
        const node = this.fadeGain;
        if (!ctx || !node) {
            this.fadeTarget = 0;
            return;
        }
        try {
            const t0 = ctx.currentTime;
            node.gain.cancelScheduledValues(t0);
            node.gain.setValueAtTime(0, t0);
            this.fadeTarget = 0;
        } catch { }
    }

    connectFadeToDestination(destination: AudioNode): void {
        if (!this.fadeGain) return;
        try { this.fadeGain.disconnect(); } catch { }
        try { this.fadeGain.connect(destination); } catch { }
    }

    static computeHeadroomGain(gains: readonly number[]): number {
        const maxBoostDb = Math.max(0, ...gains.map((v) => (Number.isFinite(v) ? v : 0)));
        return Math.pow(10, -(maxBoostDb + HEADROOM_DB) / 20);
    }

    getEffectiveEqGains(rawGains: readonly number[]): number[] {
        const src = Array.isArray(rawGains) ? rawGains : [];
        return EQ_INDEX_MAP.map((idx) => {
            const g = Number(src[idx] ?? 0);
            return Number.isFinite(g) ? Math.max(-12, Math.min(12, g)) : 0;
        });
    }

    private disconnectAll(): void {
        if (this.source) try { this.source.disconnect(); } catch { }
        this.filters.forEach(safeDisconnect);
        safeDisconnect(this.preampGain);
        safeDisconnect(this.mainGain);
        safeDisconnect(this.fadeGain);
    }
}
