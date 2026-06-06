import { useEffect, useState } from 'react';

/**
 * Хук отслеживает состояние online/offline через browser API.
 * navigator.onLine — базовая проверка, которая иногда даёт false positive
 * (браузер считает, что есть сеть, но реально запросы не проходят).
 * При необходимости расширить ping-ом до /api/health.
 */
export function useOnlineStatus(): boolean {
    const [online, setOnline] = useState<boolean>(() => {
        if (typeof navigator === 'undefined') return true;
        return navigator.onLine !== false;
    });

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const handleOnline = () => setOnline(true);
        const handleOffline = () => setOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    return online;
}
