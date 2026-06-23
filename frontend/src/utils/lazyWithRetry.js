import React from 'react';

const RETRY_KEY_PREFIX = 'earflow_lazy_retry:';

function isChunkLoadFailure(err) {
  if (!err) return false;
  const msg = String(err.message || err);
  if (msg.includes('ChunkLoadError')) return true;
  if (/Loading chunk [\w.-]+ failed/i.test(msg)) return true;
  if (/Failed to fetch dynamically imported module/i.test(msg)) return true;
  return false;
}

/**
 * React.lazy with one automatic retry + single hard reload on stale chunk (dev HMR / SW cache).
 */
export function lazyWithRetry(factory, id) {
  const retryKey = `${RETRY_KEY_PREFIX}${id || factory.name || 'anonymous'}`;

  return React.lazy(() => factory().catch((err) => {
    if (!isChunkLoadFailure(err)) {
      throw err;
    }

    let retried = false;
    try {
      retried = sessionStorage.getItem(retryKey) === '1';
    } catch {
      retried = false;
    }

    if (!retried) {
      try {
        sessionStorage.setItem(retryKey, '1');
      } catch {
        /* ignore */
      }
      return new Promise((resolve) => {
        window.setTimeout(() => {
          factory()
            .then((mod) => {
              try {
                sessionStorage.removeItem(retryKey);
              } catch {
                /* ignore */
              }
              resolve(mod);
            })
            .catch((retryErr) => {
              throw retryErr;
            });
        }, 120);
      });
    }

    try {
      sessionStorage.removeItem(retryKey);
    } catch {
      /* ignore */
    }

    const url = new URL(window.location.href);
    if (!url.searchParams.has('_chunk')) {
      url.searchParams.set('_chunk', String(Date.now()));
      window.location.replace(url.toString());
      return new Promise(() => {});
    }

    throw err;
  }));
}

export default lazyWithRetry;
