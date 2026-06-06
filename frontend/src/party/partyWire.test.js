/**
 * @jest-environment node
 */
import { buildInitDataFromDoc, legacyToBinaryFrames, decodeBinaryPartyFrames, msgEncode, msgDecode } from './partyWire';

describe('partyWire', () => {
  test('buildInitDataFromDoc matches GET /api/party shape (minimal)', () => {
    const doc = {
      v: 1,
      id: 'p1',
      title: 'T',
      hostId: 'h1',
      hostName: 'Host',
      rev: 3,
      permissions: { guestsCanPlayPause: true, guestsCanAddToQueue: true, guestsCanSkip: false, guestsCanRemoveFromQueue: false },
      playback: { trackId: 'tr1', isPlaying: true, positionMs: 2000, positionUpdatedAtMs: 100, trackDuration: 120000, trackTitle: 'X', trackArtist: 'Y', trackCover: null },
      participants: { u1: { userId: 'u1', username: 'Me', isHost: false, joinedAtMs: 1 } },
      queue: []
    };
    const init = buildInitDataFromDoc(doc, 'u1', 100);
    expect(init.isHost).toBe(false);
    expect(init.userId).toBe('u1');
    expect(init.state.stateRevision).toBe(3);
    expect(init.state.position).toBe(2);
  });

  test('buildInitDataFromDoc projects running playback position from server time', () => {
    const doc = {
      id: 'p1',
      title: 'T',
      hostId: 'h1',
      hostName: 'Host',
      rev: 4,
      permissions: { guestsCanPlayPause: true, guestsCanAddToQueue: true, guestsCanSkip: false, guestsCanRemoveFromQueue: false },
      playback: { trackId: 'tr1', isPlaying: true, positionMs: 10000, positionUpdatedAtMs: 100000, trackDuration: 60000 },
      participants: { u1: { userId: 'u1', username: 'Me', isHost: false, joinedAtMs: 1 } },
      queue: []
    };
    const init = buildInitDataFromDoc(doc, 'u1', 112500);
    expect(init.state.position).toBe(22.5);
    expect(init.state.serverTimestamp).toBe(112500);
  });

  test('encode/decode client ping cmd', () => {
    const frames = legacyToBinaryFrames({ type: 'ping' }, { partyId: 'pid', userId: 'u1', username: 'U' });
    expect(frames.length).toBe(1);
    const m = msgDecode(frames[0]);
    expect(m.t).toBe('cmd');
    expect(m.payload?.cmd?.type).toBe('ping');
  });

  test('encodes explicit sync request as snapshot instead of heartbeat ping', () => {
    const frames = legacyToBinaryFrames({ type: 'sync_request' }, { partyId: 'pid', userId: 'u1', username: 'U' });
    expect(frames.length).toBe(1);
    const m = msgDecode(frames[0]);
    expect(m.payload?.cmd?.type).toBe('snapshot');
  });

  test('encodes queue removal by stable queue id when available', () => {
    const frames = legacyToBinaryFrames({ type: 'remove_from_queue', data: { queueId: 'q-1', index: 3 } }, { partyId: 'pid', userId: 'u1', username: 'U' });
    expect(frames.length).toBe(1);
    const m = msgDecode(frames[0]);
    expect(m.payload?.cmd).toMatchObject({
      type: 'remove_from_queue',
      partyId: 'pid',
      userId: 'u1',
      queueId: 'q-1',
    });
    expect(m.payload?.cmd?.index).toBeUndefined();
  });

  test('encodes playback update atomically instead of set_track seek play burst', () => {
    const frames = legacyToBinaryFrames({
      type: 'playback_update',
      data: {
        trackId: 42,
        trackTitle: 'Song',
        trackArtist: 'Artist',
        trackDuration: 180,
        position: 12.5,
        isPlaying: true,
      },
    }, { partyId: 'pid', userId: 'host', username: 'Host' });

    expect(frames.length).toBe(1);
    const m = msgDecode(frames[0]);
    expect(m.payload?.cmd).toMatchObject({
      type: 'playback_update',
      partyId: 'pid',
      userId: 'host',
      trackId: '42',
      trackTitle: 'Song',
      trackArtist: 'Artist',
      trackDurationMs: 180000,
      positionMs: 12500,
      isPlaying: true,
    });
  });

  test('encodes host position heartbeat as one playback update frame', () => {
    const frames = legacyToBinaryFrames({
      type: 'playback_update',
      data: { position: 30, isPlaying: true },
    }, { partyId: 'pid', userId: 'host', username: 'Host' });

    expect(frames.length).toBe(1);
    const m = msgDecode(frames[0]);
    expect(m.payload?.cmd).toMatchObject({
      type: 'playback_update',
      positionMs: 30000,
      isPlaying: true,
    });
    expect(m.payload?.cmd?.trackId).toBeUndefined();
  });

  test('decodes lightweight gateway pong', () => {
    const wire = msgEncode({ type: 'pong', serverTimeMs: 123 });
    const u8 = wire instanceof Uint8Array ? wire : new Uint8Array(wire);
    const out = decodeBinaryPartyFrames(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength), { currentUserId: 'u1' });
    expect(out).toEqual([{ type: 'pong', data: { serverTimestamp: 123 } }]);
  });

  test('decode reply to init', () => {
    const doc = {
      id: 'p1',
      title: 'T',
      hostId: 'h1',
      hostName: 'H',
      rev: 1,
      permissions: { guestsCanPlayPause: true, guestsCanAddToQueue: true, guestsCanSkip: false, guestsCanRemoveFromQueue: false },
      playback: { isPlaying: false, positionMs: 0, positionUpdatedAtMs: 0, trackDuration: 0, trackId: null },
      participants: { u1: { userId: 'u1', username: 'U', isHost: true, joinedAtMs: 0 } },
      queue: []
    };
    const wire = msgEncode({ t: 'reply', id: '0', partyId: 'p1', payload: { ok: true, doc, serverTimeMs: Date.now() } });
    const u8 = wire instanceof Uint8Array ? wire : new Uint8Array(wire);
    const out = decodeBinaryPartyFrames(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength), { currentUserId: 'u1' });
    expect(out.length).toBe(1);
    expect(out[0].type).toBe('init');
  });

  test('decodes failed command replies as errors', () => {
    const wire = msgEncode({ t: 'reply', id: '0', partyId: 'p1', payload: { ok: false, code: 'NOT_AUTHORIZED' } });
    const u8 = wire instanceof Uint8Array ? wire : new Uint8Array(wire);
    const out = decodeBinaryPartyFrames(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength), { currentUserId: 'u1' });
    expect(out).toEqual([{ type: 'error', data: { code: 'NOT_AUTHORIZED', message: 'NOT_AUTHORIZED' } }]);
  });

  test('decodes queue item stable ids', () => {
    const wire = msgEncode({
      t: 'event',
      partyId: 'p1',
      payload: {
        t: 'queue',
        partyId: 'p1',
        stateRevision: 2,
        queue: [{ queueId: 'q-1', id: 'tr1', title: 'Song', artist: 'Artist', durationMs: 1000 }],
      },
    });
    const u8 = wire instanceof Uint8Array ? wire : new Uint8Array(wire);
    const out = decodeBinaryPartyFrames(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength), { currentUserId: 'u1' });
    expect(out[0].data.queue[0].queueId).toBe('q-1');
  });
});
