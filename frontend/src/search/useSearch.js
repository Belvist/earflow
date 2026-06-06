import { useMemo, useDeferredValue } from 'react';
import { buildIndex, search } from './searchCore';

export function useSearch(dataset, query, { topN = 30 } = {}) {
    const index = useMemo(() => {
        try {
            return buildIndex(dataset);
        } catch {
            return [];
        }
    }, [dataset]);

    const deferredQuery = useDeferredValue(query ?? '');

    const results = useMemo(() => {
        try {
            return search(index, deferredQuery, topN);
        } catch {
            return [];
        }
    }, [index, deferredQuery, topN]);

    return results;
}
