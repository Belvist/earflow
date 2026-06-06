import styled from 'styled-components';

/**
 * L3 portal host — must NOT cover the full viewport (nav sits at z-bottom-nav).
 * Children (mini bar, modal) are position:fixed to the viewport.
 */
export const PlayerChromeLayer = styled.div`
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: 0;
  overflow: visible;
  z-index: var(--z-sheet-overlay, 10050);
  pointer-events: none;
  isolation: isolate;

  & > * {
    pointer-events: auto;
  }
`;
