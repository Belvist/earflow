export class StreamTicketEpochCache {
    private sessions = new Map<string, number>();
    private devices = new Map<string, number>();
    private revokedSids = new Set<string>();

    bumpSessionEpoch(sid: string, epoch: number): void {
        const key = String(sid || '').trim();
        if (!key || !Number.isFinite(epoch) || epoch <= 0) return;
        const prev = this.sessions.get(key) ?? 0;
        if (epoch > prev) this.sessions.set(key, Math.trunc(epoch));
    }

    bumpDeviceEpoch(authDeviceId: string, epoch: number): void {
        const key = String(authDeviceId || '').trim();
        if (!key || !Number.isFinite(epoch) || epoch <= 0) return;
        const prev = this.devices.get(key) ?? 0;
        if (epoch > prev) this.devices.set(key, Math.trunc(epoch));
    }

    markSessionRevoked(sid: string): void {
        const key = String(sid || '').trim();
        if (key) this.revokedSids.add(key);
    }

    isSessionRevoked(sid: string): boolean {
        const key = String(sid || '').trim();
        return key ? this.revokedSids.has(key) : false;
    }

    sessionEpochStale(sid: string, tokenEpoch: number): boolean {
        const key = String(sid || '').trim();
        if (!key || !Number.isFinite(tokenEpoch)) return false;
        const floor = this.sessions.get(key);
        return floor !== undefined && floor > Math.trunc(tokenEpoch);
    }

    deviceEpochStale(authDeviceId: string, tokenEpoch: number): boolean {
        const key = String(authDeviceId || '').trim();
        if (!key || !Number.isFinite(tokenEpoch)) return false;
        const floor = this.devices.get(key);
        return floor !== undefined && floor > Math.trunc(tokenEpoch);
    }
}
