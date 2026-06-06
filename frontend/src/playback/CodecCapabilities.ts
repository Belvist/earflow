type CodecProbeResult = {
    aac: boolean;
    opus: boolean;
    flac: boolean;
};

const MIME_PROBES: Record<keyof CodecProbeResult, string[]> = {
    aac: ['audio/mp4; codecs="mp4a.40.2"', 'audio/aac', 'audio/mp4'],
    opus: ['audio/webm; codecs="opus"', 'audio/ogg; codecs="opus"'],
    flac: ['audio/flac', 'audio/x-flac'],
};

let cached: CodecProbeResult | null = null;

function probeCanPlay(mimeList: string[]): boolean {
    if (typeof document === 'undefined') return false;

    try {
        const audio = document.createElement('audio');
        for (const mime of mimeList) {
            const result = audio.canPlayType(mime);
            if (result === 'probably' || result === 'maybe') return true;
        }
    } catch {
    }

    return false;
}

export function detectCodecCapabilities(): CodecProbeResult {
    if (cached) return cached;

    cached = {
        aac: probeCanPlay(MIME_PROBES.aac),
        opus: probeCanPlay(MIME_PROBES.opus),
        flac: probeCanPlay(MIME_PROBES.flac),
    };

    return cached;
}

export function getSupportedCodecs(): string[] {
    const caps = detectCodecCapabilities();
    const result: string[] = [];
    if (caps.opus) result.push('opus');
    if (caps.aac) result.push('aac');
    if (caps.flac) result.push('flac');
    return result;
}

export function resetCodecCapabilitiesCache(): void {
    cached = null;
}
