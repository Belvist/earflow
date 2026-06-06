import { useEffect, useCallback, useRef, useMemo, useState } from 'react';
import { useSyncExternalStore } from 'react';
import apiClient from '../api/client';
import { PartySync } from '../player-core/PartySync';
import { decodeBinaryPartyFrames, legacyToBinaryFrames } from '../party/partyWire';
import { usePartyController } from '../party/usePartyController';
import {
    buildPartyConnectError,
    getUserIdFromPartyWsToken,
    resolvePartyFrameUserId,
    takeRememberedPartyWsTicket,
} from './partyConnection';

/**
 * @description Transport-only hook for Listening Party WebSocket.
 * All party state lives in a PartySync instance (vanilla store).
 * React reads state via useSyncExternalStore — zero stale-closure issues.
 *
 * Features preserved from v1:
 * - Exponential backoff reconnection
 * - Heartbeat keep-alive
 * - Ticket-based WS auth
 * - Revision-based dedup
 * - Spotify Jam: queue, participants, permissions, reactions, chat
 */

// Backoff-лестница переподключения WS. Последний шаг — «потолок» (capped) 60s,
// чтобы после долгой потери сети не застревать в максимальной паузе и не
// получать «мёртвую» сессию у гостей.
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 20000, 40000, 60000];
// Более агрессивный heartbeat (15s) — NAT rebinding и прокси на мобильных
// сетях часто закрывают idle-коннект на 30s; 25s не всегда успевает.
const HEARTBEAT_INTERVAL = 15000;
const CONNECTION_TIMEOUT = 10000;
const GUEST_HEAL_SYNC_INTERVAL_MS = 60000;
const GUEST_HEAL_SYNC_COOLDOWN_MS = 45000;
// Через сколько секунд без успешного sync/pong мы считаем WS «тихим» и
// предлагаем UI показать баннер «Переподключаемся…».
const STALE_AFTER_MS = 20000;

export const ConnectionState = {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    RECONNECTING: 'reconnecting',
    ERROR: 'error'
};

function normalizePositionSec(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    if (n < 0) return 0;
    if (n > 86400) {
        const sec = Math.floor(n / 1000);
        return sec > 86400 ? 86400 : sec;
    }
    return n;
}

function getPartyUserId() {
    try {
        if (typeof localStorage !== 'undefined') {
            return String(localStorage.getItem('userId') || '').trim();
        }
    } catch {
        /* ignore */
    }
    return '';
}

function getPartyDisplayName() {
    try {
        if (typeof localStorage !== 'undefined') {
            const r = localStorage.getItem('user');
            if (r) {
                const u = JSON.parse(r);
                return String(u.displayName || u.name || u.username || 'User');
            }
        }
    } catch {
        /* ignore */
    }
    return 'User';
}

function shouldRetryPartyTicketError(error) {
    const e = error && typeof error === 'object' ? error : null;
    const status = Number(e?.status || 0);
    const details = e?.details && typeof e.details === 'object' ? e.details : null;
    const code = String(details?.code || e?.code || '').trim();

    if (code === 'PARTY_NOT_FOUND' || code === 'NOT_AUTHORIZED' || code === 'INVITE_REQUIRED' || code === 'INVITE_INVALID') {
        return false;
    }
    if (status === 429 || status >= 500 || status === 0) {
        return true;
    }
    if (status === 401 || status === 403) {
        return typeof apiClient.isAuthenticated === 'function' ? apiClient.isAuthenticated() : false;
    }
    return false;
}

export default function useParty(partyId, options = {}) {
    const {
        onUserJoined,
        onUserLeft,
        onReaction,
        onChat,
        onPartyEnded,
        onError,
        onPlaybackSync,
        onTrackChange,
        onPlayPause,
        onSeekSync,
        autoConnect = true
    } = options;

    // ── PartySync singleton per hook instance ──
    const syncRef = useRef(null);
    if (!syncRef.current) {
        syncRef.current = new PartySync();
    }
    const sync = syncRef.current;

    // ── Read state reactively ──
    const snapshot = useSyncExternalStore(
        (cb) => sync.subscribe(cb),
        () => sync.getSnapshot(),
        () => sync.getSnapshot()
    );

    // ── Stable callback refs (never cause re-render / re-create WS) ──
    const cbRef = useRef({ onUserJoined, onUserLeft, onReaction, onChat, onPartyEnded, onError, onPlaybackSync, onTrackChange, onPlayPause, onSeekSync });
    cbRef.current = { onUserJoined, onUserLeft, onReaction, onChat, onPartyEnded, onError, onPlaybackSync, onTrackChange, onPlayPause, onSeekSync };

    // ── Transport refs ──
    const wsRef = useRef(null);
    const reconnectAttemptRef = useRef(0);
    const reconnectTimeoutRef = useRef(null);
    const heartbeatIntervalRef = useRef(null);
    const connectionTimeoutRef = useRef(null);
    const isConnectingRef = useRef(false);
    const mountedRef = useRef(true);
    const expectedCloseRef = useRef(false);
    const lastWsUrlRef = useRef('');
    const participantsRefreshTimerRef = useRef(null);
    const participantsRefreshCooldownRef = useRef(0);
    const lastHealSyncAtRef = useRef(0);
    const lastStateRevisionRef = useRef(0);
    const lastQueueRevisionRef = useRef(0);
    const partyUnavailableRef = useRef({ partyId: '', at: 0 });
    const reactionTimeoutsRef = useRef(new Set());
    // Диагностика стабильности: момент последнего успешного серверного сообщения,
    // счётчики разрывов и reconnect-ов. Используется для REST-fallback и
    // локальной телеметрии в консоль/apiClient.logClientError.
    const lastServerMessageAtRef = useRef(0);
    const staleCheckTimerRef = useRef(null);
    const restFallbackInFlightRef = useRef(false);
    const dropsSinceMountRef = useRef(0);
    const reconnectsSinceMountRef = useRef(0);
    const connectedAtMsRef = useRef(0);
    const lastDropReasonRef = useRef('');
    const ticketUserIdRef = useRef('');
    const ignoredCloseSocketsRef = useRef(new WeakSet());

    const [reactionFeed, setReactionFeed] = useState([]);

    const reportTelemetry = useCallback((evt, extra) => {
        try {
            if (typeof console !== 'undefined' && typeof console.debug === 'function') {
                console.debug(`[party] ${evt}`, {
                    partyId: typeof partyId === 'string' ? partyId : String(partyId || ''),
                    drops: dropsSinceMountRef.current,
                    reconnects: reconnectsSinceMountRef.current,
                    lastReason: lastDropReasonRef.current || null,
                    ...extra,
                });
            }
        } catch {
            /* ignore */
        }
    }, [partyId]);

    // ── Helpers ──
    const computeReconnectDelayMs = useCallback((attempt) => {
        const base = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];
        return base + Math.floor(Math.random() * 1000);
    }, []);

    const cleanup = useCallback(() => {
        if (reconnectTimeoutRef.current) { clearTimeout(reconnectTimeoutRef.current); reconnectTimeoutRef.current = null; }
        if (heartbeatIntervalRef.current) { clearInterval(heartbeatIntervalRef.current); heartbeatIntervalRef.current = null; }
        if (connectionTimeoutRef.current) { clearTimeout(connectionTimeoutRef.current); connectionTimeoutRef.current = null; }
        if (participantsRefreshTimerRef.current) { clearTimeout(participantsRefreshTimerRef.current); participantsRefreshTimerRef.current = null; }
        if (reactionTimeoutsRef.current.size) {
            for (const t of reactionTimeoutsRef.current) clearTimeout(t);
            reactionTimeoutsRef.current.clear();
        }
        if (wsRef.current) {
            try {
                ignoredCloseSocketsRef.current.add(wsRef.current);
            } catch {
                /* ignore */
            }
            expectedCloseRef.current = true;
            wsRef.current.onclose = null;
            wsRef.current.close();
            wsRef.current = null;
        }
    }, []);

    const sendMessage = useCallback(
        (message) => {
            if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
                return false;
            }
            const pid = typeof partyId === 'string' ? partyId.trim() : String(partyId != null ? partyId : '').trim();
            const uid = resolvePartyFrameUserId(
                ticketUserIdRef.current,
                sync.getSnapshot().userId,
                getPartyUserId()
            );
            if (!pid || !uid) {
                return false;
            }
            const frames = legacyToBinaryFrames(message, {
                partyId: pid,
                userId: String(uid),
                username: getPartyDisplayName()
            });
            if (!frames.length) {
                return false;
            }
            for (const f of frames) {
                wsRef.current.send(f);
            }
            return true;
        },
        [partyId, sync]
    );

    const scheduleParticipantsRefresh = useCallback(() => {
        const now = Date.now();
        if (participantsRefreshCooldownRef.current && now < participantsRefreshCooldownRef.current) return;
        participantsRefreshCooldownRef.current = now + 1000;
        if (participantsRefreshTimerRef.current) clearTimeout(participantsRefreshTimerRef.current);
        participantsRefreshTimerRef.current = setTimeout(() => {
            participantsRefreshTimerRef.current = null;
            sendMessage({ type: 'get_participants' });
        }, 200);
    }, [sendMessage]);

    const startHeartbeat = useCallback(() => {
        if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = setInterval(() => {
            sendMessage({ type: 'ping' });
        }, HEARTBEAT_INTERVAL);
    }, [sendMessage]);

    // ── Revision dedup ──
    const acceptIfFresh = useCallback((data) => {
        const d = data && typeof data === 'object' ? data : null;
        if (!d) return { ok: true, value: d };

        const rev = Number(d.stateRevision);
        if (Number.isFinite(rev) && rev >= 0) {
            const lastRev = Number(lastStateRevisionRef.current || 0);
            if (lastRev && rev <= lastRev) return { ok: false, value: null };
            lastStateRevisionRef.current = rev;
            if (!lastQueueRevisionRef.current || rev > lastQueueRevisionRef.current) {
                lastQueueRevisionRef.current = rev;
            }
            return { ok: true, value: d };
        }

        const upd = Number(d.updatedAt);
        if (!Number.isFinite(upd) || upd <= 0) return { ok: true, value: d };
        return { ok: true, value: d };
    }, []);

    // ── Message dispatcher (binary msgpack v2 or legacy JSON) ──
    const processServerMessage = useCallback(
        (message) => {
            const cb = cbRef.current;

            // Любое валидное сообщение от сервера считаем «сигналом жизни»:
            // это нужно для REST-fallback, чтобы отличать «затишье при
            // активной партии» от «сервер молчит — покажем баннер».
            lastServerMessageAtRef.current = Date.now();

            switch (message.type) {
                case 'init': {
                    const initData = message.data || {};
                    const initState = initData.state || {};
                    const isHostUser = !!initData.isHost;

                    if (initState.stateRevision !== undefined) {
                        const rev = Number(initState.stateRevision);
                        if (Number.isFinite(rev) && rev >= 0) {
                            lastStateRevisionRef.current = rev;
                            if (!lastQueueRevisionRef.current || rev > lastQueueRevisionRef.current) {
                                lastQueueRevisionRef.current = rev;
                            }
                        }
                    }

                    const pos = normalizePositionSec(initState.position);

                    sync.patch({
                        party: initData.party || null,
                        isHost: isHostUser,
                        userId: initData.userId || null,
                        participantCount: initData.participantCount || 0,
                    });

                    if (initData.queue) sync.patch({ queue: initData.queue });
                    if (initData.participants) sync.patch({ participants: initData.participants });
                    if (initData.permissions) sync.patch({ permissions: { ...sync.getSnapshot().permissions, ...initData.permissions } });

                    sync.applyServerPlayback({
                        trackId: initState.trackId ?? null,
                        trackTitle: initState.trackTitle ?? null,
                        trackArtist: initState.trackArtist ?? null,
                        trackCover: initState.trackCover ?? null,
                        trackDuration: initState.trackDuration ?? 0,
                        isPlaying: !!initState.isPlaying,
                        position: pos !== null ? pos : 0,
                        serverTimestamp: initState.serverTimestamp || Date.now(),
                        stateRevision: initState.stateRevision ?? 0,
                    });

                    if (!isHostUser && initState.trackId) {
                        cb.onPlaybackSync?.(initState, false);
                    }
                    break;
                }

                case 'sync': {
                    const syncDataRaw = message.data;
                    const fresh = acceptIfFresh(syncDataRaw);
                    if (!fresh.ok) break;
                    const syncData = fresh.value || {};
                    const pos = normalizePositionSec(syncData.position);

                    sync.applyServerPlayback({
                        ...syncData,
                        position: pos !== null ? pos : syncData.position,
                        serverTimestamp: syncData.serverTimestamp || Date.now(),
                    });

                    if (!sync.getSnapshot().isHost) {
                        cb.onPlaybackSync?.(syncData, false);
                    }
                    break;
                }

                case 'playback_update': {
                    const raw = message.data;
                    const fresh = acceptIfFresh(raw);
                    if (!fresh.ok) break;
                    const updateData = fresh.value || {};
                    const pos = normalizePositionSec(updateData.position);

                    sync.applyServerPlayback({
                        ...updateData,
                        position: pos !== null ? pos : updateData.position,
                        serverTimestamp: updateData.serverTimestamp || Date.now(),
                    });

                    if (!sync.getSnapshot().isHost) {
                        cb.onPlaybackSync?.(updateData, false);
                    }
                    break;
                }

                case 'seek': {
                    const position = normalizePositionSec(message.data.position);
                    if (position === null) break;
                    const ts = message.data.serverTimestamp || Date.now();

                    sync.applySeek(position, ts);

                    if (!sync.getSnapshot().isHost) {
                        cb.onSeekSync?.(position);
                    }
                    break;
                }

                case 'user_joined':
                    sync.patch({ participantCount: sync.getSnapshot().participantCount + 1 });
                    cb.onUserJoined?.(message.data);
                    scheduleParticipantsRefresh();
                    break;

                case 'user_left':
                    sync.patch({ participantCount: Math.max(0, sync.getSnapshot().participantCount - 1) });
                    cb.onUserLeft?.(message.data);
                    scheduleParticipantsRefresh();
                    break;

                case 'reaction': {
                    const rd = message.data || {};
                    setReactionFeed((prev) => [
                        ...prev.slice(-49),
                        {
                            type: rd.type,
                            userId: rd.userId,
                            username: rd.username,
                            timestamp: rd.timestamp ?? Date.now()
                        }
                    ]);
                    sync.events.emit('reaction', message.data);
                    cb.onReaction?.(message.data);
                    break;
                }

                case 'chat':
                    sync.events.emit('chat', message.data);
                    cb.onChat?.(message.data);
                    break;

                case 'party_ended':
                    expectedCloseRef.current = true;
                    cleanup();
                    sync.patch({ connectionState: 'disconnected' });
                    sync.events.emit('partyEnded', message.data || { reason: 'ENDED' });
                    cb.onPartyEnded?.(message.data);
                    sync.reset();
                    break;

                case 'pong':
                    break;

                case 'error':
                    sync.patch({ error: message });
                    sync.events.emit('error', message);
                    cb.onError?.(message);
                    break;

                case 'queue_updated': {
                    const d = message.data && typeof message.data === 'object' ? message.data : {};
                    const incomingRev = Number(d.stateRevision);
                    if (Number.isFinite(incomingRev) && incomingRev >= 0) {
                        const lastRev = Number(lastQueueRevisionRef.current || 0);
                        if (lastRev && incomingRev <= lastRev) break;
                        lastQueueRevisionRef.current = incomingRev;
                        if (!lastStateRevisionRef.current || incomingRev > lastStateRevisionRef.current) {
                            lastStateRevisionRef.current = incomingRev;
                        }
                    }

                    if (d.queue) {
                        sync.patch({ queue: d.queue });
                    } else if (d.action === 'add' && d.item) {
                        sync.patch({ queue: [...sync.getSnapshot().queue, d.item] });
                    }
                    sync.events.emit('queueUpdated', sync.getSnapshot().queue);
                    break;
                }

                case 'queue': {
                    const d = message.data && typeof message.data === 'object' ? message.data : {};
                    const incomingRev = Number(d.stateRevision);
                    if (Number.isFinite(incomingRev) && incomingRev >= 0) {
                        const lastRev = Number(lastQueueRevisionRef.current || 0);
                        if (lastRev && incomingRev <= lastRev) break;
                        lastQueueRevisionRef.current = incomingRev;
                        if (!lastStateRevisionRef.current || incomingRev > lastStateRevisionRef.current) {
                            lastStateRevisionRef.current = incomingRev;
                        }
                    }
                    sync.patch({ queue: d.queue || [] });
                    sync.events.emit('queueUpdated', sync.getSnapshot().queue);
                    break;
                }

                case 'permissions_updated':
                    sync.patch({ permissions: { ...sync.getSnapshot().permissions, ...(message.data.permissions || {}) } });
                    break;

                case 'participants':
                    sync.patch({ participants: message.data.participants || [] });
                    sync.events.emit('participantsUpdated', sync.getSnapshot().participants);
                    break;

                default:
                    break;
            }
        },
        [sync, cleanup, acceptIfFresh, scheduleParticipantsRefresh, setReactionFeed]
    );

    const handleMessage = useCallback(
        (event) => {
            try {
                const raw = event.data;
                if (raw instanceof ArrayBuffer) {
                    const uid = resolvePartyFrameUserId(
                        ticketUserIdRef.current,
                        sync.getSnapshot().userId,
                        getPartyUserId()
                    );
                    const batch = decodeBinaryPartyFrames(raw, { currentUserId: uid });
                    for (const m of batch) {
                        processServerMessage(m);
                    }
                    return;
                }
                if (typeof raw === 'string') {
                    const message = JSON.parse(raw);
                    processServerMessage(message);
                }
            } catch (_e) {
                void _e;
            }
        },
        [processServerMessage, sync]
    );

    // ── Party unavailable guard ──
    const handlePartyUnavailable = useCallback((pid) => {
        partyUnavailableRef.current = { partyId: pid, at: Date.now() };
        expectedCloseRef.current = true;
        ticketUserIdRef.current = '';
        cleanup();
        sync.reset();

        const payload = { code: 'PARTY_NOT_FOUND', message: 'Party not found', status: 404 };
        sync.patch({ connectionState: 'error', error: payload });
        cbRef.current.onError?.(payload);
        cbRef.current.onPartyEnded?.(payload);
    }, [cleanup, sync]);

    // ── WS connect (ticket-based) ──
    const connectWithTicket = useCallback(async () => {
        let pid = '';
        if (typeof partyId === 'string') pid = partyId.trim();
        else if (partyId != null) pid = String(partyId).trim();
        if (!pid) return;

        const cur = partyUnavailableRef.current;
        if (cur.partyId && cur.partyId !== pid) partyUnavailableRef.current = { partyId: '', at: 0 };
        if (partyUnavailableRef.current.partyId === pid) return;

        if (isConnectingRef.current) return;
        if (wsRef.current) {
            const st = wsRef.current.readyState;
            if (st === WebSocket.OPEN || st === WebSocket.CONNECTING) return;
        }

        isConnectingRef.current = true;
        cleanup();
        expectedCloseRef.current = false;
        sync.patch({ connectionState: 'connecting', error: null });

        let ticket = takeRememberedPartyWsTicket(pid);
        try {
            if (!ticket) {
                const resp = await apiClient.getPartyWsTicket(pid);
                if (resp && typeof resp.ticket === 'string') ticket = resp.ticket;
            }
        } catch (e) {
            const details = e && typeof e === 'object' ? e.details : null;
            const code = details && typeof details === 'object' ? details.code : '';
            if ((e && e.status === 404) && code === 'PARTY_NOT_FOUND') {
                isConnectingRef.current = false;
                handlePartyUnavailable(pid);
                return;
            }
            if (shouldRetryPartyTicketError(e)) {
                isConnectingRef.current = false;
                const attempt = reconnectAttemptRef.current;
                const payload = buildPartyConnectError(e);
                sync.patch({ connectionState: 'reconnecting', error: payload });
                cbRef.current.onError?.(payload);
                if (attempt < RECONNECT_DELAYS.length) {
                    const delay = computeReconnectDelayMs(attempt);
                    reconnectAttemptRef.current = attempt + 1;
                    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
                    reconnectTimeoutRef.current = setTimeout(() => {
                        void connectWithTicket();
                    }, delay);
                } else {
                    sync.patch({ connectionState: 'error', error: { code: 'MAX_RECONNECTS', message: 'Failed to reconnect' } });
                }
                return;
            }
            isConnectingRef.current = false;
            const payload = buildPartyConnectError(e);
            sync.patch({ connectionState: 'error', error: payload });
            cbRef.current.onError?.(payload);
            return;
        }

        if (!ticket) {
            isConnectingRef.current = false;
            const payload = { code: 'WS_TICKET_MISSING', message: 'Party connection ticket is missing' };
            sync.patch({ connectionState: 'error', error: payload });
            cbRef.current.onError?.(payload);
            return;
        }
        ticketUserIdRef.current = getUserIdFromPartyWsToken(ticket);

        try {
            const wsUrlBase = apiClient.getPartyWebSocketUrl(pid);
            const wsUrl = typeof apiClient.getPartyWebSocketUrlWithTicket === 'function'
                ? apiClient.getPartyWebSocketUrlWithTicket(pid, ticket)
                : wsUrlBase;

            lastWsUrlRef.current = wsUrl;
            const ws = new WebSocket(wsUrl);
            try {
                ws.binaryType = 'arraybuffer';
            } catch {
                /* ignore */
            }
            wsRef.current = ws;

            connectionTimeoutRef.current = setTimeout(() => {
                if (ws.readyState !== WebSocket.OPEN) {
                    ws.close();
                    sync.patch({ connectionState: 'error', error: { code: 'CONNECTION_TIMEOUT', message: 'Connection timeout' } });
                }
            }, CONNECTION_TIMEOUT);

            ws.onopen = () => {
                clearTimeout(connectionTimeoutRef.current);
                isConnectingRef.current = false;
                if (!mountedRef.current) { ws.close(); return; }
                sync.patch({ connectionState: 'connected', error: null });
                const now = Date.now();
                if (connectedAtMsRef.current === 0) {
                    connectedAtMsRef.current = now;
                } else {
                    reconnectsSinceMountRef.current += 1;
                }
                lastServerMessageAtRef.current = now;
                reportTelemetry('ws_open', { attempt: reconnectAttemptRef.current });
                reconnectAttemptRef.current = 0;
                startHeartbeat();
                sendMessage({ type: 'sync_request' });
            };

            ws.onmessage = handleMessage;

            ws.onerror = () => {
                if (!mountedRef.current || expectedCloseRef.current) return;
                if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) return;
                const hasSession = typeof apiClient.isAuthenticated === 'function' ? apiClient.isAuthenticated() : false;
                const payload = hasSession
                    ? { code: 'WS_ERROR', message: 'WebSocket connection error', wsUrl: lastWsUrlRef.current || undefined }
                    : { code: 'NO_SESSION', message: 'Authentication required', wsUrl: lastWsUrlRef.current || undefined };
                sync.patch({ connectionState: 'error', error: payload });
                cbRef.current.onError?.(payload);
            };

            ws.onclose = (event) => {
                if (ignoredCloseSocketsRef.current.has(ws)) {
                    return;
                }
                if (wsRef.current && wsRef.current !== ws) {
                    return;
                }
                clearTimeout(connectionTimeoutRef.current);
                clearInterval(heartbeatIntervalRef.current);
                isConnectingRef.current = false;

                dropsSinceMountRef.current += 1;
                lastDropReasonRef.current = `code=${event?.code ?? 0}|clean=${event?.wasClean ? 1 : 0}`;
                reportTelemetry('ws_close', {
                    code: event?.code,
                    wasClean: !!event?.wasClean,
                    reason: typeof event?.reason === 'string' ? event.reason.slice(0, 80) : '',
                });

                if (expectedCloseRef.current) {
                    expectedCloseRef.current = false;
                    sync.patch({ connectionState: 'disconnected' });
                    return;
                }
                if (event.code === 4001 || event.code === 1000) {
                    sync.patch({ connectionState: 'disconnected' });
                    return;
                }

                if (mountedRef.current && reconnectAttemptRef.current === 0) {
                    const payload = {
                        code: 'WS_CLOSED',
                        message: event.code === 1006 ? 'WebSocket disconnected' : 'WebSocket closed',
                        closeCode: event.code, closeReason: event.reason, wasClean: event.wasClean,
                        wsUrl: lastWsUrlRef.current || undefined
                    };
                    sync.patch({ error: payload });
                    cbRef.current.onError?.(payload);
                }

                const hasSession = typeof apiClient.isAuthenticated === 'function' ? apiClient.isAuthenticated() : false;
                if (!hasSession) {
                    const payload = { code: 'NO_SESSION', message: 'Authentication required', wsUrl: lastWsUrlRef.current || undefined };
                    sync.patch({ connectionState: 'error', error: payload });
                    cbRef.current.onError?.(payload);
                    return;
                }

                const attempt = reconnectAttemptRef.current;
                if (attempt < RECONNECT_DELAYS.length) {
                    sync.patch({ connectionState: 'reconnecting' });
                    const delay = computeReconnectDelayMs(attempt);
                    reconnectAttemptRef.current = attempt + 1;
                    reconnectTimeoutRef.current = setTimeout(() => {
                        void connectWithTicket();
                    }, delay);
                } else {
                    sync.patch({ connectionState: 'error', error: { code: 'MAX_RECONNECTS', message: 'Failed to reconnect' } });
                }
            };
        } catch (err) {
            isConnectingRef.current = false;
            sync.patch({ connectionState: 'error', error: { code: 'CONNECTION_FAILED', message: err.message } });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [partyId, cleanup, handleMessage, startHeartbeat, sendMessage, computeReconnectDelayMs, handlePartyUnavailable, sync]);

    const connect = useCallback(() => {
        void connectWithTicket();
    }, [connectWithTicket]);

    const disconnect = useCallback(() => {
        isConnectingRef.current = false;
        expectedCloseRef.current = true;
        ticketUserIdRef.current = '';
        cleanup();
        sync.reset();
    }, [cleanup, sync]);

    // Ручной reconnect для UI-кнопки «Переподключиться» в баннере стабильности.
    // Сбрасывает backoff, выключает текущее (возможно «застрявшее») соединение
    // и немедленно стартует новое.
    const forceReconnect = useCallback(() => {
        if (!partyId) return;
        reconnectAttemptRef.current = 0;
        expectedCloseRef.current = true;
        cleanup();
        expectedCloseRef.current = false;
        sync.patch({ connectionState: 'connecting', error: null });
        void connectWithTicket();
    }, [partyId, cleanup, connectWithTicket, sync]);

    // ── Mount / unmount ──
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    useEffect(() => {
        setReactionFeed([]);
    }, [partyId]);

    // ── Heal sync for guests (periodic re-sync every ~20s) ──
    useEffect(() => {
        if (snapshot.connectionState !== 'connected') return;
        if (snapshot.isHost) return;

        const jitter = 1 + Math.floor(Math.random() * 10000);
        const tId = window.setInterval(() => {
            if (!mountedRef.current) return;
            if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
            const now = Date.now();
            if (lastHealSyncAtRef.current && now - lastHealSyncAtRef.current < GUEST_HEAL_SYNC_COOLDOWN_MS) return;
            lastHealSyncAtRef.current = now;
            sendMessage({ type: 'sync_request' });
        }, GUEST_HEAL_SYNC_INTERVAL_MS + jitter);

        return () => window.clearInterval(tId);
    }, [snapshot.connectionState, snapshot.isHost, sendMessage]);

    // ── Stale-watchdog + REST fallback ──
    // Если WS «молчит» дольше STALE_AFTER_MS (нет ни sync, ни pong), ОДИН раз
    // снимаем серверное состояние через REST, чтобы UI не завис, и пушим
    // снапшот в PartySync. Дальше WS-reconnect восстановит live-канал.
    useEffect(() => {
        if (!partyId) return;
        if (staleCheckTimerRef.current) {
            window.clearInterval(staleCheckTimerRef.current);
            staleCheckTimerRef.current = null;
        }

        const runCheck = async () => {
            if (!mountedRef.current) return;
            const cs = snapshot.connectionState;
            if (cs === 'disconnected') return;
            if (expectedCloseRef.current) return;

            const lastMsgAt = lastServerMessageAtRef.current;
            if (!lastMsgAt) return;
            const idleMs = Date.now() - lastMsgAt;
            if (idleMs < STALE_AFTER_MS + 10000) return;
            if (restFallbackInFlightRef.current) return;

            restFallbackInFlightRef.current = true;
            try {
                const data = await apiClient.getParty(typeof partyId === 'string' ? partyId : String(partyId));
                if (!mountedRef.current) return;
                if (!data || typeof data !== 'object') return;

                const s = data.state || data.playback || {};
                const pos = normalizePositionSec(s.position);
                sync.applyServerPlayback({
                    trackId: s.trackId ?? null,
                    trackTitle: s.trackTitle ?? null,
                    trackArtist: s.trackArtist ?? null,
                    trackCover: s.trackCover ?? null,
                    trackDuration: s.trackDuration ?? 0,
                    isPlaying: !!s.isPlaying,
                    position: pos !== null ? pos : 0,
                    serverTimestamp: s.serverTimestamp || Date.now(),
                    stateRevision: s.stateRevision ?? 0,
                });
                if (Array.isArray(data.queue)) sync.patch({ queue: data.queue });
                if (Array.isArray(data.participants)) sync.patch({ participants: data.participants });
                reportTelemetry('rest_fallback_ok', { idleMs });
            } catch (e) {
                const status = e && typeof e === 'object' ? e.status : 0;
                reportTelemetry('rest_fallback_fail', { idleMs, status });
            } finally {
                restFallbackInFlightRef.current = false;
            }
        };

        staleCheckTimerRef.current = window.setInterval(runCheck, 10000);
        return () => {
            if (staleCheckTimerRef.current) {
                window.clearInterval(staleCheckTimerRef.current);
                staleCheckTimerRef.current = null;
            }
        };
    }, [partyId, snapshot.connectionState, sync, reportTelemetry]);

    // ── Forward PartySync events to legacy callbacks (bridge for old consumers) ──
    useEffect(() => {
        const unsubs = [
            sync.events.on('trackChange', (payload) => {
                if (sync.getSnapshot().isHost) return;
                cbRef.current.onTrackChange?.(payload.trackId, payload.trackInfo);
            }),
            sync.events.on('playPause', (payload) => {
                if (sync.getSnapshot().isHost) return;
                cbRef.current.onPlayPause?.(payload.isPlaying);
            }),
        ];
        return () => { for (const u of unsubs) u(); };
    }, [sync]);

    // ── Stable refs for auto-connect ──
    const connectWithTicketRef = useRef(connectWithTicket);
    const cleanupRef = useRef(cleanup);
    useEffect(() => {
        connectWithTicketRef.current = connectWithTicket;
        cleanupRef.current = cleanup;
    }, [connectWithTicket, cleanup]);

    useEffect(() => {
        if (autoConnect && partyId) {
            void connectWithTicketRef.current();
        }
        return () => { cleanupRef.current(); };
    }, [partyId, autoConnect]);

    // ── Destroy sync on unmount ──
    useEffect(() => {
        return () => { syncRef.current?.destroy(); };
    }, []);

    const diagnosticsRefs = useMemo(() => ({
        lastServerMessageAtRef,
        dropsSinceMountRef,
        reconnectsSinceMountRef,
        reconnectAttemptRef,
        lastDropReasonRef,
    }), []);

    // ── Backward-compatible return shape ──
    return usePartyController({
        snapshot,
        sync,
        sendMessage,
        reactionFeed,
        connect,
        disconnect,
        forceReconnect,
        diagnosticsRefs,
        staleAfterMs: STALE_AFTER_MS,
    });
}
