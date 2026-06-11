import {
    readNowPlayingRevision,
    readNowPlayingUpdatedAt,
} from '../../hooks/deviceSyncRevisionGuard';

export const SILENT_SHADOW_TICK_MS = 1_000;
export const SILENT_SHADOW_ALIGN_SEC = 2;
export const SILENT_SHADOW_SEEK_SEC = 6;

export function normalizeTrackId(value) {
    if (value == null) return '';
    return String(value).trim();
}

export function readPlayerTrackId(player) {
    return normalizeTrackId(player?.currentTrack?.id);
}

export function readPlayerPositionSec(player) {
    if (player && typeof player.getCurrentPositionMs === 'function') {
        const ms = Number(player.getCurrentPositionMs());
        if (Number.isFinite(ms) && ms >= 0) {
            return ms / 1000;
        }
    }

    const refValue = player?.currentTimeRef && typeof player.currentTimeRef === 'object'
        ? player.currentTimeRef.current
        : undefined;
    const raw = refValue ?? player?.currentTime ?? 0;
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
}

export function readPlayerDurationSec(player) {
    const raw = player?.durationRaw ?? player?.duration ?? 0;
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

export function clampPositionSec(positionSec, durationSec = 0) {
    const position = Number(positionSec);
    if (!Number.isFinite(position) || position <= 0) return 0;

    const duration = Number(durationSec);
    if (Number.isFinite(duration) && duration > 0) {
        return Math.min(position, duration);
    }
    return position;
}

export function estimateRemotePositionSec(nowPlaying, nowMs = Date.now()) {
    const base = clampPositionSec(nowPlaying?.positionSec, nowPlaying?.durationSec);
    if (!nowPlaying || nowPlaying.isPlaying !== true) {
        return base;
    }

    const updatedAtMs = Number(nowPlaying.updatedAtMs);
    const now = Number(nowMs);
    if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0 || !Number.isFinite(now) || now <= updatedAtMs) {
        return base;
    }

    return clampPositionSec(base + ((now - updatedAtMs) / 1000), nowPlaying.durationSec);
}

export function getNowPlayingRevision(nowPlaying) {
    const revision = Number(nowPlaying?.stateRevision);
    if (Number.isFinite(revision) && revision > 0) {
        return `rev:${Math.floor(revision)}`;
    }

    const updatedAtMs = Number(nowPlaying?.updatedAtMs);
    if (Number.isFinite(updatedAtMs) && updatedAtMs > 0) {
        return `ts:${Math.floor(updatedAtMs)}`;
    }

    return '';
}

export function getServerActiveDeviceId(devices, nowPlaying, lease = null) {
    const leaseHolder = normalizeTrackId(lease?.holderDeviceId);
    if (leaseHolder) return leaseHolder;

    const list = Array.isArray(devices) ? devices : [];
    const active = list.find((d) => d && d.isActive);
    if (active) {
        return normalizeTrackId(active.id);
    }

    const nowPlayingDeviceId = nowPlaying?.deviceId != null ? String(nowPlaying.deviceId) : '';
    return normalizeTrackId(nowPlayingDeviceId);
}

export function isSelfActiveDevice(deviceId, devices, nowPlaying, lease = null) {
    const selfId = normalizeTrackId(deviceId);
    if (!selfId) return false;

    return getServerActiveDeviceId(devices, nowPlaying, lease) === selfId;
}

export function isDeviceSyncTransferInFlight(transfer) {
    if (!transfer || typeof transfer !== 'object') return false;
    const phase = String(transfer.phase || '').toLowerCase();
    return phase !== '' && !['reconciled', 'expired', 'failed'].includes(phase);
}

export function shouldClaimLocalPlayback({
    deviceEnabled = false,
    deviceReady = false,
    deviceId = '',
    isActiveOnServer = false,
    transfer = null,
    player = null,
} = {}) {
    if (deviceEnabled !== true || deviceReady !== true || !normalizeTrackId(deviceId)) return false;
    if (isActiveOnServer || isDeviceSyncTransferInFlight(transfer)) return false;
    if (!player || player.isPlaying !== true) return false;
    const wantsPlayback = typeof player.intent?.getWanted === 'function'
        ? player.intent.getWanted() === true
        : player.isPlaying === true;
    if (!wantsPlayback) return false;
    return !!readPlayerTrackId(player);
}

export function readTimelineIsPlaying(nowPlaying) {
    return nowPlaying?.isPlaying === true;
}

export function resolveAuthoritativePlayback(timeline, nowPlaying) {
    if (!timeline && !nowPlaying) return null;
    if (!timeline) return nowPlaying;
    if (!nowPlaying) return timeline;

    const timelineRevision = readNowPlayingRevision(timeline);
    const nowPlayingRevision = readNowPlayingRevision(nowPlaying);
    if (timelineRevision > 0 && nowPlayingRevision > 0) {
        return timelineRevision >= nowPlayingRevision ? timeline : nowPlaying;
    }

    const timelineUpdatedAt = readNowPlayingUpdatedAt(timeline);
    const nowPlayingUpdatedAt = readNowPlayingUpdatedAt(nowPlaying);
    if (timelineUpdatedAt > 0 && nowPlayingUpdatedAt > 0) {
        return timelineUpdatedAt >= nowPlayingUpdatedAt ? timeline : nowPlaying;
    }

    return nowPlaying;
}

export function buildSilentShadowSnapshot(nowPlaying, nowMs = Date.now()) {
    const trackId = normalizeTrackId(nowPlaying?.trackId);
    if (!trackId) return null;

    return {
        ...nowPlaying,
        trackId,
        positionSec: estimateRemotePositionSec(nowPlaying, nowMs),
        isPlaying: false,
    };
}

export function planSilentShadowReconciliation({
    snapshot,
    localTrackId = '',
    localPositionSec = 0,
    previousTrackId = '',
    previousRevision = '',
    revision = '',
}) {
    const trackId = normalizeTrackId(snapshot?.trackId);
    if (!trackId) return null;

    const remotePositionSec = clampPositionSec(snapshot?.positionSec, snapshot?.durationSec);
    const localPosition = clampPositionSec(localPositionSec, snapshot?.durationSec);
    const nextRevision = revision || getNowPlayingRevision(snapshot);
    const trackChanged = normalizeTrackId(localTrackId) !== trackId;
    const revisionChanged = normalizeTrackId(previousTrackId) !== trackId || previousRevision !== nextRevision;
    const driftSec = Math.abs(localPosition - remotePositionSec);

    return {
        trackId,
        revision: nextRevision,
        remotePositionSec,
        driftSec,
        trackChanged,
        revisionChanged,
        shouldApplyTrack: trackChanged,
        shouldProjectPosition: trackChanged || driftSec >= SILENT_SHADOW_ALIGN_SEC,
        shouldSeekLocalSink: !trackChanged && driftSec >= SILENT_SHADOW_SEEK_SEC,
    };
}

export function persistPlaybackResumePoint(trackId, positionSec, storage = null) {
    const id = normalizeTrackId(trackId);
    const position = clampPositionSec(positionSec);
    if (!id) return;

    const target = storage || (() => {
        try {
            if (typeof localStorage === 'undefined') return null;
            return localStorage;
        } catch {
            return null;
        }
    })();
    if (!target || typeof target.setItem !== 'function') return;

    try {
        target.setItem('lastTrackId', id);
        target.setItem('lastPositionSeconds', String(Math.floor(position * 1000) / 1000));
    } catch {
        /* storage can be disabled or full */
    }
}
