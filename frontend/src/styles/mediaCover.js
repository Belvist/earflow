import { css } from 'styled-components';

/** Portrait album art — 4:5 everywhere on home, player thumbs, lists */
export const COVER_ASPECT_RATIO = '4 / 5';

export const portraitCoverBox = css`
  aspect-ratio: ${COVER_ASPECT_RATIO};
  width: 100%;
  height: auto;
  overflow: hidden;
`;

export const portraitCoverImage = css`
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
`;

/** Mobile chrome: bottom nav (48) + mini player (44) — sync with App.js */
export const MOBILE_CHROME_OFFSET_PX = 92;

export const MOBILE_SHEET_Z_OVERLAY = 10050;
export const MOBILE_SHEET_Z_PANEL = 10051;

/**
 * Fixed-width portrait thumb for <img> in flex rows (party drawer, lists).
 * In fixed-height rows (mini player) prefer portraitCoverThumbByHeight — width-based
 * sizing can exceed the bar when height:auto resolves taller than the shell.
 */
export const portraitCoverThumb = (widthPx) => css`
  width: ${widthPx}px;
  height: auto;
  aspect-ratio: ${COVER_ASPECT_RATIO};
  max-height: 100%;
  flex-shrink: 0;
  border-radius: 8px;
  object-fit: cover;
  display: block;
  background: rgba(255, 255, 255, 0.08);
`;

/** Portrait thumb capped by height — use in mini-player and other fixed-height chrome. */
export const portraitCoverThumbByHeight = (heightPx) => css`
  height: ${heightPx}px;
  width: auto;
  aspect-ratio: ${COVER_ASPECT_RATIO};
  flex-shrink: 0;
  border-radius: 5px;
  object-fit: cover;
  display: block;
  background: rgba(255, 255, 255, 0.08);
`;

export const MINI_PLAYER_COVER_HEIGHT_PX = 28;
