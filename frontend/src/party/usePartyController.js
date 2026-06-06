import { useCallback, useMemo } from 'react';

const EMPTY_CHAT_MESSAGES = Object.freeze([]);

export function canPerformPartyAction(snapshot, action) {
  const s = snapshot && typeof snapshot === 'object' ? snapshot : {};
  if (s.isHost) return true;

  const permissions = s.permissions && typeof s.permissions === 'object' ? s.permissions : {};
  switch (action) {
    case 'changePlayback':
      return !!permissions.guestsCanChangePlayback;
    case 'addToQueue':
      return !!permissions.guestsCanAddToQueue;
    case 'skip':
      return !!permissions.guestsCanSkip;
    case 'removeFromQueue':
      return !!permissions.guestsCanRemoveFromQueue;
    default:
      return false;
  }
}

function getSnapshot(sync) {
  return sync && typeof sync.getSnapshot === 'function' ? sync.getSnapshot() : null;
}

function hasQueueTrack(snapshot, trackId) {
  if (!snapshot || !Array.isArray(snapshot.queue)) return false;
  const tid = String(trackId);
  return snapshot.queue.some((q) => q && String(q.id) === tid);
}

function normalizeQueueTrack(track) {
  if (!track || !track.id) return null;
  return {
    id: track.id,
    title: track.title || 'Unknown',
    artist: track.artist || 'Unknown Artist',
    cover: track.cover || track.cover_path || null,
    duration: track.duration || 0,
  };
}

function normalizeChatMessage(msg) {
  if (!msg || typeof msg.trim !== 'function') return '';
  return msg.trim().slice(0, 500);
}

function buildDiagnostics(refs, staleAfterMs) {
  return {
    lastServerMessageAtMs: refs.lastServerMessageAtRef.current,
    dropsSinceMount: refs.dropsSinceMountRef.current,
    reconnectsSinceMount: refs.reconnectsSinceMountRef.current,
    reconnectAttempt: refs.reconnectAttemptRef.current,
    lastDropReason: refs.lastDropReasonRef.current || null,
    staleAfterMs,
  };
}

export function usePartyController({
  snapshot,
  sync,
  sendMessage,
  reactionFeed,
  connect,
  disconnect,
  forceReconnect,
  diagnosticsRefs,
  staleAfterMs,
}) {
  const updatePlayback = useCallback((state) => {
    const current = getSnapshot(sync);
    if (!current?.isHost) return false;
    return sendMessage({ type: 'playback_update', data: state });
  }, [sendMessage, sync]);

  const seek = useCallback((position) => {
    const current = getSnapshot(sync);
    if (!current?.isHost) return false;
    return sendMessage({ type: 'seek', data: { position } });
  }, [sendMessage, sync]);

  const play = useCallback(() => updatePlayback({ isPlaying: true }), [updatePlayback]);
  const pause = useCallback(() => updatePlayback({ isPlaying: false }), [updatePlayback]);

  const setTrack = useCallback((trackData) => {
    const track = trackData && typeof trackData === 'object' ? trackData : {};
    return updatePlayback({
      trackId: track.trackId || track.id,
      trackTitle: track.trackTitle || track.title,
      trackArtist: track.trackArtist || track.artist,
      trackCover: track.trackCover || track.cover,
      isPlaying: false,
      position: 0,
    });
  }, [updatePlayback]);

  const sendReaction = useCallback((reactionType) => {
    return sendMessage({ type: 'reaction', data: { type: reactionType } });
  }, [sendMessage]);

  const sendChatMessage = useCallback((msg) => {
    const message = normalizeChatMessage(msg);
    if (!message) return false;
    return sendMessage({ type: 'chat', data: { message } });
  }, [sendMessage]);

  const requestSync = useCallback(() => sendMessage({ type: 'sync_request' }), [sendMessage]);

  const addToQueue = useCallback((track) => {
    const current = getSnapshot(sync);
    if (!canPerformPartyAction(current, 'addToQueue')) return false;

    const normalizedTrack = normalizeQueueTrack(track);
    if (!normalizedTrack) return false;
    if (hasQueueTrack(current, normalizedTrack.id)) return false;

    return sendMessage({
      type: 'add_to_queue',
      data: { track: normalizedTrack },
    });
  }, [sendMessage, sync]);

  const removeFromQueue = useCallback((target) => {
    const current = getSnapshot(sync);
    if (!canPerformPartyAction(current, 'removeFromQueue')) return false;
    if (target && typeof target === 'object') {
      if (target.queueId) {
        return sendMessage({ type: 'remove_from_queue', data: { queueId: target.queueId } });
      }
      if (Number.isFinite(Number(target.index))) {
        return sendMessage({ type: 'remove_from_queue', data: { index: Number(target.index) } });
      }
      return false;
    }
    if (typeof target === 'string' && target.trim()) {
      return sendMessage({ type: 'remove_from_queue', data: { queueId: target.trim() } });
    }
    return sendMessage({ type: 'remove_from_queue', data: { index: target } });
  }, [sendMessage, sync]);

  const playNext = useCallback(() => {
    const current = getSnapshot(sync);
    if (!canPerformPartyAction(current, 'skip')) return false;
    return sendMessage({ type: 'play_next' });
  }, [sendMessage, sync]);

  const refreshQueue = useCallback(() => sendMessage({ type: 'get_queue' }), [sendMessage]);
  const refreshParticipants = useCallback(() => sendMessage({ type: 'get_participants' }), [sendMessage]);

  const updatePermissions = useCallback((newPerms) => {
    const current = getSnapshot(sync);
    if (!current?.isHost) return false;
    return sendMessage({ type: 'update_permissions', data: { permissions: newPerms } });
  }, [sendMessage, sync]);

  const canPerformAction = useCallback((action) => {
    return canPerformPartyAction(getSnapshot(sync), action);
  }, [sync]);

  return useMemo(() => ({
    connectionState: snapshot.connectionState,
    isConnected: snapshot.connectionState === 'connected',
    isConnecting: snapshot.connectionState === 'connecting',
    isReconnecting: snapshot.connectionState === 'reconnecting',
    party: snapshot.party,
    playbackState: snapshot.playback,
    isHost: snapshot.isHost,
    userId: snapshot.userId,
    participantCount: snapshot.participantCount,
    reactions: reactionFeed,
    chatMessages: EMPTY_CHAT_MESSAGES,
    error: snapshot.error,
    queue: snapshot.queue,
    participants: snapshot.participants,
    permissions: snapshot.permissions,
    connect,
    disconnect,
    forceReconnect,
    updatePlayback,
    seek,
    play,
    pause,
    setTrack,
    sendReaction,
    sendChatMessage,
    requestSync,
    addToQueue,
    removeFromQueue,
    playNext,
    refreshQueue,
    refreshParticipants,
    updatePermissions,
    canPerformAction,
    diagnostics: buildDiagnostics(diagnosticsRefs, staleAfterMs),
    sync,
  }), [
    snapshot,
    reactionFeed,
    connect,
    disconnect,
    forceReconnect,
    updatePlayback,
    seek,
    play,
    pause,
    setTrack,
    sendReaction,
    sendChatMessage,
    requestSync,
    addToQueue,
    removeFromQueue,
    playNext,
    refreshQueue,
    refreshParticipants,
    updatePermissions,
    canPerformAction,
    diagnosticsRefs,
    staleAfterMs,
    sync,
  ]);
}
