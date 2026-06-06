import {
    getServerActiveDeviceId,
    readTimelineIsPlaying,
    resolveAuthoritativePlayback,
} from './deviceSyncPlayback';

export function shouldRoutePlaybackControl(deviceSync) {
    if (!deviceSync || deviceSync.enabled !== true) return false;
    if (!deviceSync.ready || !deviceSync.deviceId) return false;

    const activeId = getServerActiveDeviceId(
        deviceSync.devices,
        deviceSync.nowPlaying,
        deviceSync.lease,
    );
    if (!activeId) return false;
    return activeId !== String(deviceSync.deviceId || '');
}

export function buildDeviceSyncControlDispatch(playerDispatch, deviceSync) {
    if (!playerDispatch || !shouldRoutePlaybackControl(deviceSync)) {
        return playerDispatch;
    }

    const getActiveDeviceId = () => getServerActiveDeviceId(
        deviceSync.devices,
        deviceSync.nowPlaying,
        deviceSync.lease,
    );

    const readGlobalPlayback = () => resolveAuthoritativePlayback(
        deviceSync.timeline,
        deviceSync.nowPlaying,
    );

    const ensureRealtime = () => {
        if (typeof deviceSync.enterRealtime === 'function') {
            deviceSync.enterRealtime();
        }
    };

    const sendActiveCommand = (cmd, payload = {}) => {
        const activeId = getActiveDeviceId();
        if (!activeId || activeId === String(deviceSync.deviceId || '')) return false;
        if (typeof deviceSync.sendCommand !== 'function') return false;
        ensureRealtime();
        deviceSync.sendCommand({ to: activeId, cmd, payload });
        return true;
    };

    const claimViaPlayIntent = () => {
        if (typeof deviceSync.sendCommand !== 'function') return false;
        ensureRealtime();
        deviceSync.sendCommand({ cmd: 'play' });
        return true;
    };

    const requestTransfer = (options = {}) => {
        ensureRealtime();
        if (typeof deviceSync.transferTo === 'function') {
            return deviceSync.transferTo(deviceSync.deviceId, options);
        }
        return undefined;
    };

    const toggleRemotePlayback = () => {
        const globalPlaying = readTimelineIsPlaying(readGlobalPlayback());
        if (globalPlaying) {
            if (sendActiveCommand('pause')) {
                if (typeof playerDispatch.projectPlaybackUiState === 'function') {
                    playerDispatch.projectPlaybackUiState(false);
                }
                return;
            }
        }
        claimViaPlayIntent();
    };

    const seekRemoteByPercent = (percent) => {
        const playback = readGlobalPlayback();
        const p = Number(percent);
        const durationSec = Number(playback?.durationSec);
        if (!Number.isFinite(p) || !Number.isFinite(durationSec) || durationSec <= 0) {
            requestTransfer({ resume: readTimelineIsPlaying(playback) });
            return;
        }
        const positionSec = (Math.max(0, Math.min(100, p)) / 100) * durationSec;
        if (!sendActiveCommand('seek', { positionSec })) {
            requestTransfer({ resume: readTimelineIsPlaying(playback) });
        }
    };

    const seekRemoteBySeconds = (seconds) => {
        const positionSec = Number(seconds);
        if (!Number.isFinite(positionSec) || positionSec < 0) return;
        const globalPlaying = readTimelineIsPlaying(readGlobalPlayback());
        if (!sendActiveCommand('seek', { positionSec })) {
            requestTransfer({ resume: globalPlaying });
        }
    };

    return {
        ...playerDispatch,
        togglePlayPause: toggleRemotePlayback,
        onPlayPause: toggleRemotePlayback,
        playNextTrack: () => {
            if (!sendActiveCommand('next')) requestTransfer({ resume: true });
        },
        playPreviousTrack: () => {
            if (!sendActiveCommand('previous')) requestTransfer({ resume: true });
        },
        onNext: () => {
            if (!sendActiveCommand('next')) requestTransfer({ resume: true });
        },
        onPrevious: () => {
            if (!sendActiveCommand('previous')) requestTransfer({ resume: true });
        },
        handleTrackSelect: () => requestTransfer({ resume: true }),
        onTrackSelect: () => requestTransfer({ resume: true }),
        seekToPercent: seekRemoteByPercent,
        commitSeek: seekRemoteByPercent,
        seekToSeconds: seekRemoteBySeconds,
        seekToPosition: (positionMs) => seekRemoteBySeconds(Number(positionMs) / 1000),
        handleProgressClick: () => requestTransfer({ resume: readTimelineIsPlaying(readGlobalPlayback()) }),
        onProgressClick: () => requestTransfer({ resume: readTimelineIsPlaying(readGlobalPlayback()) }),
    };
}
