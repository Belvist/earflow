import { useEffect, useMemo, useState } from 'react';
import apiClient from '../api/client';
import { fallbackPeaksForTrack } from '../utils/trackWaveformPeaks';

const memoryCache = new Map();

function cacheKey(trackId, barCount) {
  return `${trackId}:${barCount}`;
}

/**
 * Server-owned waveform peaks — GET /api/songs/:id/waveform (transcode-worker).
 * Fallback placeholder while pending or on error (never client stream decode).
 */
export default function useTrackWaveformPeaks(track, opts = {}) {
  const barCount = opts.barCount ?? 128;
  const enabled = opts.enabled !== false;
  const trackId = track?.id ?? track?.song_id ?? null;

  const fallback = useMemo(
    () => fallbackPeaksForTrack(track, barCount),
    [track, barCount],
  );

  const [peaks, setPeaks] = useState(fallback);
  const [source, setSource] = useState('fallback');

  useEffect(() => {
    setPeaks(fallback);
    setSource('fallback');
  }, [fallback, trackId]);

  useEffect(() => {
    if (!enabled || trackId === null || trackId === undefined || trackId === '') {
      return undefined;
    }

    const key = cacheKey(trackId, barCount);
    const cached = memoryCache.get(key);
    if (cached?.peaks?.length) {
      setPeaks(cached.peaks);
      setSource('api');
      return undefined;
    }

    const ac = new AbortController();
    let cancelled = false;

    apiClient.getSongWaveform(trackId, { bars: barCount, signal: ac.signal })
      .then((payload) => {
        if (cancelled || ac.signal.aborted) return;
        if (Array.isArray(payload?.peaks) && payload.peaks.length) {
          memoryCache.set(key, payload);
          setPeaks(payload.peaks);
          setSource('api');
          return;
        }
        setPeaks(fallback);
        setSource(payload?.status === 'pending' ? 'pending' : 'fallback');
      })
      .catch(() => {
        if (cancelled) return;
        setPeaks(fallback);
        setSource('fallback');
      });

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [trackId, barCount, enabled, fallback]);

  return { peaks, source, barCount };
}
