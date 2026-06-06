import { useEffect, useRef } from 'react';
import useAuth from '../hooks/useAuth';
import apiClient from '../api/client';
import { hydrateListenerUiFromServer } from './listenerUiPrefs';

/**
 * Loads listener_ui from server when session is authenticated.
 * Mount once inside App (under auth + api client).
 */
export default function ListenerUiPrefsSync() {
  const { status, user } = useAuth();
  const userId = user?.id || user?.userId || null;
  const hydratedForRef = useRef(null);

  useEffect(() => {
    if (status !== 'authenticated' || !userId) {
      hydratedForRef.current = null;
      return;
    }
    if (hydratedForRef.current === userId) return;

    let cancelled = false;
    (async () => {
      try {
        const settings = await apiClient.getUserSettings();
        if (cancelled || !settings?.listener_ui) return;
        hydrateListenerUiFromServer(settings.listener_ui);
        hydratedForRef.current = userId;
      } catch {
        // keep local cache
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, userId]);

  return null;
}
