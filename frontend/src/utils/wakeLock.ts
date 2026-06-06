type WakeLockSentinel = {
    released: boolean;
    release: () => Promise<void>;
    addEventListener: (type: string, listener: () => void) => void;
    removeEventListener: (type: string, listener: () => void) => void;
};

let activeSentinel: WakeLockSentinel | null = null;
let reacquireOnVisible = false;

function isSupported(): boolean {
    try {
        return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
    } catch {
        return false;
    }
}

function isDocumentVisible(): boolean {
    try {
        return typeof document !== 'undefined' && document.visibilityState === 'visible';
    } catch {
        return true;
    }
}

async function acquire(): Promise<void> {
    if (!isSupported()) return;
    if (activeSentinel && !activeSentinel.released) return;

    try {
        activeSentinel = await (navigator as any).wakeLock.request('screen') as WakeLockSentinel;

        const onRelease = () => {
            if (activeSentinel) {
                try {
                    activeSentinel.removeEventListener('release', onRelease);
                } catch { /* noop */ }
            }
            activeSentinel = null;
        };

        activeSentinel.addEventListener('release', onRelease);
    } catch {
        activeSentinel = null;
    }
}

async function release(): Promise<void> {
    reacquireOnVisible = false;
    const sentinel = activeSentinel;
    activeSentinel = null;
    if (sentinel && !sentinel.released) {
        try {
            await sentinel.release();
        } catch { /* noop */ }
    }
}

function handleVisibilityChange(): void {
    if (!reacquireOnVisible) return;
    if (!isDocumentVisible()) return;
    void acquire();
}

let visibilityBound = false;

function bindVisibility(): void {
    if (visibilityBound) return;
    if (typeof document === 'undefined') return;
    try {
        document.addEventListener('visibilitychange', handleVisibilityChange, { passive: true });
        visibilityBound = true;
    } catch { /* noop */ }
}

function unbindVisibility(): void {
    if (!visibilityBound) return;
    try {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
    } catch { /* noop */ }
    visibilityBound = false;
}

/**
 * @param playing - true to acquire wake lock, false to release
 */
export async function setPlaybackWakeLock(playing: boolean): Promise<void> {
    if (playing) {
        reacquireOnVisible = true;
        bindVisibility();
        await acquire();
    } else {
        reacquireOnVisible = false;
        await release();
    }
}

export function disposeWakeLock(): void {
    reacquireOnVisible = false;
    unbindVisibility();
    void release();
}
