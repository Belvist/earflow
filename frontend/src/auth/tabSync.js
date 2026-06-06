const CHANNEL_NAME = 'earflow-auth';
const STORAGE_KEY = 'earflow:auth:event';

const tabId = (() => {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch {
    }
    return `tab_${Date.now()}_${Math.random().toString(16).slice(2)}`;
})();

let channel = null;

function getChannel() {
    if (channel) return channel;
    try {
        if (typeof BroadcastChannel === 'undefined') return null;
        channel = new BroadcastChannel(CHANNEL_NAME);
        return channel;
    } catch {
        return null;
    }
}

function normalizeEvent(type, payload = {}) {
    return {
        type: String(type || ''),
        payload: payload && typeof payload === 'object' ? payload : {},
        ts: Date.now(),
        source: tabId,
    };
}

export function getAuthTabId() {
    return tabId;
}

export function broadcastAuthEvent(type, payload = {}) {
    const event = normalizeEvent(type, payload);
    if (!event.type) return;

    try {
        getChannel()?.postMessage(event);
    } catch {
    }

    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(event));
        }
    } catch {
    }
}

export function subscribeAuthEvents(handler) {
    if (typeof handler !== 'function') {
        return () => undefined;
    }

    const onMessage = (event) => {
        const data = event?.data;
        if (!data || typeof data !== 'object') return;
        if (data.source === tabId) return;
        handler(data);
    };

    const ch = getChannel();
    try {
        ch?.addEventListener?.('message', onMessage);
    } catch {
        try {
            if (ch) ch.onmessage = onMessage;
        } catch {
        }
    }

    const onStorage = (event) => {
        if (!event || event.key !== STORAGE_KEY || !event.newValue) return;
        try {
            const data = JSON.parse(event.newValue);
            if (!data || data.source === tabId) return;
            handler(data);
        } catch {
        }
    };

    try {
        window?.addEventListener?.('storage', onStorage);
    } catch {
    }

    return () => {
        try {
            ch?.removeEventListener?.('message', onMessage);
        } catch {
            try {
                if (ch && ch.onmessage === onMessage) ch.onmessage = null;
            } catch {
            }
        }
        try {
            window?.removeEventListener?.('storage', onStorage);
        } catch {
        }
    };
}
