import { useCallback, useSyncExternalStore } from 'react';
import {
  getMiniBarVariant,
  setMiniBarVariant,
  subscribeMiniBarVariant,
  MINI_BAR_VARIANT,
} from '../utils/miniBarVariant';

export { MINI_BAR_VARIANT };

export default function useMiniBarVariant() {
  const variant = useSyncExternalStore(
    subscribeMiniBarVariant,
    getMiniBarVariant,
    () => MINI_BAR_VARIANT.FLOATING,
  );

  const setVariant = useCallback((next) => setMiniBarVariant(next), []);

  return {
    variant,
    isFloating: variant === MINI_BAR_VARIANT.FLOATING,
    isClassic: variant === MINI_BAR_VARIANT.CLASSIC,
    setVariant,
  };
}

/** Back-compat wrapper; variant sync no longer depends on React context. */
export function MiniBarVariantProvider({ children }) {
  return children;
}
