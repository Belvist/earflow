import React, { createContext, useContext } from 'react';
import { useOfflineTracks } from './useOfflineTracks';

type OfflineContextValue = ReturnType<typeof useOfflineTracks>;

const OfflineContext = createContext<OfflineContextValue | null>(null);

interface OfflineProviderProps {
    children: React.ReactNode;
    apiClient: {
        getSongDirectSession?: (_id: string | number, _opts?: { signal?: AbortSignal }) => Promise<any>;
    } | null;
}

export const OfflineProvider: React.FC<OfflineProviderProps> = ({ children, apiClient }) => {
    const value = useOfflineTracks({ apiClient });
    return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
};

export function useOffline(): OfflineContextValue {
    const ctx = useContext(OfflineContext);
    if (!ctx) throw new Error('useOffline must be used within OfflineProvider');
    return ctx;
}

export function useOfflineOptional(): OfflineContextValue | null {
    return useContext(OfflineContext);
}
