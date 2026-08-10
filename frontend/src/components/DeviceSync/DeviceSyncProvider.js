import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import apiClient from '../../api/client';
import { DEVICE_SYNC_ENABLED } from '../../api/runtimeConfig';
import { DeviceSyncContext } from '../../context/DeviceSyncContext';
import useAuth from '../../hooks/useAuth';

import { usePlayer } from '../../context/PlayerContext';
import useDeviceSync from '../../hooks/useDeviceSync';
import {
    SILENT_SHADOW_TICK_MS,
    buildSilentShadowSnapshot,
    getNowPlayingRevision,
    getServerActiveDeviceId,
    isDeviceSyncTransferInFlight,
    isSelfActiveDevice,
    normalizeTrackId,
    planSilentShadowReconciliation,
    persistPlaybackResumePoint,
    readPlayerDurationSec,
    readPlayerPositionSec,
    readPlayerTrackId,
    readTimelineIsPlaying,
    resolveAuthoritativePlayback,
    shouldClaimLocalPlayback,
} from './deviceSyncPlayback';
import {
    markNowPlayingSnapshotPublished,
    shouldPublishNowPlayingSnapshot,
} from './nowPlayingPublishPolicy';

const DEVICE_SYNC_START_DELAY_MS = 2500;

function scheduleDeferredStart(onStart) {
    if (typeof window === 'undefined') return () => undefined;
    let timeoutId = 0;
    let idleId = 0;
    let done = false;
    const run = () => {
        if (done) return;
        done = true;
        if (timeoutId) window.clearTimeout(timeoutId);
        onStart();
    };
    timeoutId = window.setTimeout(run, DEVICE_SYNC_START_DELAY_MS);
    if (typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(run, { timeout: DEVICE_SYNC_START_DELAY_MS });
    }
    return () => {
        done = true;
        if (timeoutId) window.clearTimeout(timeoutId);
        if (idleId && typeof window.cancelIdleCallback === 'function') {
            window.cancelIdleCallback(idleId);
        }
    };
}

function isPartyRuntimeActive(player) {
    return Boolean(player?.partyMode || player?.activePartyId || player?.party?.id);
}

function buildPublishSnapshot(player, deviceId) {
    const t = player?.currentTrack;
    if (!t || !t.id) return null;
    const cover = (() => {
        try { return apiClient.getCoverUrl(t) || ''; } catch { return ''; }
    })();
    return {
        trackId: String(t.id),
        title: typeof t.title === 'string' ? t.title : '',
        artist: typeof t.artist === 'string' ? t.artist : '',
        cover,
        durationSec: Math.max(0, Math.floor(readPlayerDurationSec(player))),
        isPlaying: !!player.isPlaying,
        positionSec: Math.max(0, Math.floor(readPlayerPositionSec(player))),
        deviceId: deviceId || '',
        queueSource: typeof player.queueSource === 'string' ? player.queueSource : '',
        queueName: typeof player.queueName === 'string' ? player.queueName : '',
    };
}

/**
 * Один useDeviceSync на всё приложение + контекст для профиля / плеера.
 */
export default function DeviceSyncProvider({ children }) {
    const { isAuthenticated } = useAuth();
    const player = usePlayer();
    const [transportActive, setTransportActive] = React.useState(false);

    const playerRef = useRef(player);
    useEffect(() => { playerRef.current = player; }, [player]);
    const deviceRef = useRef(null);

    const onCommand = useCallback(async (frame) => {
        const p = playerRef.current;
        if (!p || !frame || typeof frame !== 'object') return;

        const cmd = String(frame.cmd || '').toLowerCase();
        const payload = (frame.payload && typeof frame.payload === 'object') ? frame.payload : {};

        switch (cmd) {
            case 'revoke_audio': {
                if (typeof p.suspendLocalOutput === 'function') {
                    await p.suspendLocalOutput('revoked');
                } else if (p.isPlaying && typeof p.pausePlayback === 'function') {
                    await p.pausePlayback();
                }
                // DECISIONS 2026-08-10 TrackSync/#2: snapshot.nowPlaying уже в payload
                // (backend piggyback). НЕ применяем silent load здесь — это
                // перезапишет локальный player до того как activate-приёмник
                // успеет корректно resume'ить, давая race «reset to 0». Вместо
                // этого просто держим локальный текст unchanged (player still
                // на паузе от suspendLocalOutput), а snapshot вступит в силу
                // через обычный flow player_state frame.
                return;
            }
            case 'pause':
                if (typeof p.projectPlaybackUiState === 'function') {
                    p.projectPlaybackUiState(false);
                }
                if (p.isPlaying && typeof p.pausePlayback === 'function') await p.pausePlayback();
                return;
            case 'play':
                if (typeof p.projectPlaybackUiState === 'function') {
                    p.projectPlaybackUiState(true);
                }
                if (!p.isPlaying && p.currentTrack && typeof p.resumePlayback === 'function') await p.resumePlayback();
                return;
            case 'next':
                if (typeof p.playNextTrack === 'function') await p.playNextTrack();
                return;
            case 'previous':
                if (typeof p.playPreviousTrack === 'function') await p.playPreviousTrack();
                return;
            case 'seek': {
                const pos = Number(payload.positionSec);
                if (Number.isFinite(pos) && pos >= 0 && typeof p.seekToPosition === 'function') {
                    await p.seekToPosition(Math.floor(pos * 1000));
                }
                return;
            }
            case 'transfer': {
                if (typeof p.setLocalOutputState === 'function') {
                    p.setLocalOutputState('ACTIVE');
                }
                const shouldResume = payload.resume !== false;
                const sourceNowPlaying = payload.nowPlaying && typeof payload.nowPlaying === 'object'
                    ? payload.nowPlaying
                    : deviceRef.current?.nowPlaying;
                const remoteSnapshot = buildSilentShadowSnapshot(sourceNowPlaying);
                const remoteTrackId = normalizeTrackId(remoteSnapshot?.trackId);
                // localTrackId/localPositionSec доступны по месту через p.*.

                // DECISIONS 2026-08-10 TrackSync/#2: piggyback'd snapshot всегда
                // authoritative. Если у нас ЕСТЬ snapshot — применяем его
                // полностью (trackId+pos+isPlaying), не «silent». Это ключевая
                // разница от прежнего поведения: сервер уже знает куда мы
                // переходим.
                if (remoteSnapshot && remoteTrackId && typeof p.applyRemotePlayback === 'function') {
                    const applyPayload = {
                        ...remoteSnapshot,
                        isPlaying: shouldResume,
                    };
                    const ok = await p.applyRemotePlayback(applyPayload, { silent: false });
                    if (!ok) throw new Error('REMOTE_APPLY_FAILED');
                    return;
                }

                if (!shouldResume && p.isPlaying && typeof p.pausePlayback === 'function') {
                    await p.pausePlayback();
                    return;
                }

                if (shouldResume && p.currentTrack && typeof p.resumePlayback === 'function') {
                    await p.resumePlayback();
                }
                return;
            }
            case 'set_volume': {
                const v = Number(payload.volume);
                if (Number.isFinite(v) && v >= 0 && v <= 1 && typeof p.setVolume === 'function') await p.setVolume(v);
                return;
            }
            default:
        }
    }, []);

    useEffect(() => {
        if (!DEVICE_SYNC_ENABLED || !isAuthenticated) {
            setTransportActive(false);
            return undefined;
        }
        setTransportActive(false);
        return scheduleDeferredStart(() => setTransportActive(true));
    }, [isAuthenticated]);

    const device = useDeviceSync({ isAuthenticated: Boolean(isAuthenticated && transportActive), onCommand });
    useEffect(() => { deviceRef.current = device; }, [device]);
    const {
        enabled: deviceEnabled,
        ready: deviceReady,
        deviceId: localDeviceId,
        activeRevision,
        transfer,
        sendCommand,
        reportNowPlaying,
    } = device;

    const isActiveOnServer = useMemo(() => {
        return isSelfActiveDevice(device.deviceId, device.devices, device.nowPlaying, device.lease);
    }, [device.deviceId, device.devices, device.nowPlaying, device.lease]);
    const serverActiveDeviceId = useMemo(() => {
        return getServerActiveDeviceId(device.devices, device.nowPlaying, device.lease);
    }, [device.devices, device.nowPlaying, device.lease]);

    /**
     * Server-driven local output enforcement only. The frontend does NOT decide
     * who the active output is; it executes the lease/active state the backend
     * has authored. If the server says "another device is active" or "my lease
     * is SUSPENDED/REVOKED/LOST/INTERRUPTED", we mute local audio. There is no
     * auto-claim: claiming ownership is a `play` intent that the backend turns
     * into a transfer (Spotify-style transfer-on-play).
     */
    useEffect(() => {
        if (!device.enabled) return;
        if (!device.ready) return;
        if (!device.deviceId) return;
        if (isPartyRuntimeActive(playerRef.current)) return;
        if (!serverActiveDeviceId) return;
        if (serverActiveDeviceId === device.deviceId) return;
        if (isDeviceSyncTransferInFlight(device.transfer)) return;

        const leaseState = device.lease?.deviceStates?.[device.deviceId];
        if (leaseState && !['SUSPENDED', 'REVOKED', 'LOST', 'INTERRUPTED'].includes(String(leaseState))) {
            return;
        }
        const p = playerRef.current;
        if (typeof p?.suspendLocalOutput === 'function') {
            p.suspendLocalOutput('suspended');
        } else if (p?.isPlaying && typeof p.pausePlayback === 'function') {
            p.pausePlayback();
        }
    }, [device.enabled, device.ready, device.deviceId, serverActiveDeviceId, device.lease, device.transfer]);

    useEffect(() => {
        if (!device.enabled || !device.ready || !device.deviceId) return;
        const leaseState = device.lease?.deviceStates?.[device.deviceId];
        if (!leaseState) return;
        const p = playerRef.current;
        if (typeof p?.setLocalOutputState === 'function') {
            p.setLocalOutputState(leaseState);
        }
        if (['SUSPENDED', 'REVOKED', 'LOST', 'INTERRUPTED'].includes(String(leaseState))) {
            if (typeof p?.suspendLocalOutput === 'function') {
                p.suspendLocalOutput(leaseState === 'REVOKED' ? 'revoked' : 'suspended');
            }
        }
    }, [device.enabled, device.ready, device.deviceId, device.lease, device.transfer]);

    const silentShadowRef = useRef({
        alignInFlight: false,
        lastSeekAtMs: 0,
        trackId: '',
        revision: '',
    });
    const projectedUiIsPlayingRef = useRef(null);

    const readPlaybackState = useCallback(() => {
        const d = deviceRef.current;
        return resolveAuthoritativePlayback(d?.timeline, d?.nowPlaying);
    }, []);

    const projectGlobalPlaybackUi = useCallback((nowPlaying) => {
        if (isActiveOnServer) return;
        const trackId = normalizeTrackId(nowPlaying?.trackId);
        if (!trackId) return;
        const globalIsPlaying = readTimelineIsPlaying(nowPlaying);
        if (projectedUiIsPlayingRef.current === globalIsPlaying) return;
        projectedUiIsPlayingRef.current = globalIsPlaying;
        const p = playerRef.current;
        if (typeof p?.projectPlaybackUiState === 'function') {
            p.projectPlaybackUiState(globalIsPlaying);
        }
    }, [isActiveOnServer]);

    useEffect(() => {
        if (!device.enabled || !device.ready || !device.deviceId) return;
        if (isPartyRuntimeActive(playerRef.current)) return;
        projectGlobalPlaybackUi(readPlaybackState());
    }, [
        device.enabled,
        device.ready,
        device.deviceId,
        device.nowPlaying,
        device.timeline,
        projectGlobalPlaybackUi,
        readPlaybackState,
    ]);

    useEffect(() => {
        if (!device.enabled || !device.ready || !device.deviceId) return;

        const nowPlaying = readPlaybackState();
        const snapshot = buildSilentShadowSnapshot(nowPlaying);
        if (!snapshot) return;
        if (isPartyRuntimeActive(playerRef.current)) return;

        const shadow = silentShadowRef.current;
        if (isActiveOnServer) {
            shadow.trackId = '';
            shadow.revision = '';
            projectedUiIsPlayingRef.current = null;
            return;
        }

        const p = playerRef.current;
        if (!p) return;

        const localTrackId = readPlayerTrackId(p);
        const revision = getNowPlayingRevision(nowPlaying);
        const plan = planSilentShadowReconciliation({
            snapshot,
            localTrackId,
            localPositionSec: readPlayerPositionSec(p),
            previousTrackId: shadow.trackId,
            previousRevision: shadow.revision,
            revision,
        });

        if (!plan || !plan.shouldProjectPosition) {
            return;
        }

        shadow.trackId = plan.trackId;
        shadow.revision = plan.revision;

        if (plan.shouldApplyTrack && typeof p.applyRemotePlayback === 'function') {
            if (shadow.alignInFlight) return;
            shadow.alignInFlight = true;
            Promise.resolve(p.applyRemotePlayback(snapshot, { silent: true }))
                .then((ok) => {
                    if (ok) persistPlaybackResumePoint(plan.trackId, plan.remotePositionSec);
                })
                .finally(() => { shadow.alignInFlight = false; });
            return;
        }

        if (p.currentTimeRef && typeof p.currentTimeRef === 'object') {
            p.currentTimeRef.current = plan.remotePositionSec;
        }

        const nowMs = Date.now();
        if (
            plan.shouldSeekLocalSink
            && nowMs - shadow.lastSeekAtMs >= SILENT_SHADOW_TICK_MS
        ) {
            shadow.lastSeekAtMs = nowMs;
            if (typeof p.seekToPosition === 'function') {
                try {
                    p.seekToPosition(Math.floor(plan.remotePositionSec * 1000));
                } catch {
                    /* keep UI projection even if local sink seek fails */
                }
            }
        }

        persistPlaybackResumePoint(plan.trackId, plan.remotePositionSec);
    }, [device.enabled, device.ready, device.deviceId, device.nowPlaying, device.timeline, isActiveOnServer, readPlaybackState]);

    useEffect(() => {
        if (!device.enabled || !device.ready || !device.deviceId) return undefined;
        if (isActiveOnServer) return undefined;
        if (isPartyRuntimeActive(playerRef.current)) return undefined;

        const tick = () => {
            const p = playerRef.current;
            if (!p) return;
            const nowPlaying = readPlaybackState();
            const trackId = normalizeTrackId(nowPlaying?.trackId);
            if (!trackId) return;

            projectGlobalPlaybackUi(nowPlaying);

            if (nowPlaying?.isPlaying !== true) return;

            const nextSnapshot = buildSilentShadowSnapshot(nowPlaying);
            if (!nextSnapshot) return;
            const positionSec = Number(nextSnapshot.positionSec) || 0;
            if (p.currentTimeRef && typeof p.currentTimeRef === 'object') {
                p.currentTimeRef.current = positionSec;
            }
            persistPlaybackResumePoint(trackId, positionSec);
        };

        tick();
        const id = window.setInterval(tick, SILENT_SHADOW_TICK_MS);
        return () => {
            window.clearInterval(id);
        };
    }, [device.enabled, device.ready, device.deviceId, device.nowPlaying, device.timeline, isActiveOnServer, projectGlobalPlaybackUi, readPlaybackState]);

    const pushRef = useRef({
        lastAtMs: 0,
        lastTrackId: null,
        lastIsPlaying: null,
        lastPositionSec: -1,
    });
    const localPlaybackClaimRef = useRef({
        key: '',
        atMs: 0,
    });

    const snapshot = useMemo(() => buildPublishSnapshot(player, localDeviceId), [player, localDeviceId]);

    useEffect(() => {
        const p = playerRef.current;
        if (!p || isPartyRuntimeActive(p)) return;
        if (typeof sendCommand !== 'function') return;
        if (!snapshot) return;
        if (!shouldClaimLocalPlayback({
            deviceEnabled,
            deviceReady,
            deviceId: localDeviceId,
            isActiveOnServer,
            transfer,
            player: p,
        })) {
            return;
        }

        const trackId = readPlayerTrackId(p);
        const claimKey = [
            localDeviceId,
            trackId,
            serverActiveDeviceId || 'none',
            activeRevision || 0,
        ].join(':');
        const now = Date.now();
        const lastClaim = localPlaybackClaimRef.current;
        if (lastClaim.key === claimKey && now - lastClaim.atMs < 5_000) {
            return;
        }
        localPlaybackClaimRef.current = { key: claimKey, atMs: now };
        sendCommand({
            cmd: 'play',
            payload: {
                nowPlaying: {
                    ...snapshot,
                    isPlaying: true,
                    clientEventAtMs: now,
                },
            },
        });
    }, [
        deviceEnabled,
        deviceReady,
        localDeviceId,
        activeRevision,
        transfer,
        sendCommand,
        isActiveOnServer,
        serverActiveDeviceId,
        player.isPlaying,
        player.currentTrack?.id,
        player.intent,
        snapshot,
    ]);

    const publishNowPlayingIfDue = useCallback(() => {
        if (!deviceEnabled || !deviceReady || !localDeviceId) return;
        if (!snapshot) return;
        if (isPartyRuntimeActive(playerRef.current)) return;
        if (!isActiveOnServer) return;

        const last = pushRef.current;
        const now = Date.now();
        if (!shouldPublishNowPlayingSnapshot(last, snapshot, now)) return;

        markNowPlayingSnapshotPublished(last, snapshot, now);
        reportNowPlaying(snapshot);
    }, [snapshot, deviceEnabled, deviceReady, localDeviceId, reportNowPlaying, isActiveOnServer]);

    // Event-driven only: publish snapshot changes synchronously. No periodic
    // ticker — shouldPublishNowPlayingSnapshot already returns false unless a
    // real event (track change, play/pause toggle, position drift) happened.
    useEffect(() => {
        publishNowPlayingIfDue();
    }, [publishNowPlayingIfDue]);

    return (
        <DeviceSyncContext.Provider value={device}>
            {children}
        </DeviceSyncContext.Provider>
    );
}

