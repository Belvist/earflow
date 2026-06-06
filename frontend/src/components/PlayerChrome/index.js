import React from 'react';
import MobilePlayerBar from '../MobilePlayerBar';
import PlayerChromePortal from './PlayerChromePortal';
import { PlayerChromeLayer } from './PlayerChromeLayer.styles';

/**
 * Mobile listener player chrome — mini-bar + full sheet via body portal (L3).
 * See docs/MOBILE_PLAYER_SHEET_DESIGN.md §2.
 */
export default function PlayerChrome(props) {
  return (
    <PlayerChromePortal>
      <PlayerChromeLayer data-testid="player-chrome-layer">
        <MobilePlayerBar {...props} />
      </PlayerChromeLayer>
    </PlayerChromePortal>
  );
}
