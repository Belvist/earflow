import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export default function DevicePreviewFrame({ children, mode }) {
  const preset = useMemo(() => {
    const m = (mode || '').toString();
    if (m === 'tablet') return { width: 768, height: 1024 };
    if (m === 'mobile') return { width: 390, height: 844 };
    return { width: 1024, height: 720 };
  }, [mode]);

  const frameWidth = clampNumber(preset.width, 320, 1600);
  const frameHeight = clampNumber(preset.height, 480, 1400);

  const viewportRef = useRef(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;

    const apply = (width) => {
      const w = Number(width);
      if (!Number.isFinite(w) || w <= 0) return;
      const next = Math.max(0.25, Math.min(1, (w - 24) / frameWidth));
      setScale((prev) => (Math.abs(prev - next) < 0.02 ? prev : next));
    };

    apply(el.clientWidth);

    const ro = new ResizeObserver((entries) => {
      const entry = Array.isArray(entries) && entries[0] ? entries[0] : null;
      const width = entry && entry.contentRect ? entry.contentRect.width : el.clientWidth;
      apply(width);
    });

    ro.observe(el);
    return () => {
      try {
        ro.disconnect();
      } catch {
      }
    };
  }, [frameWidth]);

  const scaledWidth = Math.max(1, frameWidth * scale);
  const scaledHeight = Math.max(1, frameHeight * scale);

  return (
    <Viewport ref={viewportRef}>
      <ScaledOuter style={{ width: `${scaledWidth.toFixed(3)}px`, height: `${scaledHeight.toFixed(3)}px` }}>
        <ScaledInner style={{ transform: `scale(${scale})` }}>
          <FrameShell $w={frameWidth} $h={frameHeight}>
            <FrameContent>
              {children}
            </FrameContent>
          </FrameShell>
        </ScaledInner>
      </ScaledOuter>
    </Viewport>
  );
}

const Viewport = styled.div`
  width: 100%;
  display: flex;
  justify-content: center;
  padding: 12px;
  overflow: hidden;
`;

const ScaledOuter = styled.div`
  display: block;
  flex: 0 0 auto;
`;

const ScaledInner = styled.div`
  transform-origin: top left;
`;

const FrameShell = styled.div`
  width: ${(p) => `${p.$w}px`};
  height: ${(p) => `${p.$h}px`};
  border-radius: 18px;
  overflow: hidden;
  border: 0;
  background: rgba(0, 0, 0, 0.55);
`;

const FrameContent = styled.div`
  width: 100%;
  height: 100%;
  background: #000;
  overflow: auto;
`;
