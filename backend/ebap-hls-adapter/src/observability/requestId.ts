export function createRequestId(): string {
    const c: any = (globalThis as any).crypto;
    if (c && typeof c.randomUUID === 'function') return String(c.randomUUID());
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
