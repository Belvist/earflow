import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import apiClient from '../api/client';
import { DEVICE_SYNC_ENABLED } from '../api/runtimeConfig';
import { isStreamTicketMintEnabled, mintWsConnectStreamTicket } from '../auth/streamTicket';
import { recordSyncEvent, updateSyncDiagnosticsState } from '../utils/syncDiagnostics';
import { buildCommandAckFrame, buildNowPlayingWriteState, sendRealtimeJsonFrame } from './deviceSyncTransport';
import {
    readActiveRevision,
    readNowPlayingRevision,
    readNowPlayingUpdatedAt,
} from './deviceSyncRevisionGuard';

/**
 * Device Sync hook (Spotify Connect-like).
 *
 * Design rule (hard): this hook is a DUMB TRANSPORT. It does NOT contain
 * any business logic — every decision lives in device-sync-service.
 *
 * What this hook does:
 *   1) asks the server to register the current device  -> { deviceId }
 *   2) opens a WebSocket with a short-lived ticket
 *   3) forwards WS messages 1:1 into React state + a command callback
 *   4) sends heartbeats / `np:update` / `cmd` without interpreting anything
 *
 * What this hook does NOT do (by design):
 *   - decide "am I active?"     (server answers that in `nowPlaying.deviceId`
 *     and `devices[i].isActive`)
 *   - filter who a command is for  (server routes directed commands to the
 *     exact target socket; broadcasts go to everyone)
 *   - validate ownership, TTL, rate limits, transfer side-effects
 *   - transform now-playing state beyond the shape shipped by the server
 *
 * If a feature needs logic, add it to device-sync-service, not here.
 */

const FEATURE_ENABLED = DEVICE_SYNC_ENABLED;

// sessionStorage key that survives remounts of DeviceSyncBridge but NOT
// cross-tab and NOT the tab close. Exactly what we want: one deviceId per
// tab lifetime. Without this the bridge re-registers on every remount
// (e.g. when a sibling lazy chunk re-suspends) and Redis fills up with
// ghost entries.
const DEVICE_ID_STORAGE_KEY = 'earflow.deviceSync.deviceId.v1';
const CLIENT_KEY_STORAGE = 'earflow.deviceSync.clientKey.v1';

function readStoredDeviceId() {
    try {
        if (typeof sessionStorage === 'undefined') return null;
        const v = sessionStorage.getItem(DEVICE_ID_STORAGE_KEY);
        return typeof v === 'string' && v.length > 0 && v.length < 256 ? v : null;
    } catch {
        return null;
    }
}

function writeStoredDeviceId(id) {
    try {
        if (typeof sessionStorage === 'undefined') return;
        if (id) sessionStorage.setItem(DEVICE_ID_STORAGE_KEY, String(id));
        else sessionStorage.removeItem(DEVICE_ID_STORAGE_KEY);
    } catch {
        /* ignore: quota exceeded / disabled storage */
    }
}

/**
 * Один `clientKey` на origin (localStorage) — все вкладки в этом браузере
 * с тем же `clientKey` попадают в ОДНУ запись в Redis, сервер её только обновляет
 * (см. device-sync-service RegisterDevice + keyUserClientMap), а не создаёт новый UUID.
 * Раньше ключ жил в sessionStorage → у каждой вкладки был свой key → клоны «Windows PC».
 */
function getOrCreateClientInstanceKey() {
    try {
        if (typeof localStorage === 'undefined') return null;
        let k = localStorage.getItem(CLIENT_KEY_STORAGE);
        // миграция с прошлой схемы (sessionStorage) — один раз переносим
        if (!k && typeof sessionStorage !== 'undefined') {
            const legacy = sessionStorage.getItem(CLIENT_KEY_STORAGE);
            if (typeof legacy === 'string' && legacy.length > 0 && legacy.length <= 64) {
                k = legacy;
                try {
                    localStorage.setItem(CLIENT_KEY_STORAGE, k);
                } catch {
                    /* private mode / quota */
                }
            }
        }
        if (typeof k === 'string' && k.length > 0 && k.length <= 64) {
            return k;
        }
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            k = crypto.randomUUID();
        } else {
            k = `c_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
        }
        try {
            localStorage.setItem(CLIENT_KEY_STORAGE, k);
        } catch {
            return null;
        }
        return k;
    } catch {
        return null;
    }
}

function dedupeDevicesById(devices) {
    if (!Array.isArray(devices)) return [];
    const seen = new Set();
    const out = [];
    for (const d of devices) {
        if (!d || typeof d.id !== 'string' || d.id.length === 0) continue;
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        out.push(d);
    }
    return out;
}

const HEARTBEAT_MS = 25_000;
// Ретрай организован как СЕРИИ. Одна серия — несколько быстрых попыток с
// нарастающим бэкоффом; между сериями — длинная пауза, чтобы клиент не
// "долбил" сервер бесконечно, когда сеть или сервис недоступны.
//
//   серия 1: 1s → 2s → 5s → 10s → 20s            (≈ 40s, 5 попыток)
//   пауза 5 минут
//   серия 2: то же самое
//   …
//
// При возврате сети (event 'online') или возвращении пользователя во
// вкладку (visibilitychange:visible после долгого hidden) отложенный
// таймер отменяется и делается немедленная попытка — «мгновенная реакция»
// на восстановление.
const BURST_DELAYS_MS = [2_000, 3_000, 6_000, 12_000, 24_000];
const LONG_PAUSE_MS = 5 * 60 * 1000;
const CONNECT_TIMEOUT_MS = 20_000;
const VISIBILITY_CONNECT_COOLDOWN_MS = 2_500;
const LIST_DEV_DEBOUNCE_MS = 800;
const REALTIME_WAIT_MS = 6_000;
const REALTIME_WAIT_STEP_MS = 200;
/** События `online` и лишние remount-эффекты не должны срывать backoff и плодить ws-ticket. */
const ONLINE_CONNECT_COOLDOWN_MS = 5_000;
/** После 403 на heartbeat: пауза перед перерегистрацией устройства. */
const HEARTBEAT_403_RECONNECT_MS = 8_000;
/** Сколько раз подряд сокет закрылся до onopen — потом стоп: не бесконечный ws-ticket. */
const HANDSHAKE_STORM_THRESHOLD = 10;

// Коды закрытия WS, на которые переподключаться БЕСПОЛЕЗНО (или вредно):
//   1008 Policy Violation — auth/ticket/origin
//   4001..4003 — сервер явно отказал (наш Go-сервис использует эти диапазоны)
//   4008 — rate limit, мы же и нарушитель
const FATAL_CLOSE_CODES = new Set([1008, 4001, 4002, 4003, 4008]);

function detectKind() {
    if (typeof navigator === 'undefined') return 'web';
    const ua = (navigator.userAgent || '').toLowerCase();
    if (/android/.test(ua)) return 'android';
    if (/iphone|ipad|ipod/.test(ua)) return 'ios';
    if (/mobi|tablet/.test(ua)) return 'mobile-web';
    return 'web';
}

function defaultName() {
    if (typeof navigator === 'undefined') return 'Earflow Web';
    const ua = navigator.userAgent || '';
    if (/Android/i.test(ua)) return 'Android';
    if (/iPhone/i.test(ua)) return 'iPhone';
    if (/iPad/i.test(ua)) return 'iPad';
    if (/Macintosh/i.test(ua)) return 'Mac';
    if (/Windows/i.test(ua)) return 'Windows PC';
    if (/Linux/i.test(ua)) return 'Linux';
    return 'Earflow Web';
}

const INITIAL_STATE = Object.freeze({
    enabled: FEATURE_ENABLED,
    ready: false,
    connectionState: 'disconnected',
    deviceId: null,
    devices: [],
    nowPlaying: null,
    timeline: null,
    lease: null,
    transfer: null,
    activeRevision: 0,
    volumeByDevice: {},
    error: null,
});

/**
 * Unified `player_state` frame (PEND-DS-001): single union object with a
 * monotonic frameRev. Returns the state patch, or null if the frame is
 * stale / malformed.
 */
function buildPlayerStatePatch(playerState, lastFrameRevRef, currentState) {
    if (!playerState || typeof playerState !== 'object') return null;
    const frameRev = Number(playerState.frameRev) || 0;
    if (frameRev > 0) {
        if (frameRev <= lastFrameRevRef.current) return null;
        lastFrameRevRef.current = frameRev;
    }
    const activeRevision = readActiveRevision(playerState.activeRevision);
    const currentActiveRevision = readActiveRevision(currentState.activeRevision);
    const patch = {
        nowPlaying: playerState.nowPlaying || null,
        timeline: playerState.timeline || playerState.nowPlaying || null,
        lease: playerState.lease || null,
        transfer: playerState.transfer || null,
        volumeByDevice: playerState.volumeByDevice && typeof playerState.volumeByDevice === 'object'
            ? playerState.volumeByDevice
            : currentState.volumeByDevice || {},
        activeRevision: activeRevision || currentActiveRevision,
    };
    if (Array.isArray(playerState.devices)) {
        patch.devices = dedupeDevicesById(playerState.devices);
    }
    return patch;
}

export default function useDeviceSync({
    isAuthenticated = false,
    onCommand = null,
} = {}) {
    const [state, setState] = useState(INITIAL_STATE);

    const wsRef = useRef(null);
    const mountedRef = useRef(true);
    // Восстанавливаем deviceId из sessionStorage при первом вызове ref,
    // чтобы remount-ы моста не плодили новые устройства. Если сервер уже
    // успел эвиктить наш deviceId (истёк TTL), /ws-ticket вернёт 403 и мы
    // просто перерегистрируемся — defensive, но не шумит.
    const storedDeviceIdRef = useRef(null);
    if (storedDeviceIdRef.current === null) {
        storedDeviceIdRef.current = readStoredDeviceId();
    }
    // Попыток в текущей серии (0..BURST_DELAYS_MS.length-1). После исчерпания
    // серии выставляем longPauseUntilRef и не стартуем новую попытку до него.
    const burstAttemptRef = useRef(0);
    const longPauseUntilRef = useRef(0);
    // Финальная остановка: установлено для 401/403/503 и fatal close-кодов.
    // До следующей перемонтировки хука новых попыток не будет.
    const gaveUpRef = useRef(false);

    const reconnectTimeoutRef = useRef(null);
    const heartbeatIntervalRef = useRef(null);
    const connectionTimeoutRef = useRef(null);
    const deviceIdRef = useRef(storedDeviceIdRef.current);
    const expectedCloseRef = useRef(false);
    const onCommandRef = useRef(onCommand);
    const registerInFlightRef = useRef(null);
    const connectInFlightRef = useRef(false);
    const listDevicesDebounceTRef = useRef(null);
    const lastVisibilityConnectAtRef = useRef(0);
    const lastOnlineConnectAtRef = useRef(0);
    /** Подряд: WS закрылся до onopen (рукопожатие не завершилось) — сильнее бэкофф. */
    const preWsOpenStreakRef = useRef(0);
    const hb403ReconnectTimeoutRef = useRef(null);
    const clientSeqRef = useRef(0);
    /** Последний применённый frameRev `player_state` — отбрасываем устаревшие кадры. */
    const lastFrameRevRef = useRef(0);
    const playerStateFramesRef = useRef(false);
    const stateRef = useRef(state);
    /**
     * Счётчик последовательных auth-ошибок (403/401) на ws-ticket.
     * При >= 3 подряд — gaveUpRef=true, чтобы не долбить сервер.
     * Сбрасывается при успешном ws.onopen.
     */
    const consecutiveAuthFailureRef = useRef(0);

    useEffect(() => { onCommandRef.current = onCommand; }, [onCommand]);
    useEffect(() => { stateRef.current = state; }, [state]);
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const patchState = useCallback((patch) => {
        if (!mountedRef.current) return;
        setState((prev) => ({ ...prev, ...patch }));
    }, []);

    /** 403 на heartbeat = deviceId/сессия не совпали с бэкендом; без сброса — шторм ticket+WS. */
    const onHeartbeatRequestError = useCallback((e) => {
        const st = e && typeof e === 'object' && e !== null ? e.status : 0;
        if (st !== 403 && st !== 404) return;
        if (gaveUpRef.current) return;
        if (hb403ReconnectTimeoutRef.current) return;
        deviceIdRef.current = null;
        writeStoredDeviceId(null);
        patchState({ deviceId: null });
        preWsOpenStreakRef.current = 0;
        hb403ReconnectTimeoutRef.current = setTimeout(() => {
            hb403ReconnectTimeoutRef.current = null;
            if (!mountedRef.current || gaveUpRef.current) return;
            void connectRef.current?.();
        }, HEARTBEAT_403_RECONNECT_MS);
    }, [patchState]);

    const cleanupTransport = useCallback(() => {
        if (hb403ReconnectTimeoutRef.current) {
            clearTimeout(hb403ReconnectTimeoutRef.current);
            hb403ReconnectTimeoutRef.current = null;
        }
        if (listDevicesDebounceTRef.current) {
            clearTimeout(listDevicesDebounceTRef.current);
            listDevicesDebounceTRef.current = null;
        }
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }
        if (heartbeatIntervalRef.current) {
            clearInterval(heartbeatIntervalRef.current);
            heartbeatIntervalRef.current = null;
        }
        if (connectionTimeoutRef.current) {
            clearTimeout(connectionTimeoutRef.current);
            connectionTimeoutRef.current = null;
        }
        if (wsRef.current) {
            try {
                wsRef.current.onclose = null;
                wsRef.current.onmessage = null;
                wsRef.current.onerror = null;
                wsRef.current.onopen = null;
                wsRef.current.close();
            } catch {
                /* noop */
            }
            wsRef.current = null;
        }
    }, []);


    const startHeartbeat = useCallback(() => {
        if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = setInterval(() => {
            const ws = wsRef.current;
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            try {
                ws.send(JSON.stringify({ type: 'heartbeat' }));
            } catch {
                /* noop */
            }
        }, HEARTBEAT_MS);
    }, []);

    // Планирует следующую попытку подключения. Если текущая серия исчерпана —
    // ставит долгую паузу и сбрасывает счётчик, чтобы потом всё началось
    // заново. Все другие решения «надо ли ретраить» принимает caller (обычно
    // onclose или catch-блок connect()).
    const scheduleRetry = useCallback(() => {
        if (!FEATURE_ENABLED || !mountedRef.current || gaveUpRef.current) return;
        // Не ретраим, если у нас нет сети — дождёмся события 'online'.
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            patchState({ connectionState: 'error', error: 'OFFLINE' });
            return;
        }

        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }

        const attempt = burstAttemptRef.current;
        let delay;
        if (attempt < BURST_DELAYS_MS.length) {
            delay = BURST_DELAYS_MS[attempt];
            burstAttemptRef.current = attempt + 1;
            patchState({ connectionState: 'reconnecting' });
        } else {
            // Серия исчерпана — уходим в длинную паузу и обнуляем счётчик.
            delay = LONG_PAUSE_MS;
            burstAttemptRef.current = 0;
            longPauseUntilRef.current = Date.now() + LONG_PAUSE_MS;
            patchState({ connectionState: 'error', error: 'UNREACHABLE' });
        }

        // WS сорвался до onopen: не долбим ticket/ws-ticket+OPTIONS пачками.
        const hs = preWsOpenStreakRef.current;
        if (hs >= 2) {
            delay = Math.max(delay, 12_000);
        }
        if (hs >= 4) {
            delay = Math.max(delay, 60_000);
        }
        if (hs >= 6) {
            delay = LONG_PAUSE_MS;
            preWsOpenStreakRef.current = 0;
            burstAttemptRef.current = 0;
        }

        const jitter = Math.floor(Math.random() * 1000);
        reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null;
            longPauseUntilRef.current = 0;
            void connectRef.current?.();
        }, delay + jitter);
    }, [patchState]);

    // Обёртка для стабильной ссылки на connect() внутри scheduleRetry и
    // обработчиков browser-событий. connect ниже зависит от isAuthenticated,
    // так что сама функция пересоздаётся при смене auth — а ref всегда
    // указывает на актуальную версию.
    const connectRef = useRef(null);

    // Connect: register → ws ticket → WebSocket. The WS `init` frame provides the
    // Ticket 403/404: одна ретрегистрация без «сдался навсегда» из-за устаревшего deviceId.
    const connect = useCallback(async () => {
        if (!FEATURE_ENABLED) {
            patchState({ connectionState: 'disabled', ready: false });
            return;
        }
        if (!isAuthenticated) {
            patchState({ connectionState: 'disconnected', ready: false });
            return;
        }
        if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
            return;
        }
        if (connectInFlightRef.current) {
            return;
        }
        connectInFlightRef.current = true;
        try {
            const attemptConnection = async (allowReregisterOnTicket403) => {
                playerStateFramesRef.current = false;
                patchState({ connectionState: 'connecting', error: null });

                if (!deviceIdRef.current) {
                    if (!registerInFlightRef.current) {
                        const ck = getOrCreateClientInstanceKey();
                        registerInFlightRef.current = apiClient.registerDevice({
                            name: defaultName(),
                            kind: detectKind(),
                            capabilities: {
                                platform: detectKind(),
                                backgroundAudio: false,
                                outputModes: ['browser'],
                            },
                            ...(ck ? { clientKey: ck } : {}),
                        }).finally(() => {
                            registerInFlightRef.current = null;
                        });
                    }
                    const reg = await registerInFlightRef.current;
                    if (!mountedRef.current) return;
                    const did = reg?.device?.id;
                    if (!did) throw new Error('REGISTER_FAILED');
                    deviceIdRef.current = did;
                    writeStoredDeviceId(did);
                    patchState({ deviceId: did });
                } else if (stateRef.current.deviceId !== deviceIdRef.current) {
                    patchState({ deviceId: deviceIdRef.current });
                }

                // Best-effort REST preload so the Devices panel does not flash empty
                // before the WS `init` frame arrives. Failures here are silent: the
                // WS handshake below either succeeds and overwrites state, or fails
                // and triggers the retry path with its own user-visible error.
                try {
                    const listed = await apiClient.listDevices();
                    if (mountedRef.current) {
                        const listedPatch = buildPlayerStatePatch(
                            listed?.playerState, lastFrameRevRef, stateRef.current
                        );
                        if (listedPatch) {
                            playerStateFramesRef.current = Array.isArray(listed?.playerState?.devices);
                            patchState(listedPatch);
                        }
                        if (!listedPatch || !Array.isArray(listed?.playerState?.devices)) {
                            const nextNowPlaying = listed?.nowPlaying || null;
                            updateSyncDiagnosticsState({
                                deviceId: deviceIdRef.current,
                                ownerDeviceId: nextNowPlaying?.deviceId || null,
                                nowPlayingRevision: readNowPlayingRevision(nextNowPlaying),
                                nowPlayingUpdatedAtMs: readNowPlayingUpdatedAt(nextNowPlaying),
                            });
                            patchState({
                                devices: dedupeDevicesById(
                                    Array.isArray(listed?.devices) ? listed.devices : []
                                ),
                                nowPlaying: nextNowPlaying,
                                timeline: nextNowPlaying,
                                lease: listed?.lease || stateRef.current.lease || null,
                            });
                        }
                    }
                } catch {
                    /* WS init will fill the gap */
                }

                let ticket = null;
                if (isStreamTicketMintEnabled()) {
                    try {
                        ticket = await mintWsConnectStreamTicket({
                            deviceId: deviceIdRef.current,
                        });
                    } catch {
                        ticket = null;
                    }
                }

                if (!ticket) {
                    let ticketResp;
                    try {
                        ticketResp = await apiClient.getDeviceWsTicket(deviceIdRef.current);
                    } catch (e) {
                        const st = e && typeof e === 'object' ? e.status : 0;
                        if (st === 403 || st === 404) {
                            // Persistent auth failure — increment counter
                            consecutiveAuthFailureRef.current += 1;
                            if (consecutiveAuthFailureRef.current >= 3) {
                                // Give up after 3 consecutive auth failures
                                gaveUpRef.current = true;
                                patchState({
                                    connectionState: 'error',
                                    error: st === 403 ? 'WS_TICKET_FORBIDDEN' : 'WS_TICKET_NOT_FOUND',
                                });
                                return;
                            }
                            if (allowReregisterOnTicket403) {
                                deviceIdRef.current = null;
                                writeStoredDeviceId(null);
                                return attemptConnection(false);
                            }
                        }
                        throw e;
                    }
                    ticket = ticketResp?.token;
                }

                if (!mountedRef.current) return;
                if (!ticket) throw new Error('NO_TICKET');

                const url = apiClient.getDeviceWebSocketUrl(ticket);
                const ws = new WebSocket(url);
                wsRef.current = ws;
                let sawWsOpen = false;

                connectionTimeoutRef.current = setTimeout(() => {
                    if (ws.readyState !== WebSocket.OPEN) {
                        try { ws.close(); } catch { /* noop */ }
                    }
                }, CONNECT_TIMEOUT_MS);

                ws.onopen = () => {
                    sawWsOpen = true;
                    preWsOpenStreakRef.current = 0;
                    if (connectionTimeoutRef.current) {
                        clearTimeout(connectionTimeoutRef.current);
                        connectionTimeoutRef.current = null;
                    }
                    burstAttemptRef.current = 0;
                    longPauseUntilRef.current = 0;
                    gaveUpRef.current = false;
                    consecutiveAuthFailureRef.current = 0;
                    patchState({ connectionState: 'connected', error: null, ready: true });
                    startHeartbeat();
                };

                ws.onmessage = async (event) => {
                    let msg = null;
                    try {
                        msg = JSON.parse(typeof event.data === 'string' ? event.data : '');
                    } catch {
                        return;
                    }
                    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;

                    switch (msg.type) {
                        case 'player_state': {
                            const patch = buildPlayerStatePatch(msg.playerState, lastFrameRevRef, stateRef.current);
                            if (!patch) break;
                            playerStateFramesRef.current = Array.isArray(msg.playerState?.devices);
                            recordSyncEvent('player_state', {
                                frameRev: lastFrameRevRef.current,
                                ownerDeviceId: patch.nowPlaying?.deviceId || null,
                                activeRevision: patch.activeRevision,
                                trackId: patch.nowPlaying?.trackId || '',
                                isPlaying: patch.nowPlaying?.isPlaying === true,
                            });
                            updateSyncDiagnosticsState({
                                deviceId: deviceIdRef.current,
                                ownerDeviceId: patch.nowPlaying?.deviceId || null,
                                activeRevision: patch.activeRevision,
                                nowPlayingRevision: readNowPlayingRevision(patch.nowPlaying),
                                nowPlayingUpdatedAtMs: readNowPlayingUpdatedAt(patch.nowPlaying),
                            });
                            patchState(patch);
                            break;
                        }
                        case 'init': {
                            const activeRevision = readActiveRevision(
                                msg.activeRevision || msg.nowPlaying?.activeRevision
                            );
                            const currentActiveRevision = readActiveRevision(stateRef.current.activeRevision);
                            const nowPlayingRevision = readNowPlayingRevision(msg.nowPlaying);
                            const nowPlayingUpdatedAtMs = readNowPlayingUpdatedAt(msg.nowPlaying);
                            recordSyncEvent('init', {
                                deviceId: typeof msg.deviceId === 'string' ? msg.deviceId : deviceIdRef.current,
                                ownerDeviceId: msg.nowPlaying?.deviceId || null,
                                activeRevision,
                                nowPlayingRevision,
                                nowPlayingUpdatedAtMs,
                            });
                            updateSyncDiagnosticsState({
                                deviceId: typeof msg.deviceId === 'string' ? msg.deviceId : deviceIdRef.current,
                                ownerDeviceId: msg.nowPlaying?.deviceId || null,
                                activeRevision,
                                nowPlayingRevision,
                                nowPlayingUpdatedAtMs,
                                connectionState: 'connected',
                            });
                            lastFrameRevRef.current = 0;
                            playerStateFramesRef.current = false;
                            const initPlayerStatePatch = buildPlayerStatePatch(
                                msg.playerState, lastFrameRevRef, stateRef.current
                            );
                            if (initPlayerStatePatch) {
                                playerStateFramesRef.current = Array.isArray(msg.playerState?.devices);
                            }
                            patchState({
                                devices: dedupeDevicesById(
                                    Array.isArray(msg.devices) ? msg.devices : []
                                ),
                                nowPlaying: msg.nowPlaying || null,
                                timeline: msg.timeline || msg.nowPlaying || null,
                                lease: msg.lease || null,
                                transfer: msg.transfer || null,
                                activeRevision: activeRevision || currentActiveRevision,
                                ...(initPlayerStatePatch || {}),
                            });
                            break;
                        }
                        case 'devices:active': {
                            if (playerStateFramesRef.current) break;
                            const activeRevision = readActiveRevision(msg.activeRevision);
                            const currentActiveRevision = readActiveRevision(stateRef.current.activeRevision);
                            const activeId = typeof msg.deviceId === 'string' ? msg.deviceId : '';
                            recordSyncEvent('devices:active', {
                                activeDeviceId: activeId || null,
                                previousActiveId: typeof msg.previousActiveId === 'string' ? msg.previousActiveId : null,
                                activeRevision,
                            });
                            updateSyncDiagnosticsState({
                                deviceId: deviceIdRef.current,
                                ownerDeviceId: activeId || null,
                                activeRevision: activeRevision || currentActiveRevision,
                            });
                            // Server-authoritative ownership: do not locally rebuild
                            // devices[].isActive or nowPlaying.deviceId from the bare
                            // devices:active frame. The backend publishes np:update,
                            // lease:update and (when relevant) devices:update right after,
                            // and getServerActiveDeviceId reads lease.holderDeviceId /
                            // nowPlaying.deviceId. We only persist the bumped activeRevision.
                            patchState({ activeRevision: activeRevision || currentActiveRevision });
                            if (listDevicesDebounceTRef.current) {
                                clearTimeout(listDevicesDebounceTRef.current);
                            }
                            listDevicesDebounceTRef.current = setTimeout(() => {
                                listDevicesDebounceTRef.current = null;
                                apiClient.listDevices()
                                    .then((resp) => {
                                        if (!mountedRef.current) return;
                                        const listedActiveRevision = readActiveRevision(
                                            resp?.activeRevision || resp?.nowPlaying?.activeRevision
                                        );
                                        const latestActiveRevision = readActiveRevision(stateRef.current.activeRevision);
                                        patchState({
                                            devices: dedupeDevicesById(
                                                Array.isArray(resp?.devices) ? resp.devices : []
                                            ),
                                            nowPlaying: resp?.nowPlaying || stateRef.current.nowPlaying || null,
                                            activeRevision: listedActiveRevision || latestActiveRevision,
                                        });
                                    })
                                    .catch(() => { });
                            }, LIST_DEV_DEBOUNCE_MS);
                            break;
                        }
                        case 'devices:update': {
                            if (playerStateFramesRef.current) break;
                            if (listDevicesDebounceTRef.current) {
                                clearTimeout(listDevicesDebounceTRef.current);
                            }
                            listDevicesDebounceTRef.current = setTimeout(() => {
                                listDevicesDebounceTRef.current = null;
                                apiClient.listDevices()
                                    .then((resp) => {
                                        if (!mountedRef.current) return;
                                        const listedActiveRevision = readActiveRevision(
                                            resp?.activeRevision || resp?.nowPlaying?.activeRevision
                                        );
                                        const latestActiveRevision = readActiveRevision(stateRef.current.activeRevision);
                                        patchState({
                                            devices: dedupeDevicesById(
                                                Array.isArray(resp?.devices) ? resp.devices : []
                                            ),
                                            nowPlaying: resp?.nowPlaying || stateRef.current.nowPlaying || null,
                                            activeRevision: listedActiveRevision || latestActiveRevision,
                                        });
                                    })
                                    .catch(() => { });
                            }, LIST_DEV_DEBOUNCE_MS);
                            break;
                        }
                        case 'np:update': {
                            if (playerStateFramesRef.current) break;
                            if (msg.state && typeof msg.state === 'object') {
                                const activeRevision = readActiveRevision(
                                    msg.activeRevision || msg.state.activeRevision
                                );
                                const currentActiveRevision = readActiveRevision(stateRef.current.activeRevision);
                                const stateRevision = Number(msg.state.stateRevision);
                                const updatedAtMs = readNowPlayingUpdatedAt(msg.state);
                                recordSyncEvent('np:update', {
                                    ownerDeviceId: msg.state.deviceId || null,
                                    activeRevision,
                                    stateRevision: Number.isFinite(stateRevision) ? stateRevision : 0,
                                    updatedAtMs,
                                    clientSeq: msg.state.clientSeq || 0,
                                    trackId: msg.state.trackId || '',
                                    isPlaying: msg.state.isPlaying === true,
                                });
                                updateSyncDiagnosticsState({
                                    deviceId: deviceIdRef.current,
                                    ownerDeviceId: msg.state.deviceId || null,
                                    activeRevision: activeRevision || currentActiveRevision,
                                    nowPlayingRevision: Number.isFinite(stateRevision) ? stateRevision : 0,
                                    nowPlayingUpdatedAtMs: updatedAtMs,
                                    lastTrackId: msg.state.trackId || '',
                                });
                                patchState({
                                    nowPlaying: msg.state,
                                    timeline: msg.state,
                                    activeRevision: activeRevision || currentActiveRevision,
                                });
                            }
                            break;
                        }
                        case 'timeline:update': {
                            if (playerStateFramesRef.current) break;
                            const activeRevision = readActiveRevision(msg.activeRevision || msg.timeline?.activeRevision);
                            const currentActiveRevision = readActiveRevision(stateRef.current.activeRevision);
                            patchState({
                                timeline: msg.timeline || null,
                                activeRevision: activeRevision || currentActiveRevision,
                            });
                            break;
                        }
                        case 'lease:update': {
                            if (playerStateFramesRef.current) break;
                            const activeRevision = readActiveRevision(msg.activeRevision || msg.lease?.activeRevision);
                            const currentActiveRevision = readActiveRevision(stateRef.current.activeRevision);
                            recordSyncEvent('lease:update', {
                                holderDeviceId: msg.lease?.holderDeviceId || null,
                                activeRevision,
                                leaseRevision: Number(msg.lease?.leaseRevision) || 0,
                            });
                            patchState({
                                lease: msg.lease || null,
                                activeRevision: activeRevision || currentActiveRevision,
                            });
                            break;
                        }
                        case 'transfer:update': {
                            if (playerStateFramesRef.current) break;
                            const activeRevision = readActiveRevision(msg.activeRevision || msg.transfer?.activeRevision);
                            const currentActiveRevision = readActiveRevision(stateRef.current.activeRevision);
                            recordSyncEvent('transfer:update', {
                                transferId: msg.transfer?.transferId || '',
                                phase: msg.transfer?.phase || '',
                                activeRevision,
                            });
                            patchState({
                                transfer: msg.transfer || null,
                                activeRevision: activeRevision || currentActiveRevision,
                            });
                            break;
                        }
                        case 'np:ack': {
                            const accepted = msg.accepted === true;
                            const activeRevision = readActiveRevision(
                                msg.activeRevision || msg.state?.activeRevision
                            );
                            const currentActiveRevision = readActiveRevision(stateRef.current.activeRevision);
                            const stateRevision = readNowPlayingRevision(msg.state);
                            const updatedAtMs = readNowPlayingUpdatedAt(msg.state);
                            recordSyncEvent('np:ack', {
                                accepted,
                                reason: typeof msg.reason === 'string' ? msg.reason : '',
                                deviceId: typeof msg.deviceId === 'string' ? msg.deviceId : deviceIdRef.current,
                                activeRevision,
                                stateRevision,
                                updatedAtMs,
                                clientSeq: msg.state?.clientSeq || 0,
                            });
                            updateSyncDiagnosticsState({
                                lastAckAccepted: accepted,
                                lastAckReason: typeof msg.reason === 'string' ? msg.reason : '',
                                activeRevision: activeRevision || currentActiveRevision,
                                lastAckStateRevision: stateRevision,
                                lastAckUpdatedAtMs: updatedAtMs,
                            });
                            if (activeRevision) {
                                patchState({ activeRevision: activeRevision || currentActiveRevision });
                            }
                            break;
                        }
                        case 'cmd': {
                            const activeRevision = readActiveRevision(msg.activeRevision || msg.payload?.activeRevision);
                            const currentActiveRevision = readActiveRevision(stateRef.current.activeRevision);
                            const cb = onCommandRef.current;
                            let ok = true;
                            let reason = '';
                            if (typeof cb === 'function') {
                                try {
                                    await cb({
                                        cmd: String(msg.cmd || ''),
                                        from: typeof msg.from === 'string' ? msg.from : null,
                                        to: typeof msg.to === 'string' ? msg.to : null,
                                        activeRevision: activeRevision || currentActiveRevision,
                                        payload: msg.payload && typeof msg.payload === 'object' ? msg.payload : {},
                                    });
                                } catch (e) {
                                    ok = false;
                                    reason = e && typeof e === 'object' && e.message ? e.message : 'EXECUTOR_FAILED';
                                }
                            }
                            const ackFrame = buildCommandAckFrame(msg, {
                                ok,
                                reason,
                                activeRevision: activeRevision || currentActiveRevision,
                            });
                            if (ackFrame && (msg.cmd === 'revoke_audio' || msg.cmd === 'transfer')) {
                                sendRealtimeJsonFrame(wsRef.current, ackFrame);
                            }
                            break;
                        }
                        case 'pong':
                            break;
                        default:
                            break;
                    }
                };

                ws.onerror = () => {
                    /* Браузер часто шлёт error перед onclose — не дублируем в state, чтобы не мигать UI */
                };

                ws.onclose = (event) => {
                    if (heartbeatIntervalRef.current) {
                        clearInterval(heartbeatIntervalRef.current);
                        heartbeatIntervalRef.current = null;
                    }
                    if (connectionTimeoutRef.current) {
                        clearTimeout(connectionTimeoutRef.current);
                        connectionTimeoutRef.current = null;
                    }
                    wsRef.current = null;

                    if (expectedCloseRef.current) {
                        expectedCloseRef.current = false;
                        patchState({ connectionState: 'disconnected' });
                        return;
                    }
                    if (!sawWsOpen) {
                        preWsOpenStreakRef.current += 1;
                    }
                    if (!mountedRef.current) return;
                    if (!FEATURE_ENABLED) return;

                    if (preWsOpenStreakRef.current >= HANDSHAKE_STORM_THRESHOLD) {
                        preWsOpenStreakRef.current = 0;
                        burstAttemptRef.current = 0;
                        if (reconnectTimeoutRef.current) {
                            clearTimeout(reconnectTimeoutRef.current);
                            reconnectTimeoutRef.current = null;
                        }
                        gaveUpRef.current = true;
                        patchState({
                            connectionState: 'error',
                            error: 'WS_HANDSHAKE_STORM',
                        });
                        return;
                    }

                    const code = event && typeof event.code === 'number' ? event.code : 0;
                    if (FATAL_CLOSE_CODES.has(code)) {
                        preWsOpenStreakRef.current = 0;
                        gaveUpRef.current = true;
                        patchState({
                            connectionState: 'error',
                            error: `WS_CLOSED_${code}`,
                        });
                        return;
                    }

                    scheduleRetry();
                };
            };

            await attemptConnection(true);
        } catch (err) {
            const status = err && typeof err === 'object' ? err.status : 0;

            if (status === 503 || status === 401) {
                gaveUpRef.current = true;
                patchState({
                    connectionState: status === 503 ? 'disabled' : 'error',
                    error: `HTTP_${status}`,
                });
                return;
            }
            if (status === 403) {
                gaveUpRef.current = true;
                patchState({
                    connectionState: 'error',
                    error: 'HTTP_403',
                });
                return;
            }

            patchState({
                connectionState: 'reconnecting',
                error: err?.message || 'DEVICE_SYNC_FAILED',
            });

            if (isAuthenticated) {
                scheduleRetry();
            }
        } finally {
            connectInFlightRef.current = false;
        }
    }, [isAuthenticated, patchState, startHeartbeat, scheduleRetry, onHeartbeatRequestError]);

    useEffect(() => { connectRef.current = connect; }, [connect]);

    // Auto-connect / teardown based on auth & feature flag. No manual knobs
    // on purpose — the hook should "just work" wherever it's mounted.
    useEffect(() => {
        if (!FEATURE_ENABLED) {
            patchState({ connectionState: 'disabled', ready: false });
            return undefined;
        }
        if (!isAuthenticated) {
            expectedCloseRef.current = true;
            cleanupTransport();
            deviceIdRef.current = null;
            writeStoredDeviceId(null);
            burstAttemptRef.current = 0;
            longPauseUntilRef.current = 0;
            gaveUpRef.current = false;
            patchState({
                connectionState: 'disconnected',
                ready: false,
                deviceId: null,
                devices: [],
                nowPlaying: null,
                timeline: null,
                lease: null,
                transfer: null,
                activeRevision: 0,
                volumeByDevice: {},
            });
            lastFrameRevRef.current = 0;
            playerStateFramesRef.current = false;
            return undefined;
        }
        // Новая сессия (после логина/refresh) — обнуляем штрафные счётчики.
        gaveUpRef.current = false;
        burstAttemptRef.current = 0;
        longPauseUntilRef.current = 0;
        // connect не в deps: смена identity перезапускала эффект → cleanup+connect() → лишние ticket/WS
        void connectRef.current?.();
        return () => {
            expectedCloseRef.current = true;
            cleanupTransport();
        };
    }, [isAuthenticated, cleanupTransport, patchState]);

    // Listen to browser network / visibility events. These change how
    // aggressively we try to reconnect without adding any business logic:
    //
    //   online  → если в долгой паузе или ошибке сети, пробуем прямо сейчас.
    //   offline → отменяем запланированный ретрай; следующий будет после
    //             возврата в online (или после ручного reconnectNow).
    //   visible → если долгая пауза ещё не истекла, но вкладка снова
    //             активна, сокращаем её до 0 и пробуем немедленно.
    useEffect(() => {
        if (!FEATURE_ENABLED) return undefined;
        if (typeof window === 'undefined') return undefined;

        const tryFromOnline = () => {
            if (!mountedRef.current) return;
            if (!isAuthenticated) return;
            if (gaveUpRef.current) return;
            const now = Date.now();
            if (now - lastOnlineConnectAtRef.current < ONLINE_CONNECT_COOLDOWN_MS) {
                return;
            }
            lastOnlineConnectAtRef.current = now;
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }
            longPauseUntilRef.current = 0;
            burstAttemptRef.current = 0;
            void connectRef.current?.();
        };

        const tryFromVisibility = () => {
            try {
                if (document.visibilityState !== 'visible') return;
            } catch {
                return;
            }
            if (!mountedRef.current) return;
            if (!isAuthenticated) return;
            if (gaveUpRef.current) return;
            if (wsRef.current) {
                const rs = wsRef.current.readyState;
                if (rs === WebSocket.OPEN || rs === WebSocket.CONNECTING) return;
            }
            /* Не срываем запланированный backoff — иначе при частом смене вкладок получаем шторм connect() */
            if (reconnectTimeoutRef.current) return;
            const now = Date.now();
            if (now - lastVisibilityConnectAtRef.current < VISIBILITY_CONNECT_COOLDOWN_MS) {
                return;
            }
            lastVisibilityConnectAtRef.current = now;
            const err = String(stateRef.current.error || '');
            if (err === 'UNREACHABLE' || err === 'OFFLINE') {
                longPauseUntilRef.current = 0;
                burstAttemptRef.current = 0;
            }
            void connectRef.current?.();
        };

        const onOnline = () => tryFromOnline();

        const onOffline = () => {
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }
            patchState({ connectionState: 'error', error: 'OFFLINE' });
        };

        const onVisibility = () => {
            try {
                if (document.visibilityState === 'visible') tryFromVisibility();
            } catch {
                /* ignore */
            }
        };

        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        try { document.addEventListener('visibilitychange', onVisibility); } catch { /* ignore */ }

        return () => {
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
            try { document.removeEventListener('visibilitychange', onVisibility); } catch { /* ignore */ }
        };
    }, [isAuthenticated, patchState]);

    const sendRealtimeFrame = useCallback((frame) => {
        return sendRealtimeJsonFrame(wsRef.current, frame);
    }, []);

    // Thin wrappers. No validation here — let the backend speak.
    const reportNowPlaying = useCallback(async (nextState) => {
        if (!FEATURE_ENABLED) return;
        const deviceId = deviceIdRef.current;
        if (!deviceId) {
            recordSyncEvent('np:publish_skipped', { reason: 'NO_DEVICE' });
            return;
        }
        const clientSeq = clientSeqRef.current + 1;
        clientSeqRef.current = clientSeq;
        const clientEventAtMs = Date.now();
        const activeRevision = readActiveRevision(stateRef.current.activeRevision);
        const stateToSend = buildNowPlayingWriteState(nextState, deviceId, clientSeq, clientEventAtMs, activeRevision);
        recordSyncEvent('np:publish', {
            deviceId,
            activeRevision,
            clientSeq,
            clientEventAtMs,
            trackId: stateToSend.trackId || '',
            isPlaying: stateToSend.isPlaying === true,
            positionSec: Number(stateToSend.positionSec) || 0,
        });
        if (sendRealtimeFrame({ type: 'np:update', state: stateToSend })) {
            updateSyncDiagnosticsState({
                deviceId,
                lastPublishedClientSeq: clientSeq,
                lastPublishTransport: 'ws',
            });
            return;
        }
        try {
            const resp = await apiClient.putNowPlaying(stateToSend);
            const accepted = resp?.accepted === true;
            const np = resp?.nowPlaying || null;
            recordSyncEvent('np:ack', {
                accepted,
                reason: typeof resp?.reason === 'string' ? resp.reason : '',
                deviceId,
                activeRevision: readActiveRevision(resp?.activeRevision || np?.activeRevision) || activeRevision,
                stateRevision: readNowPlayingRevision(np),
                updatedAtMs: readNowPlayingUpdatedAt(np),
                clientSeq: np?.clientSeq || clientSeq,
            });
            updateSyncDiagnosticsState({
                deviceId,
                lastPublishedClientSeq: clientSeq,
                lastPublishTransport: 'rest',
                lastAckAccepted: accepted,
                activeRevision: readActiveRevision(resp?.activeRevision || np?.activeRevision) || activeRevision,
                lastAckStateRevision: readNowPlayingRevision(np),
                lastAckUpdatedAtMs: readNowPlayingUpdatedAt(np),
            });
        } catch (e) {
            recordSyncEvent('np:publish_failed', {
                deviceId,
                clientSeq,
                status: e && typeof e === 'object' ? e.status || 0 : 0,
                code: e && typeof e === 'object' ? e.code || '' : '',
            });
            /* best-effort; server is source of truth */
        }
    }, [sendRealtimeFrame]);

    const sendCommand = useCallback(async ({ to = null, cmd, payload = {} } = {}) => {
        if (!FEATURE_ENABLED) return;
        const deviceId = deviceIdRef.current;
        if (!deviceId) return;
        const activeRevision = readActiveRevision(stateRef.current.activeRevision);
        if (sendRealtimeFrame({ type: 'cmd', to, cmd, payload, activeRevision })) {
            return;
        }
        try {
            await apiClient.sendDeviceCommand({ fromDeviceId: deviceId, to, cmd, payload, activeRevision });
        } catch {
            /* surface via subsequent server-pushed state if any */
        }
    }, [sendRealtimeFrame]);

    const ensureRealtimeConnection = useCallback(async () => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) return true;
        burstAttemptRef.current = 0;
        longPauseUntilRef.current = 0;
        gaveUpRef.current = false;
        expectedCloseRef.current = true;
        cleanupTransport();
        expectedCloseRef.current = false;
        void connect();
        const started = Date.now();
        while (Date.now() - started < REALTIME_WAIT_MS) {
            await new Promise((resolve) => setTimeout(resolve, REALTIME_WAIT_STEP_MS));
            const openWs = wsRef.current;
            if (openWs && openWs.readyState === WebSocket.OPEN) return true;
        }
        return false;
    }, [connect, cleanupTransport]);

    const refreshDeviceList = useCallback(async () => {
        if (!FEATURE_ENABLED) return;
        try {
            const listed = await apiClient.listDevices();
            if (!mountedRef.current) return;
            const listedPatch = buildPlayerStatePatch(
                listed?.playerState, lastFrameRevRef, stateRef.current
            );
            if (listedPatch) {
                playerStateFramesRef.current = Array.isArray(listed?.playerState?.devices);
                patchState(listedPatch);
                if (Array.isArray(listedPatch.devices) && listedPatch.devices.length >= 2) {
                    void ensureRealtimeConnection();
                }
                if (Array.isArray(listed?.playerState?.devices)) return;
            }
            const list = dedupeDevicesById(
                Array.isArray(listed?.devices) ? listed.devices : []
            );
            const nextNowPlaying = listed?.nowPlaying || null;
            const nextActiveRevision = readActiveRevision(
                listed?.activeRevision || nextNowPlaying?.activeRevision
            );
            const currentActiveRevision = readActiveRevision(stateRef.current.activeRevision);
            patchState({
                devices: list,
                nowPlaying: nextNowPlaying,
                timeline: nextNowPlaying,
                lease: listed?.lease || stateRef.current.lease || null,
                activeRevision: nextActiveRevision || currentActiveRevision,
            });
            if (list.length >= 2) {
                void ensureRealtimeConnection();
            }
        } catch {
            /* best-effort refresh */
        }
    }, [ensureRealtimeConnection, patchState]);

    const transferTo = useCallback(async (targetDeviceId, options = {}) => {
        if (!FEATURE_ENABLED) return;
        if (!targetDeviceId) return;
        await ensureRealtimeConnection();
        try {
            const idempotencyKey = typeof options.idempotencyKey === 'string'
                ? options.idempotencyKey
                : `web-${deviceIdRef.current || 'unknown'}-${targetDeviceId}-${Date.now()}`;
            await apiClient.transferDevice(targetDeviceId, { ...options, idempotencyKey });
        } catch {
            /* transient; server will broadcast definitive state */
        }
    }, [ensureRealtimeConnection]);

    const removeDevice = useCallback(async (targetDeviceId) => {
        if (!FEATURE_ENABLED) return;
        if (!targetDeviceId) return;
        try {
            await apiClient.removeDevice(targetDeviceId);
        } catch {
            /* ignore */
        }
    }, []);

    const enterRealtime = useCallback(() => {
        if (!FEATURE_ENABLED) return;
        burstAttemptRef.current = 0;
        longPauseUntilRef.current = 0;
        gaveUpRef.current = false;
        expectedCloseRef.current = true;
        cleanupTransport();
        expectedCloseRef.current = false;
        void connect();
    }, [connect, cleanupTransport]);

    const reconnectNow = useCallback(() => {
        if (!FEATURE_ENABLED) return;
        burstAttemptRef.current = 0;
        longPauseUntilRef.current = 0;
        preWsOpenStreakRef.current = 0;
        gaveUpRef.current = false;
        expectedCloseRef.current = true;
        cleanupTransport();
        expectedCloseRef.current = false;
        void connect();
    }, [connect, cleanupTransport]);

    return useMemo(() => ({
        ...state,
        reportNowPlaying,
        sendCommand,
        transferTo,
        removeDevice,
        reconnectNow,
        enterRealtime,
        refreshDeviceList,
    }), [state, reportNowPlaying, sendCommand, transferTo, removeDevice, reconnectNow, enterRealtime, refreshDeviceList]);
}
