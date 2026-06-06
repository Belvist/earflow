import React from 'react';
import styled from 'styled-components';

const Root = styled.div`
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
`;

const AccentFill = styled.div`
  position: absolute;
  inset: 0;
  background: ${(p) => p.$color || '#0a0a0a'};
`;

const DarkenOverlay = styled.div`
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(0, 0, 0, 0.18) 0%,
    rgba(0, 0, 0, 0.38) 42%,
    rgba(0, 0, 0, 0.78) 100%
  );
  pointer-events: none;
`;

/** Cover-derived accent fill + darken (no canvas blur). */
export default function PlayerBackdrop({ accentColor, style }) {
  return (
    <Root style={style} aria-hidden="true">
      <AccentFill $color={accentColor || '#0a0a0a'} />
      <DarkenOverlay />
    </Root>
  );
}
