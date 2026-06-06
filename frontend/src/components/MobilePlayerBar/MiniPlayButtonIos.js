import React, { useMemo } from 'react';
import { IOS_PAUSE_RECTS, IOS_PLAY_PATH } from './miniPlayAdaptivePaths';
import useDeviceTiltGlare, { requestDeviceTiltPermission } from './useDeviceTiltGlare';

const ICON_FILL = '#d8d8dc';

/**
 * iPhone 5s metallic — ref Frame 35/36: beveled ring, black inner, centered glyph.
 */
export default function MiniPlayButtonIos({
  isPlaying = false,
  size = 34,
  emphasis = 'normal',
}) {
  const uid = React.useId().replace(/:/g, '');
  const ringId = `ef-ios-ring-${uid}`;
  const tilt = useDeviceTiltGlare(true);

  const strokeW = emphasis === 'high' ? 3.35 : 3.1;
  const ringR = 13.55;
  const innerR = ringR - strokeW * 0.52;

  const grad = useMemo(() => {
    const dx = tilt.x * 2.8;
    const dy = tilt.y * 2.4;
    return {
      x1: 5 + dx,
      y1: 4 + dy,
      x2: 27 - dx,
      y2: 28 - dy,
    };
  }, [tilt.x, tilt.y]);

  const handlePrimeTilt = () => {
    requestDeviceTiltPermission();
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      className="ef-mini-play-ios-svg"
      style={{ display: 'block' }}
      onPointerDown={handlePrimeTilt}
    >
      <defs>
        <linearGradient
          id={ringId}
          gradientUnits="userSpaceOnUse"
          x1={grad.x1}
          y1={grad.y1}
          x2={grad.x2}
          y2={grad.y2}
        >
          <stop offset="0%" stopColor="#f4f4f6" />
          <stop offset="18%" stopColor="#ffffff" />
          <stop offset="42%" stopColor="#7c7c80" />
          <stop offset="62%" stopColor="#ebebf0" />
          <stop offset="82%" stopColor="#5a5a5e" />
          <stop offset="100%" stopColor="#9a9aa0" />
        </linearGradient>
      </defs>
      <circle
        cx="16"
        cy="16"
        r={ringR}
        fill="none"
        stroke={`url(#${ringId})`}
        strokeWidth={strokeW}
      />
      <circle cx="16" cy="16" r={innerR} fill="#070707" />
      {isPlaying ? (
        IOS_PAUSE_RECTS.map((r) => (
          <rect
            key={`${r.x}-${r.y}`}
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
            rx={r.rx}
            fill={ICON_FILL}
          />
        ))
      ) : (
        <path d={IOS_PLAY_PATH} fill={ICON_FILL} />
      )}
    </svg>
  );
}
