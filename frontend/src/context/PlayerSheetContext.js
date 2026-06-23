import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';

const PlayerSheetContext = createContext({
  registerOpenFullPlayer: () => {},
  openFullPlayer: () => {},
});

export function PlayerSheetProvider({ children }) {
  const openRef = useRef(null);

  const registerOpenFullPlayer = useCallback((fn) => {
    openRef.current = fn == null || typeof fn === 'function' ? fn : null;
  }, []);

  const openFullPlayer = useCallback((...args) => {
    openRef.current?.(...args);
  }, []);

  const value = useMemo(
    () => ({ registerOpenFullPlayer, openFullPlayer }),
    [registerOpenFullPlayer, openFullPlayer],
  );

  return (
    <PlayerSheetContext.Provider value={value}>
      {children}
    </PlayerSheetContext.Provider>
  );
}

export function usePlayerSheet() {
  return useContext(PlayerSheetContext);
}

export default PlayerSheetContext;
