import React from 'react';
import { useDeviceSyncContext } from '../../context/DeviceSyncContext';
import useAuth from '../../hooks/useAuth';
import DevicesPanel from './DevicesPanel';

/**
 * Thin wiring component. Glues the dumb hook to the dumb view.
 *
 * No business logic here either — just passes arrays/primitives from the
 * hook to the panel and forwards click handlers. If you want to change
 * behavior, change device-sync-service.
 */

export default function DeviceSyncSection() {
    const { isAuthenticated } = useAuth();
    const device = useDeviceSyncContext();

    if (!isAuthenticated || !device || !device.enabled) {
        return null;
    }

    return (
        <DevicesPanel
            devices={device.devices}
            nowPlaying={device.nowPlaying}
            currentDeviceId={device.deviceId}
            connectionState={device.connectionState}
            onTransfer={device.transferTo}
            onRemove={device.removeDevice}
            onReconnect={device.reconnectNow}
        />
    );
}
