import { useCallback, useRef, useState } from 'react';

export function useStepUpRunner() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const pendingRef = useRef(null);
  const retryRef = useRef(0);

  const request = useCallback((fn) => {
    pendingRef.current = typeof fn === 'function' ? fn : null;
    retryRef.current = 0;
    setError('');
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    pendingRef.current = null;
    retryRef.current = 0;
    setError('');
    setOpen(false);
  }, []);

  const onSuccess = useCallback(async () => {
    const fn = pendingRef.current;
    if (typeof fn !== 'function') {
      close();
      return;
    }

    retryRef.current += 1;
    setOpen(false);
    try {
      const ok = await fn({ stepUpRetry: retryRef.current });
      if (ok === true) {
        close();
        return;
      }
      if (retryRef.current >= 1) {
        pendingRef.current = null;
        setError('Подтверждение не применилось. Обновите страницу и попробуйте снова.');
      }
    } catch {
      if (retryRef.current >= 1) {
        pendingRef.current = null;
        setError('Не удалось выполнить действие после подтверждения.');
      }
    }
  }, [close]);

  return {
    stepUp: {
      open,
      error,
      request,
      close,
      onSuccess,
    },
  };
}
