export function supportsWebCodecsAudio() {
    try {
        if (typeof window === 'undefined') return false;
        if (typeof AudioDecoder === 'undefined') return false;
        if (typeof AudioContext === 'undefined') return false;
        return true;
    } catch {
        return false;
    }
}

export type DetectedPlatform = 'ios' | 'android' | 'desktop' | 'unknown';
export type DetectedBrowser = 'safari' | 'chrome' | 'firefox' | 'edge' | 'other';

export type DetectedCapabilities = {
    platform: DetectedPlatform;
    browser: DetectedBrowser;
    canUseWebCodecsAudio: boolean;
};

function detectBrowser(ua: string): DetectedBrowser {
    if (/Edg\//i.test(ua)) return 'edge';
    if (/Firefox\//i.test(ua)) return 'firefox';
    if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) return 'chrome';
    if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua) && !/Chromium\//i.test(ua)) return 'safari';
    return 'other';
}

function detectPlatform(ua: string): DetectedPlatform {
    if (/iPad|iPhone|iPod/i.test(ua)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    if (/Windows|Macintosh|Linux|CrOS/i.test(ua) && !/Mobile/i.test(ua)) return 'desktop';
    return 'unknown';
}

export function detectCapabilities(): DetectedCapabilities {
    try {
        if (typeof navigator === 'undefined') {
            return { platform: 'unknown', browser: 'other', canUseWebCodecsAudio: false };
        }

        const ua = String(navigator.userAgent || '');
        const browser = detectBrowser(ua);
        const platform = detectPlatform(ua);

        const canUse = browser !== 'firefox' && supportsWebCodecsAudio();
        return { platform, browser, canUseWebCodecsAudio: canUse };
    } catch {
        return { platform: 'unknown', browser: 'other', canUseWebCodecsAudio: false };
    }
}

export function canUseWebCodecsAudio(): boolean {
    const caps = detectCapabilities();
    return caps.canUseWebCodecsAudio;
}

export function hasUserActivation() {
    try {
        if (typeof navigator === 'undefined') return false;
        const ua = (navigator as unknown as { userActivation?: { hasBeenActive?: unknown } }).userActivation;
        if (ua && typeof ua.hasBeenActive === 'boolean') {
            return ua.hasBeenActive;
        }
        return false;
    } catch {
        return false;
    }
}

export function isMobileBrowser(): boolean {
    try {
        if (typeof navigator === 'undefined') return false;

        const nav = navigator as unknown as {
            userAgent?: unknown;
            userAgentData?: { mobile?: unknown };
        };

        const mobile = nav.userAgentData && typeof nav.userAgentData.mobile === 'boolean'
            ? nav.userAgentData.mobile
            : null;
        if (mobile !== null) return mobile;

        const ua = typeof nav.userAgent === 'string' ? nav.userAgent : '';
        return /Android|iPhone|iPad|iPod/i.test(ua);
    } catch {
        return false;
    }
}

export function isIosWebKit(): boolean {
    try {
        if (typeof navigator === 'undefined') return false;
        const ua = String(navigator.userAgent || '');
        const isAppleMobile = /iPad|iPhone|iPod/i.test(ua);
        const isIpadOsDesktop = /Macintosh/i.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document;
        const isIOS = isAppleMobile || isIpadOsDesktop;
        const isWebKit = /AppleWebKit/i.test(ua);
        return isIOS && isWebKit;
    } catch {
        return false;
    }
}

export function isIosSafari(): boolean {
    return isIosWebKit();
}
