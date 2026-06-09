import { createClient } from 'redis';

import type { Config } from '../config';
import { StreamTicketEpochCache } from './streamTicketEpochCache';

const DEFAULT_REVOKE_CHANNEL = 'earflow:auth:session:revoke:v1';

type RevokeEvent = {
    sid?: string;
    sessionEpoch?: number;
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
    const raw = String(process.env.STREAM_TICKET_REVOKE_CHANNEL || process.env.AUTH_REVOKE_PUBSUB_CHANNEL || '').trim();
    return raw || DEFAULT_REVOKE_CHANNEL;
}

export function startStreamTicketRevokeSubscriber(params: {
    redisCfg: Config['streamTicket']['authRedis'];
    epochCache: StreamTicketEpochCache;
    channel?: string;
}): void {
    const channel = String(params.channel || resolveRevokeChannel()).trim() || DEFAULT_REVOKE_CHANNEL;
    const baseOpts = {
        socket: {
            host: params.redisCfg.host,
            port: params.redisCfg.port,
        },
        password: params.redisCfg.password || undefined,
    };

    const sub = createClient(baseOpts);
    sub.on('error', () => undefined);

    void (async () => {
        try {
            await sub.connect();
            await sub.subscribe(channel, (payload) => {
                const ev = parseRevokeEvent(payload);
                if (!ev?.sid) return;
                params.epochCache.markSessionRevoked(ev.sid);
                const epoch = Number(ev.sessionEpoch);
                if (Number.isFinite(epoch) && epoch > 0) {
                    params.epochCache.bumpSessionEpoch(ev.sid, Math.trunc(epoch));
                }
            });
        } catch {
            setTimeout(() => startStreamTicketRevokeSubscriber(params), 500);
        }
    })();
}
