import { buildCommandAckFrame, buildNowPlayingWriteState, sendRealtimeJsonFrame } from '../deviceSyncTransport';

describe('device sync realtime transport', () => {
    const WebSocketCtor = { OPEN: 1 };

    test('sends JSON frame when socket is open', () => {
        const ws = {
            readyState: 1,
            send: jest.fn(),
        };

        expect(sendRealtimeJsonFrame(ws, { type: 'cmd', cmd: 'pause' }, WebSocketCtor)).toBe(true);
        expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'cmd', cmd: 'pause' }));
    });

    test('does not send when socket is not open', () => {
        const ws = {
            readyState: 0,
            send: jest.fn(),
        };

        expect(sendRealtimeJsonFrame(ws, { type: 'cmd' }, WebSocketCtor)).toBe(false);
        expect(ws.send).not.toHaveBeenCalled();
    });

    test('falls back when socket send throws', () => {
        const ws = {
            readyState: 1,
            send: jest.fn(() => {
                throw new Error('closed');
            }),
        };

        expect(sendRealtimeJsonFrame(ws, { type: 'np:update' }, WebSocketCtor)).toBe(false);
    });

    test('builds backend-authored now-playing writes without client revisions', () => {
        const state = buildNowPlayingWriteState({
            trackId: 'track-1',
            stateRevision: 42,
            updatedAtMs: 10_000,
        }, 'device-1', 7, 20_000);

        expect(state).toEqual({
            trackId: 'track-1',
            deviceId: 'device-1',
            clientSeq: 7,
            clientEventAtMs: 20_000,
        });
    });

    test('carries activeRevision fencing token when available', () => {
        const state = buildNowPlayingWriteState({
            trackId: 'track-1',
        }, 'device-1', 8, 21_000, 12);

        expect(state).toMatchObject({
            trackId: 'track-1',
            deviceId: 'device-1',
            clientSeq: 8,
            clientEventAtMs: 21_000,
            activeRevision: 12,
        });
    });

    test('builds command ack frames for server-owned transfer commands', () => {
        expect(buildCommandAckFrame({
            cmd: 'transfer',
            payload: {
                transferId: 'transfer-1',
                commandId: 'command-1',
                step: 'activate',
                activeRevision: 9,
            },
        })).toEqual({
            type: 'cmd:ack',
            cmd: 'transfer',
            transferId: 'transfer-1',
            commandId: 'command-1',
            step: 'activate',
            ok: true,
            reason: '',
            activeRevision: 9,
        });
    });

    test('does not build command ack without transfer identity', () => {
        expect(buildCommandAckFrame({ cmd: 'pause', payload: {} })).toBeNull();
    });
});
