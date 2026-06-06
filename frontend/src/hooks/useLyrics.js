import { useCallback, useEffect, useRef, useState } from 'react';
import { lyricsCache } from '../services/lyricsCache';
import { useLyricsSync } from './useLyricsSync';

export const useLyricsData = (songId) => {
    const sid = songId === undefined || songId === null ? '' : String(songId).trim();
    const versionRef = useRef(lyricsCache.getVersion());

    const [state, setState] = useState(() => lyricsCache.getSnapshot(sid));

    const refresh = useCallback(() => {
        const next = lyricsCache.getSnapshot(sid);
        setState((prev) => {
            if (prev.loading === next.loading
                && prev.lyrics === next.lyrics
                && prev.hasLyrics === next.hasLyrics) return prev;
            return next;
        });
    }, [sid]);

    useEffect(() => {
        refresh();
        const unsub = lyricsCache.subscribe(() => {
            const v = lyricsCache.getVersion();
            if (v !== versionRef.current) {
                versionRef.current = v;
                refresh();
            }
        });
        if (sid) lyricsCache.request(sid);
        return unsub;
    }, [sid, refresh]);

    return state;
};

export const useLyrics = (songId, currentTime) => {
    const { loading, lyrics, hasLyrics } = useLyricsData(songId);
    const lines = lyrics?.lines || [];
    const { currentLineIndex, currentWordIndex, lineProgress } = useLyricsSync(lines, currentTime);

    return {
        lyrics,
        loading,
        hasLyrics,
        currentLineIndex,
        currentWordIndex,
        visibleLines: lines,
        lineProgress,
    };
};
