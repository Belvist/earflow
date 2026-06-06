import {
    buildDeviceSyncControlDispatch,
    shouldRoutePlaybackControl,
} from '../deviceSyncControls';

describe('device sync controls', () => {
    test('does not route without authoritative active output', () => {
        expect(shouldRoutePlaybackControl({ enabled: true, ready: true, deviceId: 'self', devices: [] })).toBe(false);
        expect(shouldRoutePlaybackControl({ enabled: true, ready: true, deviceId: 'self', devices: [{ id: 'self', isActive: true }] })).toBe(false);
    });

    test('routes controls when another device is active via lease', () => {
        expect(shouldRoutePlaybackControl({
            enabled: true,
            ready: true,
            deviceId: 'self',
            devices: [{ id: 'other', isActive: true }],
            lease: { holderDeviceId: 'other' },
        })).toBe(true);
    });

    test('claims playback via play intent when global timeline is paused (server runs transfer-on-play)', () => {
        const playerDispatch = { togglePlayPause: jest.fn(), projectPlaybackUiState: jest.fn() };
        const sendCommand = jest.fn();
        const transferTo = jest.fn();
        const enterRealtime = jest.fn();
        const routed = buildDeviceSyncControlDispatch(playerDispatch, {
            enabled: true,
            ready: true,
            deviceId: 'self',
            devices: [{ id: 'other', isActive: true }],
            nowPlaying: { deviceId: 'other', isPlaying: false },
            timeline: { deviceId: 'other', isPlaying: false },
            sendCommand,
            transferTo,
            enterRealtime,
        });

        routed.togglePlayPause();

        expect(playerDispatch.togglePlayPause).not.toHaveBeenCalled();
        expect(enterRealtime).toHaveBeenCalled();
        expect(sendCommand).toHaveBeenCalledWith({ cmd: 'play' });
        expect(transferTo).not.toHaveBeenCalled();
    });

    test('pauses remote playback when global timeline is playing', () => {
        const sendCommand = jest.fn();
        const transferTo = jest.fn();
        const projectPlaybackUiState = jest.fn();
        const routed = buildDeviceSyncControlDispatch({ projectPlaybackUiState }, {
            enabled: true,
            ready: true,
            deviceId: 'self',
            devices: [{ id: 'other', isActive: true }],
            nowPlaying: { deviceId: 'other', isPlaying: true },
            timeline: { deviceId: 'other', isPlaying: true },
            sendCommand,
            transferTo,
            enterRealtime: jest.fn(),
        });

        routed.togglePlayPause();

        expect(sendCommand).toHaveBeenCalledWith({ to: 'other', cmd: 'pause', payload: {} });
        expect(projectPlaybackUiState).toHaveBeenCalledWith(false);
        expect(transferTo).not.toHaveBeenCalled();
    });

    test('sends passive next and seek controls to active device', () => {
        const sendCommand = jest.fn();
        const transferTo = jest.fn();
        const routed = buildDeviceSyncControlDispatch({}, {
            enabled: true,
            ready: true,
            deviceId: 'self',
            devices: [{ id: 'other', isActive: true }],
            nowPlaying: { deviceId: 'other', durationSec: 200, isPlaying: true },
            timeline: { deviceId: 'other', durationSec: 200, isPlaying: true },
            sendCommand,
            transferTo,
            enterRealtime: jest.fn(),
        });

        routed.playNextTrack();
        routed.commitSeek(25);

        expect(sendCommand).toHaveBeenNthCalledWith(1, { to: 'other', cmd: 'next', payload: {} });
        expect(sendCommand).toHaveBeenNthCalledWith(2, { to: 'other', cmd: 'seek', payload: { positionSec: 50 } });
        expect(transferTo).not.toHaveBeenCalled();
    });
});
