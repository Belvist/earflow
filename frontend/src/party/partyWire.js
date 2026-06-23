/**
 * Party v2 wire: msgpack frames matching backend/party-go (internal/wire, partygw, NATS).
 * Converts to/from the legacy JSON shapes expected by useParty + PartySync.
 */
import { decode as msgDecode, encode as msgEncode } from '@msgpack/msgpack';

const ulid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/**
 * @param {Record<string, unknown>} doc
 * @param {string} currentUserId
 */
export function buildInitDataFromDoc(doc, currentUserId, serverTimeMs) {
  if (!doc || typeof doc !== 'object') return null;
  const uid = String(currentUserId || '');
  const hostId = String(doc.hostId || '');
  const isHost = hostId && uid && hostId === uid;
  const parts = doc.participants && typeof doc.participants === 'object' ? doc.participants : {};
  const isParticipant = uid ? Object.prototype.hasOwnProperty.call(parts, uid) : false;
  const pb = doc.playback && typeof doc.playback === 'object' ? doc.playback : {};
  const nowMsRaw = Number(serverTimeMs);
  const nowMs = Number.isFinite(nowMsRaw) && nowMsRaw > 0 ? nowMsRaw : Date.now();
  let positionMs =
    typeof pb.positionMs === 'number' && Number.isFinite(pb.positionMs)
      ? Math.max(0, pb.positionMs)
      : 0;
  const updatedAtMs = Number(pb.positionUpdatedAtMs);
  if (pb.isPlaying === true && Number.isFinite(updatedAtMs) && updatedAtMs > 0 && nowMs > updatedAtMs) {
    positionMs += nowMs - updatedAtMs;
  }
  const durationMs = typeof pb.trackDuration === 'number' && Number.isFinite(pb.trackDuration)
    ? Math.max(0, pb.trackDuration)
    : 0;
  if (durationMs > 0 && positionMs > durationMs) {
    positionMs = durationMs;
  }
  const posSec = positionMs / 1000;
  const trackId = pb.trackId != null ? pb.trackId : null;
  const st = {
    trackId: trackId ?? null,
    isPlaying: !!pb.isPlaying,
    position: posSec,
    stateRevision: typeof doc.rev === 'number' ? doc.rev : 0,
    serverTimestamp: nowMs,
    trackDuration: durationMs / 1000,
  };
  if (pb.trackTitle != null) st.trackTitle = pb.trackTitle;
  if (pb.trackArtist != null) st.trackArtist = pb.trackArtist;
  if (pb.trackCover != null) st.trackCover = pb.trackCover;

  const perms = doc.permissions && typeof doc.permissions === 'object' ? doc.permissions : {};
  const permissions = {
    guestsCanChangePlayback: !!(
      perms.guestsCanPlayPause ?? perms.guestsCanChangePlayback
    ),
    guestsCanAddToQueue: !!perms.guestsCanAddToQueue,
    guestsCanSkip: !!perms.guestsCanSkip,
    guestsCanRemoveFromQueue: !!perms.guestsCanRemoveFromQueue,
  };

  const parr = Object.values(parts).map((p) => ({
    id: String(p.userId),
    username: String(p.username || 'User'),
    isHost: !!p.isHost,
    joinedAt: typeof p.joinedAtMs === 'number' ? p.joinedAtMs : undefined,
  }));

  const q = Array.isArray(doc.queue) ? doc.queue : [];
  const queue = q.map(mapQueueItem);

  return {
    userId: uid || null,
    isHost,
    isParticipant,
    party: {
      id: String(doc.id || ''),
      title: String(doc.title || ''),
      hostId,
      hostName: String(doc.hostName || ''),
    },
    state: st,
    queue,
    participants: parr,
    permissions,
    participantCount: parr.length,
  };
}

/**
 * @param {Uint8Array} buf
 */
function decodeMap(buf) {
  const v = msgDecode(buf);
  if (!v || typeof v !== 'object') return null;
  return v;
}

function mapQueueItem(it) {
  const out = {
    id: String(it.id),
    title: String(it.title || ''),
    artist: String(it.artist || ''),
    cover: it.cover != null ? it.cover : null,
    duration: typeof it.durationMs === 'number' ? it.durationMs / 1000 : 0,
    addedBy: String(it.addedBy || ''),
    addedByName: String(it.addedByName || ''),
  };
  if (it.queueId != null && String(it.queueId).trim()) {
    out.queueId = String(it.queueId);
  }
  return out;
}

/**
 * @param {object} m wire root
 * @param {object} ctx
 * @returns {object[]} legacy { type, data }[] or error objects
 */
export function mapWireToLegacyMessages(m, ctx) {
  const { currentUserId } = ctx;
  const out = [];
  if (!m || typeof m !== 'object') return out;

  const t = m.t;
  if (t === 'err' || t === 'error') {
    const p = m.payload;
    const code = p && typeof p === 'object' ? p.code : 'UNKNOWN';
    out.push({ type: 'error', data: { code, message: String(code) } });
    return out;
  }

  if (t === 'pong') {
    out.push({ type: 'pong', data: { serverTimestamp: m.serverTimeMs || Date.now() } });
    return out;
  }

  if (t === 'reply') {
    const p = m.payload;
    if (p && typeof p === 'object' && p.ok && p.doc) {
      const initData = buildInitDataFromDoc(p.doc, currentUserId, p.serverTimeMs);
      if (initData) {
        // Join + ping responses: reuse init path for full resync.
        out.push({ type: 'init', data: initData });
      }
    } else if (p && typeof p === 'object' && p.ok === false) {
      const code = String(p.code || 'COMMAND_FAILED');
      out.push({ type: 'error', data: { code, message: code } });
    }
    return out;
  }

  if (t === 'event') {
    const evt = m.payload;
    return mapInnerEventToLegacy(evt, { currentUserId });
  }

  // Direct inner event (some paths)
  if (m.type && !t) {
    if (m.type === 'pong') {
      out.push({ type: 'pong', data: { serverTimestamp: m.serverTimeMs || Date.now() } });
      return out;
    }
    return mapInnerEventToLegacy(m, { currentUserId });
  }

  return out;
}

/**
 * @param {object} evt
 */
function mapInnerEventToLegacy(evt) {
  const out = [];
  if (!evt || typeof evt !== 'object') return out;
  const k = evt.t || evt.type;
  const rev = typeof evt.stateRevision === 'number' ? evt.stateRevision : undefined;
  const atMs = typeof evt.atMs === 'number' ? evt.atMs : Date.now();

  switch (k) {
    case 'user_joined': {
      out.push({
        type: 'user_joined',
        data: {
          userId: String(evt.userId || ''),
          username: String(evt.username || ''),
          isHost: !!evt.isHost,
        },
      });
      break;
    }
    case 'user_left': {
      out.push({ type: 'user_left', data: { userId: String(evt.userId || ''), atMs } });
      break;
    }
    case 'party_ended': {
      out.push({
        type: 'party_ended',
        data: { reason: String(evt.reason || 'ENDED'), atMs, partyId: String(evt.partyId || '') },
      });
      break;
    }
    case 'playback': {
      const pb = evt.playback;
      if (pb && typeof pb === 'object') {
        const posSec =
          typeof pb.positionMs === 'number' ? Math.max(0, pb.positionMs) / 1000 : 0;
        out.push({
          type: 'sync',
          data: {
            trackId: pb.trackId != null ? pb.trackId : null,
            trackTitle: pb.trackTitle ?? null,
            trackArtist: pb.trackArtist ?? null,
            trackCover: pb.trackCover ?? null,
            trackDuration: typeof pb.trackDuration === 'number' ? pb.trackDuration / 1000 : 0,
            isPlaying: !!pb.isPlaying,
            position: posSec,
            serverTimestamp: atMs,
            stateRevision: rev,
          },
        });
      }
      break;
    }
    case 'queue': {
      const q = Array.isArray(evt.queue) ? evt.queue : [];
      const queue = q.map(mapQueueItem);
      out.push({ type: 'queue', data: { queue, stateRevision: rev } });
      break;
    }
    case 'skip': {
      const q = Array.isArray(evt.queue) ? evt.queue : [];
      const queue = q.map(mapQueueItem);
      out.push({ type: 'queue', data: { queue, stateRevision: rev } });
      const pb = evt.playback;
      if (pb && typeof pb === 'object') {
        const posSec =
          typeof pb.positionMs === 'number' ? Math.max(0, pb.positionMs) / 1000 : 0;
        out.push({
          type: 'sync',
          data: {
            trackId: pb.trackId != null ? pb.trackId : null,
            trackTitle: pb.trackTitle ?? null,
            trackArtist: pb.trackArtist ?? null,
            trackCover: pb.trackCover ?? null,
            trackDuration: typeof pb.trackDuration === 'number' ? pb.trackDuration / 1000 : 0,
            isPlaying: !!pb.isPlaying,
            position: posSec,
            serverTimestamp: atMs,
            stateRevision: rev,
          },
        });
      }
      break;
    }
    case 'permissions_updated': {
      const p = evt.permissions;
      if (p && typeof p === 'object') {
        out.push({
          type: 'permissions_updated',
          data: {
            permissions: {
              guestsCanChangePlayback: !!(p.guestsCanPlayPause ?? p.guestsCanChangePlayback),
              guestsCanAddToQueue: !!p.guestsCanAddToQueue,
              guestsCanSkip: !!p.guestsCanSkip,
              guestsCanRemoveFromQueue: !!p.guestsCanRemoveFromQueue,
            },
            stateRevision: rev,
          },
        });
      }
      break;
    }
    case 'reaction': {
      out.push({
        type: 'reaction',
        data: {
          userId: String(evt.userId || ''),
          username: String(evt.username || ''),
          type: String(evt.type || 'like'),
          timestamp: atMs,
        },
      });
      break;
    }
    case 'chat': {
      out.push({
        type: 'chat',
        data: {
          userId: String(evt.userId || ''),
          username: String(evt.username || ''),
          message: String(evt.message || ''),
          timestamp: atMs,
        },
      });
      break;
    }
    default:
      break;
  }
  return out;
}

/**
 * @param {ArrayBuffer|Uint8Array} raw
 * @param {object} ctx
 * @returns {object[]}
 */
export function decodeBinaryPartyFrames(raw, ctx) {
  const buf = raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw;
  const m = decodeMap(buf);
  if (!m) return [];
  if (m.t === 'reply' && m.payload && typeof m.payload === 'object' && m.payload.ok && m.payload.doc) {
    return mapWireToLegacyMessages(m, ctx);
  }
  if (m.t === 'event') {
    return mapInnerEventToLegacy(m.payload);
  }
  if (m.t === 'err' || m.t === 'error') {
    return mapWireToLegacyMessages(m, ctx);
  }
  if (m.t === 'pong' || m.type === 'pong') {
    return mapWireToLegacyMessages(m, ctx);
  }
  if (m.t) {
    return mapWireToLegacyMessages(m, ctx);
  }
  return [];
}

function toDurationMs(track) {
  if (!track || typeof track !== 'object') return 0;
  const d = Number(track.duration);
  if (!Number.isFinite(d)) return 0;
  if (d > 0 && d < 1e6) return Math.round(d * 1000);
  return Math.round(d);
}

/**
 * @param {object} message legacy useParty JSON body
 * @param {object} ctx { partyId, userId, username }
 * @returns {Uint8Array[]}
 */
function legacyToCmds(message, ctx) {
  const { partyId, userId, username } = ctx;
  const uname = typeof username === 'string' && username.trim() ? username.trim() : 'User';
  const uid = String(userId || '');
  if (!partyId || !uid) return [];

  const base = (cmd) => ({
    t: 'cmd',
    id: ulid(),
    partyId: String(partyId),
    payload: { cmd },
  });

  const enc = (cmd) => msgEncode(base(cmd));

  const typ = message && message.type;
  if (typ === 'ping') {
    return [enc({ type: 'ping', partyId, userId: uid })];
  }

  if (typ === 'sync_request' || typ === 'get_queue' || typ === 'get_participants') {
    return [enc({ type: 'snapshot', partyId, userId: uid })];
  }

  if (typ === 'play_next') {
    return [enc({ type: 'skip', partyId, userId: uid })];
  }

  if (typ === 'remove_from_queue' && message.data) {
    const queueId = message.data.queueId != null ? String(message.data.queueId).trim() : '';
    if (queueId) {
      return [enc({ type: 'remove_from_queue', partyId, userId: uid, queueId })];
    }
    const idx = Number(message.data.index);
    if (!Number.isFinite(idx)) return [];
    return [enc({ type: 'remove_from_queue', partyId, userId: uid, index: idx })];
  }

  if (typ === 'update_permissions' && message.data && message.data.permissions) {
    return [enc({ type: 'set_permissions', partyId, userId: uid, permissions: message.data.permissions })];
  }

  if (typ === 'reaction' && message.data) {
    return [
      enc({
        type: 'reaction',
        partyId,
        userId: uid,
        username: uname,
        reactionType: String(message.data.type || 'like'),
      }),
    ];
  }

  if (typ === 'chat' && message.data) {
    return [
      enc({ type: 'chat', partyId, userId: uid, message: String(message.data.message || '') }),
    ];
  }

  if (typ === 'add_to_queue' && message.data && message.data.track) {
    const tr = message.data.track;
    return [
      enc({
        type: 'add_to_queue',
        partyId,
        userId: uid,
        username: uname,
        track: {
          id: String(tr.id),
          title: String(tr.title || 'Unknown'),
          artist: String(tr.artist || 'Unknown'),
          cover: tr.cover != null ? tr.cover : null,
          durationMs: toDurationMs(tr),
        },
      }),
    ];
  }
  if (typ === 'seek' && message.data) {
    const pos = Number(message.data.position);
    if (!Number.isFinite(pos)) return [];
    return [enc({ type: 'seek', partyId, userId: uid, positionMs: Math.max(0, Math.round(pos * 1000)) })];
  }

  if (typ === 'playback_update' && message.data) {
    const d = message.data;
    const c = {
      type: 'playback_update',
      partyId,
      userId: uid,
    };
    let hasPayload = false;
    if (d.trackId != null && String(d.trackId) !== '') {
      c.trackId = String(d.trackId);
      hasPayload = true;
    }
    if (d.trackTitle != null) {
      c.trackTitle = d.trackTitle;
      hasPayload = true;
    }
    if (d.trackArtist != null) {
      c.trackArtist = d.trackArtist;
      hasPayload = true;
    }
    if (d.trackCover != null) {
      c.trackCover = d.trackCover;
      hasPayload = true;
    }
    if (d.trackDuration != null) {
      c.trackDurationMs = toDurationMs({ duration: d.trackDuration });
      hasPayload = true;
    }
    if (d.position != null && Number.isFinite(Number(d.position))) {
      c.positionMs = Math.max(0, Math.round(Number(d.position) * 1000));
      hasPayload = true;
    }
    if (typeof d.isPlaying === 'boolean') {
      c.isPlaying = d.isPlaying;
      hasPayload = true;
    }
    return hasPayload ? [enc(c)] : [];
  }

  return [];
}

/**
 * @param {object} message
 * @param {object} ctx
 * @returns {Uint8Array[]}
 */
export function legacyToBinaryFrames(message, ctx) {
  if (!message || typeof message !== 'object') return [];
  return legacyToCmds(message, ctx);
}

export { msgEncode, msgDecode };
