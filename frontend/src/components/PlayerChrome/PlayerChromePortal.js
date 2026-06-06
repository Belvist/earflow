import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export const PLAYER_CHROME_ROOT_ID = 'ef-player-chrome-root';

export function ensurePlayerChromeRoot() {
  if (typeof document === 'undefined') return null;

  let root = document.getElementById(PLAYER_CHROME_ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = PLAYER_CHROME_ROOT_ID;
    root.setAttribute('data-player-chrome-root', 'true');
    root.style.position = 'relative';
    root.style.zIndex = '10050';
    root.style.isolation = 'isolate';
    document.body.appendChild(root);
  }
  return root;
}

/**
 * L3 PlayerChrome — portal to document.body (gorhom / react-modal-sheet pattern).
 * Content scroll (L1) never wraps player chrome.
 */
export default function PlayerChromePortal({ children }) {
  const [root, setRoot] = useState(null);

  useEffect(() => {
    setRoot(ensurePlayerChromeRoot());
  }, []);

  if (!root) return null;
  return createPortal(children, root);
}
