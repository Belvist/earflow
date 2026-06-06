/**
 * In-browser PoP helpers for live go-api-gateway e2e (pop-e2e-harness).
 * Loaded via page.addInitScript → window.__pop
 */
(() => {
  const CANONICAL_V1 = (method, path, query, ts, nonce, sidHash) => [
    'v1',
    method,
    path,
    query,
    ts,
    nonce,
    sidHash,
  ].join('\n');

  function readCookie(name) {
    const escaped = name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1');
    const m = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
    return m ? decodeURIComponent(m[1]) : '';
  }

  function generateAuthDeviceId() {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    let bin = '';
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    return `adev_${b64}`.slice(0, 64);
  }

  async function openDeviceDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('earflow.auth.device.v1', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('keys')) {
          db.createObjectStore('keys');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(db, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('keys', 'readonly');
      const req = tx.objectStore('keys').get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSet(db, key, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('keys', 'readwrite');
      tx.objectStore('keys').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function exportSpki(publicKey) {
    const raw = await crypto.subtle.exportKey('spki', publicKey);
    const bytes = new Uint8Array(raw);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  async function signProof(privateKey, body) {
    const sigBuf = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      new TextEncoder().encode(body),
    );
    const sigBytes = new Uint8Array(sigBuf);
    let sigBin = '';
    for (let i = 0; i < sigBytes.length; i += 1) sigBin += String.fromCharCode(sigBytes[i]);
    return btoa(sigBin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  async function ensureDeviceMaterial(authDeviceId) {
    const db = await openDeviceDb();
    let stored = await idbGet(db, 'primary');
    if (!stored?.privateKey) {
      const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
      );
      const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
      const publicKeySpki = await exportSpki(keyPair.publicKey);
      stored = {
        authDeviceId: authDeviceId || generateAuthDeviceId(),
        sidHash: '',
        publicKeySpki,
        privateKey: pkcs8,
      };
    }
    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      stored.privateKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
    return {
      db,
      stored,
      privateKey,
      authDeviceId: stored.authDeviceId,
    };
  }

  async function buildProofHeaders(method, path, sidHash, material) {
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = `nonce_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    const body = CANONICAL_V1(method, path, '', ts, nonce, sidHash || '');
    const proof = await signProof(material.privateKey, body);
    return {
      'X-Auth-Device-Id': material.authDeviceId,
      'X-Auth-Device-Proof': proof,
      'X-Auth-Device-Proof-Ts': ts,
      'X-Auth-Device-Proof-Nonce': nonce,
    };
  }

  async function seedSession() {
    const resp = await fetch('/e2e/seed-session', {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    const data = await resp.json().catch(() => ({}));
    return { status: resp.status, ok: resp.ok, data };
  }

  async function registerDevice(material) {
    const csrfToken = readCookie('mp_csrf');
    const resp = await fetch('/api/auth/device/register', {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Origin: window.location.origin,
      },
      body: JSON.stringify({
        authDeviceId: material.authDeviceId,
        publicKeySpki: material.stored.publicKeySpki,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.ok && data.sidHash) {
      material.stored.sidHash = data.sidHash;
      await idbSet(material.db, 'primary', material.stored);
    }
    return { status: resp.status, data };
  }

  async function fetchProfileWithProof(material) {
    const proofHeaders = await buildProofHeaders(
      'GET',
      '/api/profile',
      material.stored.sidHash,
      material,
    );
    const resp = await fetch('/api/profile', {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json', ...proofHeaders },
    });
    const data = await resp.json().catch(() => ({}));
    return {
      status: resp.status,
      code: data.code || null,
      hasUser: !!(data.id || data.userId),
    };
  }

  async function fetchProfileCookieOnly() {
    const resp = await fetch('/api/profile', {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    const data = await resp.json().catch(() => ({}));
    return { status: resp.status, code: data.code || null };
  }

  async function fetchRefreshCookieOnly() {
    const resp = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', Origin: window.location.origin },
    });
    const data = await resp.json().catch(() => ({}));
    return { status: resp.status, code: data.code || null };
  }

  async function hasIndexedDbDeviceKey() {
    try {
      const db = await openDeviceDb();
      if (!db.objectStoreNames.contains('keys')) return false;
      const stored = await idbGet(db, 'primary');
      return !!(stored && stored.privateKey);
    } catch {
      return false;
    }
  }

  async function loginWithDeviceProof() {
    const seed = await seedSession();
    if (!seed.ok) {
      return { ok: false, step: 'seed', seed };
    }
    const material = await ensureDeviceMaterial(generateAuthDeviceId());
    const reg = await registerDevice(material);
    if (reg.status !== 200) {
      return { ok: false, step: 'register', reg };
    }
    const profile = await fetchProfileWithProof(material);
    return {
      ok: profile.status === 200 && profile.hasUser,
      profile,
      material,
    };
  }

  async function profileWithStoredKey() {
    const db = await openDeviceDb();
    const stored = await idbGet(db, 'primary');
    if (!stored?.privateKey) {
      return { status: 0, code: 'NO_KEY' };
    }
    const material = await ensureDeviceMaterial(stored.authDeviceId);
    material.stored = stored;
    return fetchProfileWithProof(material);
  }

  window.__pop = {
    loginWithDeviceProof,
    fetchProfileWithProof,
    fetchProfileCookieOnly,
    fetchRefreshCookieOnly,
    hasIndexedDbDeviceKey,
    profileWithStoredKey,
  };
})();
