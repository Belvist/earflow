let timeoutId = null;
let running = false;
let intervalMs = 250;
let nextAtMs = 0;

function nowMs() {
    if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}

function scheduleNext() {
    if (!running) return;
    const delay = Math.max(0, Math.floor(nextAtMs - nowMs()));
    timeoutId = setTimeout(() => {
        if (!running) return;
        const ts = nowMs();
        nextAtMs = nextAtMs + intervalMs;
        if (nextAtMs < ts) {
            nextAtMs = ts + intervalMs;
        }
        self.postMessage({ type: 'TICK', ts });
        scheduleNext();
    }, delay);
}

function stop() {
    running = false;
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = null;
}

self.onmessage = (e) => {
    const data = e && e.data ? e.data : null;
    const type = data && data.type ? String(data.type) : '';

    if (type === 'START') {
        const nextInterval = Number(data.interval);
        intervalMs = Number.isFinite(nextInterval) && nextInterval > 10 ? Math.floor(nextInterval) : 250;
        stop();
        running = true;
        nextAtMs = nowMs() + intervalMs;
        scheduleNext();
        return;
    }

    if (type === 'STOP') {
        stop();
    }
};
