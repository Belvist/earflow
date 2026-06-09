import type Redis from 'ioredis';

import { StreamTicketEpochCache } from './streamTicketEpochCache';

const DEFAULT_REVOKE_CHANNEL = 'earflow:auth:session:revoke:v1';

type RevokeEvent = {
    sid?: string;
    userId?: number;
    sessionEpoch?: number;
    reason?: string;
    issuedAt?: string;
};

function parseRevokeEvent(raw: string): RevokeEvent | null {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return null;
    try {
        const ev = JSON.parse(trimmed) as RevokeEvent;
        const sid = String(ev?.sid || '').trim();
        if (!sid) return null;
        return { ...ev, sid };
    } catch {
        return null;
    }
}

export function resolveRevokeChannel(): string {
    const raw = String(Bun.env.STREAM_TICKET_REVOKE_CHANNEL || Bun.env.AUTH_REVOKE_PUBSUB_CHANNEL || '').trim();
    return raw || DEFAULT_REVOKE_CHANNEL;
}

export function startStreamTicketRevokeSubscriber(params: {
    redis: Redis;
    epochCache: StreamTicketEpochCache;
    channel?: string;
}): void {
    const channel = String(params.channel || resolveRevokeChannel()).trim() || DEFAULT_REVOKE_CHANNEL;
    const sub = params.redis.duplicate();

    sub.on('error', () => {
        // silent reconnect loop
    });

    const subscribe = () => {
        sub.subscribe(channel).catch(() => {
            setTimeout(subscribe, 500);
        });
    };

    sub.on('message', (_ch: string, payload: string) => {
        const ev = parseRevokeEvent(payload);
        if (!ev?.sid) return;
        params.epochCache.markSessionRevoked(ev.sid);
        const epoch = Number(ev.sessionEpoch);
        if (Number.isFinite(epoch) && epoch > 0) {
            params.epochCache.bumpSessionEpoch(ev.sid, Math.trunc(epoch));
        }
    });

    sub.on('ready', subscribe);
    if (sub.status === 'ready') subscribe();
}
