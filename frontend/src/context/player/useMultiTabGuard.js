import { useEffect, useMemo, useRef } from 'react';

const CHANNEL_NAME = 'earflow.player.control.v1';
const LEADER_KEY = 'earflow.player.leader.v1';
const MSG_KEY = 'earflow.player.msg.v1';

function safeNowMs() {
    return Date.now();
}

function isPauseMessageTrusted(msg, tabId) {
    const leaderId = msg?.leaderId;
    const from = msg?.from;
    if (!leaderId || !from) return false;
    if (leaderId !== from) return false;

    const ttlMs = 6_000;
    const now = safeNowMs();
    const rec = getLeaderRecord();
    if (!isLeaderAlive(rec, ttlMs, now)) return true;
    if (rec && rec.id === tabId) return false;
    return rec && rec.id === leaderId;
}

function makeTabId() {
    try {
        const c = typeof window !== 'undefined' ? window.crypto : null;
        if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    } catch {
    }
    return `${safeNowMs()}-${Math.random().toString(16).slice(2)}`;
}

function parseJson(value) {
    if (!value || typeof value !== 'string') return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function getLeaderRecord() {
    try {
        if (typeof window === 'undefined') return null;
        if (typeof window.localStorage === 'undefined') return null;
        return parseJson(window.localStorage.getItem(LEADER_KEY));
    } catch {
        return null;
    }
}

function setLeaderRecord(record) {
    try {
        if (typeof window === 'undefined') return;
        if (typeof window.localStorage === 'undefined') return;
        window.localStorage.setItem(LEADER_KEY, JSON.stringify(record));
    } catch {
    }
}

function clearLeaderRecord(tabId) {
    try {
        if (typeof window === 'undefined') return;
        if (typeof window.localStorage === 'undefined') return;
        const rec = getLeaderRecord();
        if (!rec || rec.id !== tabId) return;
        window.localStorage.removeItem(LEADER_KEY);
    } catch {
    }
}

function isLeaderAlive(record, ttlMs, nowMs) {
    if (!record) return false;
    const ts = Number(record.ts);
    if (!Number.isFinite(ts) || ts <= 0) return false;
    return nowMs - ts <= ttlMs;
}

function tryClaimLeadership(tabId, ttlMs, nowMs) {
    const current = getLeaderRecord();
    if (current && current.id === tabId) {
        setLeaderRecord({ id: tabId, ts: nowMs });
        return true;
    }
    if (isLeaderAlive(current, ttlMs, nowMs)) return false;
    setLeaderRecord({ id: tabId, ts: nowMs });
    const confirm = getLeaderRecord();
    return !!confirm && confirm.id === tabId;
}

function sendStorageMessage(msg) {
    try {
        if (typeof window === 'undefined') return;
        if (typeof window.localStorage === 'undefined') return;
        window.localStorage.setItem(MSG_KEY, JSON.stringify(msg));
        window.localStorage.removeItem(MSG_KEY);
    } catch {
    }
}

export function useMultiTabGuard(params) {
    const enabled = params?.enabled !== false;
    const isPlaying = !!params?.isPlaying;
    const pausePlayback = params?.pausePlayback;
    const userWantsPlaybackRef = params?.userWantsPlaybackRef;

    const tabId = useMemo(() => makeTabId(), []);
    const lastPlayBroadcastAtRef = useRef(0);

    useEffect(() => {
        if (!enabled) return;
        if (typeof window === 'undefined') return;

        const ttlMs = 6_000;
        const heartbeatMs = 2_000;

        let channel = null;
        try {
            if (typeof window.BroadcastChannel === 'function') {
                channel = new window.BroadcastChannel(CHANNEL_NAME);
            }
        } catch {
            channel = null;
        }

        const onControlMessage = (raw) => {
            const msg = raw && typeof raw === 'object' ? raw : null;
            const t = msg?.t;
            const from = msg?.from;
            if (!t || from === tabId) return;

            if (t === 'pause') {
                if (!isPauseMessageTrusted(msg, tabId)) return;
                if (typeof pausePlayback === 'function') pausePlayback();
                return;
            }
        };

        const onStorage = (e) => {
            if (!e) return;
            if (e.key !== MSG_KEY) return;
            const msg = parseJson(e.newValue);
            onControlMessage(msg);
        };

        if (channel) {
            try {
                channel.onmessage = (e) => onControlMessage(e?.data);
            } catch {
            }
        }

        try {
            if (typeof window.addEventListener === 'function') {
                window.addEventListener('storage', onStorage);
            }
        } catch {
        }

        const heartbeat = () => {
            tryClaimLeadership(tabId, ttlMs, safeNowMs());
        };

        let heartbeatId = 0;
        if (isPlaying) {
            heartbeat();
            heartbeatId = window.setInterval(heartbeat, heartbeatMs);
        }

        return () => {
            if (heartbeatId) {
                try {
                    window.clearInterval(heartbeatId);
                } catch {
                }
            }
            clearLeaderRecord(tabId);
            try {
                if (typeof window.removeEventListener === 'function') {
                    window.removeEventListener('storage', onStorage);
                }
            } catch {
            }
            if (channel) {
                try {
                    channel.close();
                } catch {
                }
            }
        };
    }, [enabled, isPlaying, pausePlayback, tabId]);

    useEffect(() => {
        if (!enabled) return;
        if (isPlaying) return;
        clearLeaderRecord(tabId);
    }, [enabled, isPlaying, tabId]);

    useEffect(() => {
        if (!enabled) return;
        if (!isPlaying) return;

        const ttlMs = 6_000;
        const now = safeNowMs();
        const ok = tryClaimLeadership(tabId, ttlMs, now);
        void ok;

        if (!ok) {
            if (typeof pausePlayback === 'function') {
                pausePlayback();
            }
            return;
        }

        const lastAt = lastPlayBroadcastAtRef.current;
        if (lastAt && now - lastAt < 1_000) return;
        lastPlayBroadcastAtRef.current = now;

        const msg = { t: 'pause', from: tabId, leaderId: tabId, ts: now };
        try {
            if (typeof window !== 'undefined' && typeof window.BroadcastChannel === 'function') {
                const c = new window.BroadcastChannel(CHANNEL_NAME);
                try {
                    c.postMessage(msg);
                } finally {
                    c.close();
                }
            }
        } catch {
        }
        sendStorageMessage(msg);
    }, [enabled, isPlaying, pausePlayback, tabId]);

    const isPlayingRef = useRef(false);
    useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

    useEffect(() => {
        if (!enabled) return;
        if (typeof window === 'undefined') return;

        const onPageHide = (e) => {
            const persisted = !!(e && typeof e.persisted === 'boolean' && e.persisted);
            if (!persisted && userWantsPlaybackRef && !isPlayingRef.current) {
                userWantsPlaybackRef.current = false;
            }
            clearLeaderRecord(tabId);
        };

        try {
            window.addEventListener('pagehide', onPageHide);
        } catch {
        }

        return () => {
            try {
                window.removeEventListener('pagehide', onPageHide);
            } catch {
            }
        };
    }, [enabled, tabId, userWantsPlaybackRef]);
}
