import './consoleSilence';

import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';
import { initAppViewport } from './utils/appViewport';
import { syncListenerUiToDocument } from './preferences/listenerUiPrefs';
import { AuthProvider } from './context/AuthContext';

initAppViewport();
syncListenerUiToDocument();

const shouldRecoverChunkError = (err) => {
  const msg = String(err && (err.message || err.reason?.message || err.reason) || '');
  if (!msg) return false;
  if (msg.includes('ChunkLoadError')) return true;
  if (/Loading chunk [\w.-]+ failed/i.test(msg)) return true;
  if (/CSS_CHUNK_LOAD_FAILED/i.test(msg)) return true;
  return false;
};

const recoverFromChunkError = async () => {
  const key = '__earflow_chunk_recover_at';
  const now = Date.now();
  try {
    const last = Number(sessionStorage.getItem(key) || '0');
    if (Number.isFinite(last) && last > 0 && now - last < 5 * 60_000) {
      return;
    }
    sessionStorage.setItem(key, String(now));
  } catch {
  }

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
    }
  } catch {
  }

  try {
    if (typeof caches !== 'undefined' && caches && typeof caches.keys === 'function') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)));
    }
  } catch {
  }

  try {
    const url = new URL(window.location.href);
    url.searchParams.set('_r', String(now));
    window.location.replace(url.toString());
  } catch {
    try {
      window.location.reload();
    } catch {
    }
  }
};

window.addEventListener('error', (event) => {
  const e = event?.error;
  if (!shouldRecoverChunkError(e)) return;
  void recoverFromChunkError();
});

window.addEventListener('unhandledrejection', (event) => {
  if (!shouldRecoverChunkError(event)) return;
  void recoverFromChunkError();
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);

// Регистрируем Service Worker для офлайн shell и фонового воспроизведения.
// Включён по умолчанию в production. Явно отключается через
// REACT_APP_DISABLE_SERVICE_WORKER=true или REACT_APP_STABILIZE_SERVICE_WORKER=true.
const disableServiceWorker = String(process.env.REACT_APP_DISABLE_SERVICE_WORKER || '').toLowerCase() === 'true';
const stabilizeServiceWorker = String(process.env.REACT_APP_STABILIZE_SERVICE_WORKER || '').toLowerCase() === 'true';
const isProduction = process.env.NODE_ENV === 'production';

if (disableServiceWorker || stabilizeServiceWorker || !isProduction) {
  serviceWorkerRegistration.unregister();
} else {
  serviceWorkerRegistration.register();
}
