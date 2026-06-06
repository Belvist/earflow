let _sharedCtx: AudioContext | null = null;

export function getSharedAudioContext(allowCreate = false): AudioContext | null {
    if (_sharedCtx) {
        if (_sharedCtx.state === 'closed') {
            _sharedCtx = null;
        } else {
            return _sharedCtx;
        }
    }
    if (!allowCreate) return null;
    try {
        _sharedCtx = new AudioContext({ latencyHint: 'playback', sampleRate: 48_000 });
        return _sharedCtx;
    } catch {
        return null;
    }
}

export function prewarmSharedAudioContext(): void {
    const ctx = getSharedAudioContext(true);
    if (!ctx) return;
    if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
    }
}
