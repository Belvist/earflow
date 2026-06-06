import { useEffect, useRef } from 'react';
import { QUEUE_SOURCES } from './constants';

const REFILL_TRIGGER_REMAINING = 5;
const REFILL_BATCH_SIZE = 40;
const MIN_HEALTHY_AUTO_QUEUE = 20;
const REFILL_MIN_INTERVAL_MS = 10_000;
const SHORT_QUEUE_REFILL_MIN_INTERVAL_MS = 30_000;

export function useQueueAutoRefill({ queueSource, currentTrackIndex, tracksLength, recommendations }) {
    const inFlightRef = useRef(false);
    const lastRefillAtRef = useRef(0);
    const getInfiniteFeedRef = useRef(null);

    useEffect(() => {
        getInfiniteFeedRef.current = recommendations?.getInfiniteFeed ?? null;
    }, [recommendations?.getInfiniteFeed]);

    useEffect(() => {
        if (queueSource !== QUEUE_SOURCES.AUTO) return;
        if (recommendations?.loading) return;
        if (tracksLength <= 0) return;

        if (recommendations?.hasMore === false) return;

        const remaining = tracksLength - currentTrackIndex - 1;
        const queueTooShort = tracksLength < MIN_HEALTHY_AUTO_QUEUE;
        if (!queueTooShort && remaining > REFILL_TRIGGER_REMAINING) return;

        const now = Date.now();
        if (inFlightRef.current) return;
        const minInterval = queueTooShort ? SHORT_QUEUE_REFILL_MIN_INTERVAL_MS : REFILL_MIN_INTERVAL_MS;
        if (now - lastRefillAtRef.current < minInterval) return;

        const getInfiniteFeed = getInfiniteFeedRef.current;
        if (typeof getInfiniteFeed !== 'function') return;

        inFlightRef.current = true;
        lastRefillAtRef.current = now;

        Promise.resolve(getInfiniteFeed(REFILL_BATCH_SIZE, { background: true }))
            .catch(() => undefined)
            .finally(() => {
                inFlightRef.current = false;
            });
    }, [queueSource, currentTrackIndex, tracksLength, recommendations?.hasMore, recommendations?.loading]);
}
