'use strict';

function clampString(value, maxLen) {
    const s = typeof value === 'string' ? value : '';
    const t = s.trim();
    if (!t) return '';
    return t.length > maxLen ? t.slice(0, maxLen) : t;
}

function toSeconds({ minutes, seconds, fraction }) {
    const m = Number(minutes);
    const s = Number(seconds);
    const f = Number(fraction);
    if (!Number.isFinite(m) || !Number.isFinite(s)) return null;
    if (m < 0 || s < 0 || s >= 60) return null;
    const ms = Number.isFinite(f) ? f : 0;
    const total = (m * 60) + s + (ms / 1000);
    return total >= 0 ? total : null;
}

function normalizeFraction(frac) {
    const raw = typeof frac === 'string' ? frac : '';
    if (!raw) return 0;
    if (!/^\d{1,3}$/.test(raw)) return 0;
    if (raw.length === 1) return Number(raw) * 100;
    if (raw.length === 2) return Number(raw) * 10;
    return Number(raw);
}

function parseLrcToLines({ lrc, durationSeconds }) {
    const src = typeof lrc === 'string' ? lrc : '';
    if (!src.trim()) return [];

    const dur = Number(durationSeconds);
    const duration = Number.isFinite(dur) && dur > 0 ? dur : null;

    const lines = [];
    const rawLines = src.split(/\r?\n/);

    for (const raw of rawLines) {
        if (lines.length >= 500) break;
        const line = typeof raw === 'string' ? raw : '';
        if (!line.trim()) continue;

        const tags = [...line.matchAll(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
        if (tags.length === 0) continue;

        const text = clampString(line.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' '), 800);
        if (!text) continue;

        for (const t of tags) {
            if (lines.length >= 500) break;
            const minutes = t[1];
            const seconds = t[2];
            const fraction = normalizeFraction(t[3]);
            const startTime = toSeconds({ minutes, seconds, fraction });
            if (startTime === null) continue;

            lines.push({
                text,
                startTime,
                endTime: startTime,
                words: [],
            });
        }
    }

    lines.sort((a, b) => a.startTime - b.startTime);

    const deduped = [];
    for (const line of lines) {
        if (deduped.length === 0) {
            deduped.push(line);
            continue;
        }
        const prev = deduped[deduped.length - 1];
        if (Math.abs(prev.startTime - line.startTime) < 0.001) {
            if (line.text.length > prev.text.length) {
                deduped[deduped.length - 1] = line;
            }
            continue;
        }
        deduped.push(line);
    }

    for (let i = 0; i < deduped.length; i += 1) {
        const cur = deduped[i];
        const next = deduped[i + 1];
        const nextStart = next ? next.startTime : null;

        const defaultLast = cur.startTime + 8;
        const end = nextStart != null
            ? Math.max(cur.startTime, nextStart)
            : (duration != null ? Math.max(cur.startTime, Math.min(duration, defaultLast)) : defaultLast);

        cur.endTime = end;
    }

    return deduped;
}

module.exports = {
    parseLrcToLines,
};
