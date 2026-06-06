export function parsePort(value: string | undefined, fallback: number): number {
    const n = value ? Number.parseInt(String(value), 10) : NaN;
    if (!Number.isFinite(n) || n <= 0 || n > 65535) return fallback;
    return n;
}
