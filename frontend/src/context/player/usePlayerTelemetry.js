import { useEffect, useRef } from 'react';

export const usePlayerTelemetry = ({
    enabled = true,
    apiClient,
    playerStatus,
    lastErrorCode,
    activeTrackId,
    playbackEngine,
}) => {
    const prevStatusRef = useRef(null);
    const lastSentKeyRef = useRef('');
    const lastSentAtRef = useRef(0);

    useEffect(() => {
        if (!enabled) return;
        const prev = prevStatusRef.current;
        prevStatusRef.current = playerStatus;

        if (playerStatus !== 'ERROR') return;
        if (prev === 'ERROR') return;

        const api = apiClient || null;
        if (!api || typeof api.logClientError !== 'function') return;

        const codeRaw = typeof lastErrorCode === 'string' ? lastErrorCode : '';
        const code = codeRaw.trim().slice(0, 80);
        const trackId = activeTrackId ? String(activeTrackId).slice(0, 64) : '';
        const engine = typeof playbackEngine === 'string' ? playbackEngine : '';

        const eff = (() => {
            try {
                const c = typeof navigator !== 'undefined' ? navigator.connection : null;
                const t = c && typeof c.effectiveType === 'string' ? c.effectiveType : '';
                return String(t || '').slice(0, 16);
            } catch {
                return '';
            }
        })();

        const key = `${code}:${trackId}:${engine}:${eff}`;
        const now = Date.now();
        if (key && lastSentKeyRef.current === key && now - (lastSentAtRef.current || 0) < 20000) {
            return;
        }
        lastSentKeyRef.current = key;
        lastSentAtRef.current = now;

        api.logClientError({
            code: code || 'UNKNOWN',
            trackId: trackId || null,
            playbackEngine: engine || null,
            effectiveType: eff || null,
            atMs: now,
            userAgent: typeof navigator !== 'undefined' ? String(navigator.userAgent || '').slice(0, 220) : null,
        }).catch(() => { });
    }, [activeTrackId, apiClient, enabled, lastErrorCode, playbackEngine, playerStatus]);
};
