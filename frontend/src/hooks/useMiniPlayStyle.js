import { useCallback, useSyncExternalStore } from 'react';
import {
  getMiniPlayStyle,
  setMiniPlayStyle,
  subscribeMiniPlayStyle,
  MINI_PLAY_STYLE,
} from '../utils/miniPlayStyle';

export { MINI_PLAY_STYLE };

export default function useMiniPlayStyle() {
  const style = useSyncExternalStore(
    subscribeMiniPlayStyle,
    getMiniPlayStyle,
    () => MINI_PLAY_STYLE.ADAPTIVE,
  );

  const setStyle = useCallback((next) => setMiniPlayStyle(next), []);

  return {
    style,
    isAdaptive: style === MINI_PLAY_STYLE.ADAPTIVE,
    isMetallic: style === MINI_PLAY_STYLE.METALLIC,
    setStyle,
  };
}
