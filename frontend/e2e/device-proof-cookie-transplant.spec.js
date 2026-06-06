/**
 * PoP browser contract: cookie transplant without IndexedDB private key must fail.
 *
 * Context A: session cookies + device proof → /api/profile 200
 * Context B: same cookies only, fresh storage (no IDB key) → 401 DEVICE_PROOF_REQUIRED
 * Context A: still 200 after B
 */
const { test, expect, chromium } = require('@playwright/test');
const { installPopGatewayRoutes, DEFAULT_USER } = require('./helpers/popGatewayMock');

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const SID = 'sid_e2e_pop_transplant_0001';
const AUTH_DEVICE_ID = 'adev_e2e_pop_device_00001';

function sessionCookiesForBase(baseUrl) {
  return [
    { name: 'mp_sid', value: SID, url: baseUrl, sameSite: 'Lax' },
    { name: 'mp_csrf', value: 'e2e-pop-csrf', url: baseUrl, sameSite: 'Lax' },
  ];
}

/** In-browser: IndexedDB key + signed fetch to /api/profile (mirrors authDeviceCrypto). */
async function fetchProfileWithDeviceProof(page) {
  return page.evaluate(async ({ authDeviceId, sidHash }) => {
    const canonical = (method, path, query, ts, nonce, hash) => [
      'v1',
      method,
      path,
      query,
      ts,
      nonce,
      hash,
    ].join('\n');

    const openDb = () => new Promise((resolve, reject) => {
      const req = indexedDB.open('earflow.auth.device.v1', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const idbGet = async (db, key) => new Promise((resolve, reject) => {
      const tx = db.transaction('keys', 'readonly');
      const store = tx.objectStore('keys');
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });

    const idbSet = async (db, key, value) => new Promise((resolve, reject) => {
      const tx = db.transaction('keys', 'readwrite');
      tx.objectStore('keys').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    const exportSpki = async (publicKey) => {
      const raw = await crypto.subtle.exportKey('spki', publicKey);
      const bytes = new Uint8Array(raw);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    };

    const db = await openDb();
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
        authDeviceId,
        sidHash,
        publicKeySpki,
        privateKey: pkcs8,
      };
      await idbSet(db, 'primary', {
        authDeviceId: stored.authDeviceId,
        sidHash: stored.sidHash || sidHash,
        publicKeySpki: stored.publicKeySpki,
        privateKey: pkcs8,
      });
    }

    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      stored.privateKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );

    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = `nonce_${Math.random().toString(36).slice(2)}`;
    const body = canonical('GET', '/api/profile', '', ts, nonce, stored.sidHash || sidHash);
    const sigBuf = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      new TextEncoder().encode(body),
    );
    const sigBytes = new Uint8Array(sigBuf);
    let sigBin = '';
    for (let i = 0; i < sigBytes.length; i += 1) sigBin += String.fromCharCode(sigBytes[i]);
    const proof = btoa(sigBin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

    const resp = await fetch('/api/profile', {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'X-Auth-Device-Id': stored.authDeviceId || authDeviceId,
        'X-Auth-Device-Proof': proof,
        'X-Auth-Device-Proof-Ts': ts,
        'X-Auth-Device-Proof-Nonce': nonce,
      },
    });
    const data = await resp.json().catch(() => ({}));
    return { status: resp.status, code: data.code || null, hasUser: !!(data.id || data.userId) };
  }, { authDeviceId: AUTH_DEVICE_ID, sidHash: 'e2e-sid-hash-mock' });
}

async function fetchProfileCookieOnly(page) {
  return page.evaluate(async () => {
    const resp = await fetch('/api/profile', {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    const data = await resp.json().catch(() => ({}));
    return { status: resp.status, code: data.code || null };
  });
}

async function hasIndexedDbDeviceKey(page) {
  return page.evaluate(async () => {
    try {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('earflow.auth.device.v1', 1);
        req.onupgradeneeded = () => {
          const database = req.result;
          if (!database.objectStoreNames.contains('keys')) {
            database.createObjectStore('keys');
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      if (!db.objectStoreNames.contains('keys')) return false;
      return await new Promise((resolve) => {
        const tx = db.transaction('keys', 'readonly');
        const req = tx.objectStore('keys').get('primary');
        req.onsuccess = () => resolve(!!(req.result && req.result.privateKey));
        req.onerror = () => resolve(false);
        tx.onerror = () => resolve(false);
      });
    } catch {
      return false;
    }
  });
}

test.describe('PoP cookie transplant (two browser contexts)', () => {
  test('stolen mp_sid+mp_csrf without private key cannot load profile', async () => {
    const browser = await chromium.launch();

    const contextA = await browser.newContext({ baseURL: BASE });
    await contextA.addCookies(sessionCookiesForBase(BASE));
    const pageA = await contextA.newPage();
    await installPopGatewayRoutes(pageA);
    await pageA.goto('/');

    const withProofA = await fetchProfileWithDeviceProof(pageA);
    expect(withProofA.status).toBe(200);
    expect(withProofA.hasUser).toBe(true);
    expect(await hasIndexedDbDeviceKey(pageA)).toBe(true);

    const contextB = await browser.newContext({ baseURL: BASE });
    await contextB.addCookies(sessionCookiesForBase(BASE));
    const pageB = await contextB.newPage();
    await installPopGatewayRoutes(pageB);
    await pageB.goto('/');

    expect(await hasIndexedDbDeviceKey(pageB)).toBe(false);
    const cookieOnlyB = await fetchProfileCookieOnly(pageB);
    expect(cookieOnlyB.status).toBe(401);
    expect(cookieOnlyB.code).toBe('DEVICE_PROOF_REQUIRED');

    const withProofAAgain = await fetchProfileWithDeviceProof(pageA);
    expect(withProofAAgain.status).toBe(200);

    await browser.close();
  });
});
