import { useMemo } from 'react';

function findCurrentLineIndex(lines, t) {
    const time = Number(t);
    if (!Number.isFinite(time) || time < 0) return -1;
    const len = lines.length;
    if (len === 0) return -1;

    const firstStart = Number(lines[0]?.startTime);
    if (Number.isFinite(firstStart) && time < firstStart) return -1;

    let lo = 0;
    let hi = len - 1;
    let result = -1;

    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        const s = Number(lines[mid]?.startTime);
        if (Number.isFinite(s) && time >= s) {
            result = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }

    return result;
}

function computeLineProgress(line, t) {
    const time = Number(t);
    const s = Number(line?.startTime);
    const e = Number(line?.endTime);
    if (!Number.isFinite(time) || time < 0) return 0;
    if (!Number.isFinite(s) || s < 0) return 0;
    if (!Number.isFinite(e) || e <= s) return time >= s ? 1 : 0;
    return Math.min(1, Math.max(0, (time - s) / (e - s)));
}

function findCurrentWordIndex(line, t) {
    const rawWords = Array.isArray(line?.words) ? line.words : [];
    const words = rawWords.length > 0
        ? rawWords
        : (typeof line?.text === 'string'
            ? String(line.text).split(/\s+/g).filter(Boolean).map((text) => ({ text }))
            : []);
    if (words.length === 0) return -1;

    const time = Number(t);
    if (!Number.isFinite(time) || time < 0) return -1;

    const hasTiming = rawWords.length > 0 && rawWords.some((w) => Number.isFinite(Number(w?.startTime)));
    if (hasTiming) {
        for (let i = rawWords.length - 1; i >= 0; i -= 1) {
            const s = Number(rawWords[i]?.startTime);
            if (Number.isFinite(s) && time >= s) return i;
        }
        return -1;
    }

    const p = computeLineProgress(line, t);
    const LEAD = 0.03;
    const TAIL = 0.92;
    if (p < LEAD) return -1;
    const norm = Math.min(1, (p - LEAD) / (TAIL - LEAD));
    return Math.min(words.length - 1, Math.max(0, Math.floor(norm * words.length)));
}

export const useLyricsSync = (lines, currentTime) => {
    const list = Array.isArray(lines) ? lines : [];

    const currentLineIndex = useMemo(() => {
        if (list.length === 0) return -1;
        return findCurrentLineIndex(list, currentTime);
    }, [list, currentTime]);

    const currentLine = currentLineIndex >= 0 ? list[currentLineIndex] : null;

    const lineProgress = useMemo(() => {
        if (!currentLine) return 0;
        return computeLineProgress(currentLine, currentTime);
    }, [currentLine, currentTime]);

    const currentWordIndex = useMemo(() => {
        if (!currentLine) return -1;
        return findCurrentWordIndex(currentLine, currentTime);
    }, [currentLine, currentTime]);

    return { currentLineIndex, currentWordIndex, lineProgress };
};
