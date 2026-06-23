class EbapPcmPlayerProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.queue = [];
        this.queuedFrames = 0;
        this.totalPlayed = 0;
        this._ticks = 0;
        this.resamplePos = 0;
        this.starving = true;
        this.paused = false;
        this.playbackRate = 1.0;
        this.thresholdFrames = 0;
        this.fadeVolume = 0; // Для плавного входа
        this.fadeStep = 0.0002; // ~100мс на фейд при 48кГц

        this._postBuf = () => {
            this.port.postMessage({
                t: 'buf',
                frames: this.queuedFrames | 0,
                played: this.totalPlayed,
                sampleRate: sampleRate | 0,
            });
        };

        this.port.onmessage = (event) => {
            const msg = event.data;
            if (!msg) return;

            if (msg.t === 'flush') {
                const flushId = typeof msg.id === 'number' ? msg.id : 0;
                this.queue = [];
                this.queuedFrames = 0;
                this.totalPlayed = 0;
                this.resamplePos = 0;
                this.starving = true;
                this.fadeVolume = 0;
                this._postBuf();
                try {
                    this.port.postMessage({ t: 'flushed', id: flushId });
                } catch {
                }
                return;
            }

            if (msg.t === 'pause') {
                this.paused = !!msg.paused;
                this._postBuf();
                return;
            }

            if (msg.t === 'rate') {
                const r = Number(msg.rate);
                if (Number.isFinite(r) && r > 0) {
                    this.playbackRate = Math.max(0.5, Math.min(2.0, r));
                }
                return;
            }

            if (msg.t === 'pcm' && msg.pcm) {
                let pcm = msg.pcm;
                const channels = msg.channels | 0;
                const inputSampleRate = msg.sampleRate | 0;

                if (channels !== 1 && channels !== 2) return;

                let floatPcm;
                if (pcm instanceof ArrayBuffer) {
                    floatPcm = new Float32Array(pcm);
                } else if (ArrayBuffer.isView(pcm)) {
                    floatPcm = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length);
                } else {
                    return;
                }

                const ratio = (inputSampleRate > 0 && inputSampleRate !== sampleRate)
                    ? inputSampleRate / sampleRate
                    : 1.0;

                const frames = channels === 1 ? floatPcm.length : (floatPcm.length / 2) | 0;
                if (frames <= 0) return;

                const maxQueuedFrames = (sampleRate | 0) * 60;
                if (this.queuedFrames + frames > maxQueuedFrames) {
                    this.port.postMessage({ t: 'overflow' });
                    return;
                }

                this.queue.push({ pcm: floatPcm, channels, ratio, offset: 0, frames });
                this.queuedFrames += frames;
            }
        };
    }

    process(_inputs, outputs) {
        this._ticks = (this._ticks + 1) | 0;

        const out = outputs[0];
        const out0 = out[0];
        const out1 = out.length > 1 ? out[1] : null;

        if (!out0) return true;

        const outputLen = out0.length;

        if (this.paused) {
            out0.fill(0);
            if (out1) out1.fill(0);
            if ((this._ticks & 31) === 0) {
                this._postBuf();
            }
            return true;
        }

        // Инициализация порога буферизации (200мс)
        if (this.thresholdFrames === 0 && sampleRate > 0) {
            this.thresholdFrames = (sampleRate * 0.2) | 0;
        }

        // Если мы "голодаем", ждем пока накопится достаточно фреймов
        if (this.starving) {
            if (this.queuedFrames >= this.thresholdFrames) {
                this.starving = false;
                this.fadeVolume = 0; // Сбрасываем громкость для фейда при выходе из голодания
            } else {
                out0.fill(0);
                if (out1) out1.fill(0);
                if ((this._ticks & 31) === 0) {
                    this._postBuf();
                }
                return true;
            }
        }

        let written = 0;
        let playedFrames = 0;
        while (written < outputLen) {
            const cur = this.queue[0];
            if (!cur) {
                this.starving = true;
                this.fadeVolume = 0;
                out0.fill(0, written);
                if (out1) out1.fill(0, written);
                break;
            }

            const ratio = cur.ratio;
            const pcm = cur.pcm;
            const channels = cur.channels;
            const rate = this.playbackRate;
            const rateFactor = (typeof rate === 'number' && isFinite(rate) && rate > 0) ? rate : 1.0;

            // Для линейной интерполяции на границе блоков нам нужен следующий сэмпл
            const next = this.queue[1];

            if (channels === 1) {
                while (written < outputLen) {
                    const frameIdx = Math.floor(this.resamplePos);
                    const readIdx = cur.offset + frameIdx;

                    if (readIdx >= pcm.length) break;

                    const frac = this.resamplePos - frameIdx;
                    const v0 = pcm[readIdx];
                    let v1;

                    if (readIdx + 1 < pcm.length) {
                        v1 = pcm[readIdx + 1];
                    } else if (next && next.channels === 1) {
                        v1 = next.pcm[0];
                    } else {
                        v1 = v0; // Fallback на границе всей очереди
                    }

                    const v = (v0 + (v1 - v0) * frac) * this.fadeVolume;
                    out0[written] = v;
                    if (out1) out1[written] = v;

                    if (this.fadeVolume < 1) {
                        this.fadeVolume = Math.min(1, this.fadeVolume + this.fadeStep);
                    }

                    written++;
                    playedFrames++;
                    this.resamplePos += ratio * rateFactor;

                    if (this.resamplePos >= 1.0) {
                        const consumed = Math.floor(this.resamplePos);
                        cur.offset += consumed;
                        this.resamplePos -= consumed;
                        this.queuedFrames -= consumed;
                    }
                }
            } else {
                while (written < outputLen) {
                    const frameIdx = Math.floor(this.resamplePos);
                    const readIdx = (cur.offset + frameIdx) * 2;

                    if (readIdx + 1 >= pcm.length) break;

                    const frac = this.resamplePos - frameIdx;

                    // Левый канал
                    const l0 = pcm[readIdx];
                    let l1;
                    if (readIdx + 2 < pcm.length) {
                        l1 = pcm[readIdx + 2];
                    } else if (next && next.channels === 2) {
                        l1 = next.pcm[0];
                    } else {
                        l1 = l0;
                    }
                    out0[written] = (l0 + (l1 - l0) * frac) * this.fadeVolume;

                    // Правый канал
                    if (out1) {
                        const r0 = pcm[readIdx + 1];
                        let r1;
                        if (readIdx + 3 < pcm.length) {
                            r1 = pcm[readIdx + 3];
                        } else if (next && next.channels === 2) {
                            r1 = next.pcm[1];
                        } else {
                            r1 = r0;
                        }
                        out1[written] = (r0 + (r1 - r0) * frac) * this.fadeVolume;
                    }

                    if (this.fadeVolume < 1) {
                        this.fadeVolume = Math.min(1, this.fadeVolume + this.fadeStep);
                    }

                    written++;
                    playedFrames++;
                    this.resamplePos += ratio * rateFactor;

                    if (this.resamplePos >= 1.0) {
                        const consumed = Math.floor(this.resamplePos);
                        cur.offset += consumed;
                        this.resamplePos -= consumed;
                        this.queuedFrames -= consumed;
                    }
                }
            }

            if (cur.offset >= cur.frames) {
                this.queue.shift();
            } else {
                break;
            }
        }

        this.queuedFrames = Math.max(0, this.queuedFrames);
        this.totalPlayed += playedFrames;
        if ((this._ticks & 31) === 0) {
            this._postBuf();
        }

        return true;
    }
}

registerProcessor('ebap-pcm-player', EbapPcmPlayerProcessor);
