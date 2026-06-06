import React, { useMemo, useRef, useState, useEffect } from 'react';
import { usePlayer } from '../../context/PlayerContext';
import { usePlayerStoreSnapshot } from '../../hooks/usePlayerStoreSnapshot';
import useTrackWaveformPeaks from '../../hooks/useTrackWaveformPeaks';
import { useSeekableProgress } from '../hooks/useSeekableProgress';
import { WaveformRow, WaveBar } from './HomeDesktopHeroV3.styles';

/**
 * Hero waveform — peaks from API; seek via shared useSeekableProgress + PlayerContext.
 * Single source: currentTimeRef + PlayerStore (patched on seek preview/commit).
 */
const MIN_BARS = 96;
const MAX_BARS = 160;
const PX_PER_BAR = 3;

function barCountForWidth(widthPx) {
  const w = Number(widthPx) || 520;
  return Math.max(MIN_BARS, Math.min(MAX_BARS, Math.floor(w / PX_PER_BAR)));
}

function progressToBarIndex(percent, count) {
  if (count <= 1) return 0;
  const p = Math.max(0, Math.min(100, percent));
  return Math.min(count - 1, Math.round((p / 100) * (count - 1)));
}

export default function HeroWaveformSeek({
  track,
  isPlaying = false,
  fullWidth = false,
}) {
  const player = usePlayer();
  const store = usePlayerStoreSnapshot();
  const rowRef = useRef(null);
  const [barCount, setBarCount] = useState(128);

  useEffect(() => {
    const el = rowRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;

    const update = () => {
      const w = el.getBoundingClientRect().width;
      setBarCount(barCountForWidth(w));
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { peaks: rawPeaks } = useTrackWaveformPeaks(track, { barCount });

  const peaks = useMemo(() => {
    if (!rawPeaks?.length) return rawPeaks;
    if (rawPeaks.length === barCount) return rawPeaks;
    if (rawPeaks.length < 2) return rawPeaks;

    const out = [];
    for (let i = 0; i < barCount; i += 1) {
      const t = (i / Math.max(1, barCount - 1)) * (rawPeaks.length - 1);
      const i0 = Math.floor(t);
      const i1 = Math.min(rawPeaks.length - 1, i0 + 1);
      const f = t - i0;
      out.push(rawPeaks[i0] * (1 - f) + rawPeaks[i1] * f);
    }
    return out;
  }, [rawPeaks, barCount]);

  const durationSec = useMemo(() => {
    const d = Number(player?.durationRaw || store.duration || 0);
    return Number.isFinite(d) && d > 0 ? d : 0;
  }, [player?.durationRaw, store.duration]);

  const {
    displayPercent,
    isSeeking: localSeeking,
    seekHandlers,
  } = useSeekableProgress({
    currentTimeRef: player.currentTimeRef,
    durationRaw: durationSec,
    isSeeking: store.isSeeking,
    disabled: !durationSec,
    onBeginSeek: player.beginSeek,
    onCommitSeek: player.commitSeek,
    onPreviewSeek: player.updateSeek,
  });

  const showPreview = localSeeking || Boolean(store.isSeeking);
  const activeThrough = progressToBarIndex(displayPercent, peaks.length);

  const bars = useMemo(
    () => peaks.map((h, i) => ({
      id: i,
      h: Math.round(Math.max(10, Math.min(100, h * 100))),
      past: i <= activeThrough,
    })),
    [peaks, activeThrough],
  );

  return (
    <WaveformRow
      ref={rowRef}
      $active={isPlaying}
      $fullWidth={fullWidth}
      $scrubbing={showPreview}
      style={{ '--wave-bars': String(bars.length), '--wave-progress': `${displayPercent}%` }}
      role="slider"
      aria-label="Позиция в треке"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(displayPercent)}
      tabIndex={0}
      data-player-no-drag
      {...seekHandlers}
      onKeyDown={(e) => {
        if (!durationSec) return;
        let next = displayPercent;
        if (e.key === 'ArrowRight') next = Math.min(100, displayPercent + 1);
        else if (e.key === 'ArrowLeft') next = Math.max(0, displayPercent - 1);
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = 100;
        else return;
        e.preventDefault();
        player?.beginSeek?.();
        player?.commitSeek?.(next);
      }}
    >
      {bars.map((bar) => (
        <WaveBar
          key={bar.id}
          $h={bar.h}
          $animate={false}
          $past={bar.past}
          $scrubbing={showPreview}
        />
      ))}
    </WaveformRow>
  );
}
