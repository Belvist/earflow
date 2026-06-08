/**
 * PEND-SEC-013 browser DoD helpers — real login path, no mocks.
 * Mirrors frontend proofAccessToken.js + deviceProof middleware behavior.
 */
(() => {
  const CANONICAL_V1 = (method, path, query, ts, nonce, sidHash) => [
    'v1', method, path, query, ts, nonce, sidHash,
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
        if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys');
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
    return { db, stored, privateKey, authDeviceId: stored.authDeviceId };
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

  async function loginViaEmail(email, password) {
    const resp = await fetch('/api/auth/email/login', {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Origin: window.location.origin,
      },
      body: JSON.stringify({ email, password }),
    });
    const data = await resp.json().catch(() => ({}));
    return { status: resp.status, ok: resp.ok, data };
  }

  async function ensureCsrfCookie() {
    const resp = await fetch('/api/auth/csrf', {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json', Origin: window.location.origin },
    });
    return { status: resp.status };
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

  async function loginRegisterDevice(email, password) {
    const login = await loginViaEmail(email, password);
    if (!login.ok) return { ok: false, step: 'login', login };
    await ensureCsrfCookie();
    if (!readCookie('mp_csrf')) {
      return { ok: false, step: 'csrf', origin: window.location.origin };
    }
    const material = await ensureDeviceMaterial(generateAuthDeviceId());
    const reg = await registerDevice(material);
    if (reg.status !== 200) {
      return { ok: false, step: 'register', reg };
    }
    return { ok: true, material };
  }

  async function exchangeProofAccessToken(material) {
    const proofHeaders = await buildProofHeaders(
      'POST',
      '/api/auth/proof/token',
      material.stored.sidHash,
      material,
    );
    const csrf = readCookie('mp_csrf');
    const resp = await fetch('/api/auth/proof/token', {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Origin: window.location.origin,
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...proofHeaders,
      },
    });
    const data = await resp.json().catch(() => ({}));
    return {
      status: resp.status,
      code: data.code || null,
      expiresIn: data.expiresIn,
      token: data.token || '',
      hasToken: !!data.token,
    };
  }

  async function fetchWithHeaders(method, path, extraHeaders, body) {
    const opts = {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        Origin: window.location.origin,
        ...extraHeaders,
      },
    };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const resp = await fetch(path, opts);
    const data = await resp.json().catch(() => ({}));
    return { status: resp.status, code: data.code || data.error || null, data };
  }

  async function hotProfileWithToken(material, token) {
    const sent = {
      'X-Auth-Device-Id': material.authDeviceId,
      'X-Auth-Proof-Access-Token': token,
    };
    const result = await fetchWithHeaders('GET', '/api/profile', sent);
    return {
      ...result,
      sentHeaders: {
        hasProofAccessToken: !!sent['X-Auth-Proof-Access-Token'],
        hasDeviceProof: false,
        hasDeviceId: !!sent['X-Auth-Device-Id'],
      },
    };
  }

  async function refreshWithFullProof(material) {
    const proofHeaders = await buildProofHeaders(
      'POST',
      '/api/auth/refresh',
      material.stored.sidHash,
      material,
    );
    return fetchWithHeaders('POST', '/api/auth/refresh', proofHeaders);
  }

  async function refreshTokenOnly(material, token) {
    return fetchWithHeaders('POST', '/api/auth/refresh', {
      'X-Auth-Device-Id': material.authDeviceId,
      'X-Auth-Proof-Access-Token': token,
    });
  }

  async function logoutTokenOnly(material, token) {
    const csrf = readCookie('mp_csrf');
    return fetchWithHeaders('POST', '/api/auth/logout', {
      'X-Auth-Device-Id': material.authDeviceId,
      'X-Auth-Proof-Access-Token': token,
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    });
  }

  async function listSessionsWithProof(material) {
    const proofHeaders = await buildProofHeaders(
      'GET',
      '/api/auth/sessions',
      material.stored.sidHash,
      material,
    );
    const result = await fetchWithHeaders('GET', '/api/auth/sessions', proofHeaders);
    return result;
  }

  async function revokeSessionWithProof(material, targetSid) {
    const proofHeaders = await buildProofHeaders(
      'POST',
      '/api/auth/sessions/revoke',
      material.stored.sidHash,
      material,
    );
    const csrf = readCookie('mp_csrf');
    return fetchWithHeaders(
      'POST',
      '/api/auth/sessions/revoke',
      {
        ...proofHeaders,
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      },
      { sid: targetSid },
    );
  }

  async function revokeSessionTokenOnly(material, token, targetSid) {
    const csrf = readCookie('mp_csrf');
    return fetchWithHeaders(
      'POST',
      '/api/auth/sessions/revoke',
      {
        'X-Auth-Device-Id': material.authDeviceId,
        'X-Auth-Proof-Access-Token': token,
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      },
      { sid: targetSid },
    );
  }

  async function readCurrentSid() {
    return readCookie('mp_sid') || '';
  }

  async function loadMaterial() {
    const db = await openDeviceDb();
    const stored = await idbGet(db, 'primary');
    if (!stored?.privateKey) {
      throw new Error('device_key_missing');
    }
    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      stored.privateKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
    return { db, stored, privateKey, authDeviceId: stored.authDeviceId };
  }

  window.__proofAccessTokenDod = {
    loginRegisterDevice,
    loadMaterial,
    exchangeProofAccessToken,
    hotProfileWithToken,
    refreshWithFullProof,
    refreshTokenOnly,
    logoutTokenOnly,
    listSessionsWithProof,
    revokeSessionWithProof,
    revokeSessionTokenOnly,
    readCurrentSid,
    buildProofHeaders,
  };
})();
