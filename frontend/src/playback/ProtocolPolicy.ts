import type { NormalizedTrack, PlaybackProtocol } from './types';

import { detectCapabilities as detectPlatformCaps } from '../utils/platform';
import { ENABLE_DIRECT_STREAM } from '../api/runtimeConfig';

export type Platform = 'ios' | 'android' | 'desktop' | 'unknown';
export type Browser = 'safari' | 'chrome' | 'firefox' | 'edge' | 'other';

export type DeviceCapabilities = {
    platform: Platform;
    browser: Browser;
    hasWebCodecsAudio: boolean;
};

let cached: DeviceCapabilities | null = null;

export function detectCapabilities(): DeviceCapabilities {
    if (cached) return cached;

    const caps = detectPlatformCaps();

    cached = {
        platform: caps.platform,
        browser: caps.browser,
        hasWebCodecsAudio: caps.canUseWebCodecsAudio,
    };

    return cached;
}

export type ProtocolPolicy = {
    allowDesktopHlsFallback: boolean;
};

export const DEFAULT_PROTOCOL_POLICY: ProtocolPolicy = {
    allowDesktopHlsFallback: true,
};

export function selectProtocol(
    _track: NormalizedTrack,
    caps: DeviceCapabilities = detectCapabilities(),
    _policy: ProtocolPolicy = DEFAULT_PROTOCOL_POLICY,
): PlaybackProtocol {
    if (caps.platform === 'ios') {
        return 'hls';
    }

    if (ENABLE_DIRECT_STREAM) {
        return 'direct';
    }

    return 'hls';
}

export function fallbackOrder(
    primary: PlaybackProtocol,
    _track: NormalizedTrack,
    _caps: DeviceCapabilities = detectCapabilities(),
    _policy: ProtocolPolicy = DEFAULT_PROTOCOL_POLICY,
): PlaybackProtocol[] {
    switch (primary) {
        case 'direct':
            return ['hls'];
        case 'hls':
            return ENABLE_DIRECT_STREAM ? ['direct'] : [];
        default:
            return [];
    }
}
