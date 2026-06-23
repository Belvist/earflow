import { createContext, useContext } from 'react';

/**
 * Single source of truth for device-sync transport state. Populated by
 * DeviceSyncProvider (one useDeviceSync per app). Prevents duplicate
 * registration when both the silent bridge and Settings load the hook.
 */
export const DeviceSyncContext = createContext(null);

export function useDeviceSyncContext() {
    return useContext(DeviceSyncContext);
}
