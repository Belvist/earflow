export type ByteRange = { start: number; end?: number } | { suffix: number };

const MAX_RANGE_BYTES = 8 * 1024 * 1024;

export function parseRangeHeader(rangeHeader: string | null): ByteRange | null {
    if (!rangeHeader) return null;
    const raw = String(rangeHeader).trim();
    const m = /^bytes=(\d*)-(\d*)$/i.exec(raw);
    if (!m) return null;

    const a = m[1] ?? '';
    const b = m[2] ?? '';

    if (a === '' && b === '') return null;

    if (a === '') {
        const suffix = Number.parseInt(b, 10);
        if (!Number.isFinite(suffix) || suffix <= 0) return null;
        if (suffix > MAX_RANGE_BYTES) return null;
        return { suffix: suffix >>> 0 };
    }

    const start = Number.parseInt(a, 10);
    if (!Number.isFinite(start) || start < 0) return null;

    if (b === '') {
        const end = start + (MAX_RANGE_BYTES - 1);
        return { start: start >>> 0, end: end >>> 0 };
    }

    const end = Number.parseInt(b, 10);
    if (!Number.isFinite(end) || end < start) return null;

    if ((end - start + 1) > MAX_RANGE_BYTES) return null;

    return { start: start >>> 0, end: end >>> 0 };
}
