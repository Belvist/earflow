function getDefaultWebSocketCtor() {
    if (typeof window !== 'undefined' && window.WebSocket) {
        return window.WebSocket;
    }
    return null;
}

export function sendRealtimeJsonFrame(ws, frame, WebSocketCtor = getDefaultWebSocketCtor()) {
    if (!ws || !WebSocketCtor || ws.readyState !== WebSocketCtor.OPEN) {
        return false;
    }
    try {
        ws.send(JSON.stringify(frame));
        return true;
    } catch {
        return false;
    }
}

export function buildNowPlayingWriteState(nextState, deviceId, clientSeq, clientEventAtMs, activeRevision = 0) {
    if (!deviceId) return null;
    const revision = Number(activeRevision);
    const state = {
        ...(nextState || {}),
        deviceId,
        clientSeq,
        clientEventAtMs,
    };
    if (Number.isFinite(revision) && revision > 0) {
        state.activeRevision = Math.floor(revision);
    }
    delete state.stateRevision;
    delete state.updatedAtMs;
    return state;
}

export function buildCommandAckFrame(commandFrame, { ok = true, reason = '', activeRevision = 0 } = {}) {
    const payload = commandFrame?.payload && typeof commandFrame.payload === 'object'
        ? commandFrame.payload
        : {};
    const commandId = typeof payload.commandId === 'string' ? payload.commandId : '';
    const transferId = typeof payload.transferId === 'string' ? payload.transferId : '';
    if (!commandId || !transferId) return null;
    const revision = Number(activeRevision || payload.activeRevision);
    return {
        type: 'cmd:ack',
        cmd: String(commandFrame?.cmd || ''),
        transferId,
        commandId,
        step: typeof payload.step === 'string' ? payload.step : '',
        ok: ok === true,
        reason: typeof reason === 'string' ? reason : '',
        activeRevision: Number.isFinite(revision) && revision > 0 ? Math.floor(revision) : 0,
    };
}
