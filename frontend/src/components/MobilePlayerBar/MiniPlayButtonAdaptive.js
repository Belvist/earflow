import React from 'react';
import { ADAPTIVE_PAUSE_RECTS, ADAPTIVE_PLAY_PATH } from './miniPlayAdaptivePaths';

/** Icon only — no circle; color from bar accent */
export default function MiniPlayButtonAdaptive({
  isPlaying = false,
  size = 28,
  iconColor = 'rgba(255, 255, 255, 0.94)',
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      className="ef-mini-play-adaptive-svg"
      style={{ color: iconColor, display: 'block', flexShrink: 0 }}
    >
      {isPlaying ? (
        ADAPTIVE_PAUSE_RECTS.map((r) => (
          <rect
            key={`${r.x}-${r.y}`}
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
            rx={r.rx}
            fill="currentColor"
          />
        ))
      ) : (
        <path d={ADAPTIVE_PLAY_PATH} fill="currentColor" />
      )}
    </svg>
  );
}
