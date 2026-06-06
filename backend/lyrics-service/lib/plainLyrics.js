'use strict';

function clampString(value, maxLen) {
    const s = typeof value === 'string' ? value : '';
    const t = s.trim();
    if (!t) return '';
    return t.length > maxLen ? t.slice(0, maxLen) : t;
}

function normalizePlainText(raw) {
    const src = typeof raw === 'string' ? raw : '';
    const normalized = src
        .replaceAll(/\r\n/g, '\n')
        .replaceAll(/\r/g, '\n')
        .replaceAll(/\uFEFF/g, '')
        .replaceAll(/\n{3,}/g, '\n\n')
        .trim();

    return clampString(normalized, 50_000);
}

function splitToLines(plainText) {
    const text = normalizePlainText(plainText);
    if (!text) return [];

    const rawLines = text
        .split('\n')
        .map((s) => clampString(s, 800))
        .map((s) => s.replaceAll(/\s+/g, ' ').trim())
        .filter(Boolean);

    if (rawLines.length === 0) return [];
    return rawLines.slice(0, 500);
}

function normalizeDurationSeconds(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (n > 10_000) {
        const msAsSec = Math.round(n / 1000);
        if (msAsSec > 0 && msAsSec <= 10_000) return msAsSec;
    }
    return Math.round(n);
}

function plainTextToSyncedLines({ plainText, durationSeconds }) {
    const linesText = splitToLines(plainText);
    if (linesText.length === 0) return [];

    const duration = normalizeDurationSeconds(durationSeconds);
    const count = linesText.length;

    const perLine = (() => {
        if (!duration) return 5;
        const raw = duration / count;
        if (!Number.isFinite(raw) || raw <= 0) return 5;
        return Math.max(1.2, Math.min(10, raw));
    })();

    const out = [];
    let t = 0;
    for (let i = 0; i < count; i += 1) {
        const text = linesText[i];
        const startTime = Math.max(0, t);
        let endTime = startTime + perLine;
        if (duration != null) {
            if (i === count - 1) {
                endTime = Math.max(startTime, duration);
            } else {
                endTime = Math.min(duration, endTime);
            }
        }
        endTime = Math.max(startTime, endTime);

        out.push({
            text,
            startTime,
            endTime,
            words: [],
        });

        t = endTime;
    }

    for (let i = 0; i < out.length - 1; i += 1) {
        if (out[i].endTime > out[i + 1].startTime) {
            out[i].endTime = out[i + 1].startTime;
        }
    }

    return out;
}

module.exports = {
    normalizePlainText,
    plainTextToSyncedLines,
};
