import { css } from 'styled-components';

export const desktopPanelPlacement = css`
  top: 76px;
  bottom: calc(var(--desktop-player-bar-height, 80px) + 8px);
  width: var(--panel-rail-width, clamp(360px, 29vw, 430px));
  max-width: calc(100vw - 40px);
`;

export const panelSurfaceFrame = css`
  background: rgba(17, 17, 19, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 18px;
  box-shadow: 0 18px 70px rgba(0, 0, 0, 0.68);
  backdrop-filter: blur(24px) saturate(1.08);
  -webkit-backdrop-filter: blur(24px) saturate(1.08);
`;

export const mobilePanelSurface = css`
  background: rgba(17, 17, 19, 0.99);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 20px 20px 0 0;
  box-shadow: 0 -14px 60px rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(24px) saturate(1.08);
  -webkit-backdrop-filter: blur(24px) saturate(1.08);
`;
