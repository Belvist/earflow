const DB_NAME = 'earflow.auth.device.v1';
const DB_STORE = 'keys';
const IDB_KEY = 'primary';

const DEVICE_PROOF_BYPASS =
  String(process.env.REACT_APP_ALLOW_COOKIE_AUTH_WITHOUT_PROOF || '').trim() === '1';

export function isDeviceProofEnforced() {
  if (DEVICE_PROOF_BYPASS) return false;
  if (process.env.NODE_ENV === 'production') return true;
  return String(process.env.REACT_APP_DEVICE_PROOF_REQUIRED || '1').trim() !== '0';
}

function getCrypto() {
  if (typeof window !== 'undefined' && window.crypto?.subtle) return window.crypto;
  return null;
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexeddb_unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb_open_failed'));
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const store = tx.objectStore(DB_STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    store.put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAuthDeviceState() {
  try {
    await idbSet(IDB_KEY, null);
  } catch {
    // ignore
  }
}

export function generateAuthDeviceId() {
  const cryptoApi = getCrypto();
  const bytes = new Uint8Array(24);
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `adev_${b64}`.slice(0, 64);
}

async function exportPublicKeySpki(publicKey) {
  const cryptoApi = getCrypto();
  const raw = await cryptoApi.subtle.exportKey('spki', publicKey);
  const bytes = new Uint8Array(raw);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function ensureKeyPair() {
  const cryptoApi = getCrypto();
  if (!cryptoApi?.subtle) throw new Error('webcrypto_unavailable');

  const stored = await idbGet(IDB_KEY);
  if (stored?.privateKey && stored?.authDeviceId && stored?.sidHash) {
    try {
      const privateKey = await cryptoApi.subtle.importKey(
        'pkcs8',
        stored.privateKey,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign'],
      );
      return {
        authDeviceId: stored.authDeviceId,
        sidHash: stored.sidHash,
        privateKey,
        publicKeySpki: stored.publicKeySpki,
      };
    } catch {
      // fall through to regenerate
    }
  }

  const authDeviceId = generateAuthDeviceId();
  const keyPair = await cryptoApi.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const publicKeySpki = await exportPublicKeySpki(keyPair.publicKey);
  const pkcs8 = await cryptoApi.subtle.exportKey('pkcs8', keyPair.privateKey);

  return {
    authDeviceId,
    sidHash: null,
    privateKey: keyPair.privateKey,
    publicKeySpki,
    pkcs8,
    needsRegister: true,
  };
}

export async function persistAuthDeviceRecord({ authDeviceId, sidHash, privateKey, publicKeySpki, pkcs8 }) {
  const cryptoApi = getCrypto();
  let pkcs8Buf = pkcs8;
  if (!pkcs8Buf && privateKey) {
    pkcs8Buf = await cryptoApi.subtle.exportKey('pkcs8', privateKey);
  }
  await idbSet(IDB_KEY, {
    authDeviceId,
    sidHash: sidHash || '',
    publicKeySpki: publicKeySpki || '',
    privateKey: pkcs8Buf,
  });
}

export async function invalidateAuthDeviceBinding() {
  try {
    const stored = await idbGet(IDB_KEY);
    if (!stored || typeof stored !== 'object') return;
    await idbSet(IDB_KEY, {
      ...stored,
      sidHash: '',
    });
  } catch {
    // ignore
  }
}

function normalizeProofPath(path) {
  const p = String(path || '').trim() || '/';
  return p.startsWith('/') ? p : `/${p}`;
}

function normalizeProofQuery(search) {
  const raw = String(search || '').replace(/^\?/, '');
  if (!raw) return '';
  const params = new URLSearchParams(raw);
  const keys = [...params.keys()].sort();
  const parts = [];
  for (const k of keys) {
    const vals = params.getAll(k).sort();
    for (const v of vals) {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
  }
  return parts.join('&');
}

function proofPathFromInput(urlOrPath) {
  const raw = String(urlOrPath || '').trim();
  if (!raw) return '/';
  try {
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      const pathname = new URL(raw).pathname;
      try {
        return normalizeProofPath(decodeURIComponent(pathname));
      } catch {
        return normalizeProofPath(pathname);
      }
    }
  } catch {
    // fall through
  }
  const withoutQuery = raw.split('?')[0];
  try {
    return normalizeProofPath(decodeURIComponent(withoutQuery));
  } catch {
    return normalizeProofPath(withoutQuery);
  }
}

export function buildCanonicalProofString(method, url, timestamp, nonce, sidHash) {
  let query = '';
  try {
    const raw = String(url || '').trim();
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      const u = new URL(raw);
      query = normalizeProofQuery(u.search);
    } else {
      const qIdx = raw.indexOf('?');
      if (qIdx >= 0) {
        query = normalizeProofQuery(raw.slice(qIdx));
      }
    }
  } catch {
    // ignore query parse errors
  }
  const path = proofPathFromInput(url);
  return ['v1', String(method || 'GET').toUpperCase(), path, query, String(timestamp), String(nonce), String(sidHash || '')].join('\n');
}

function signDigest(privateKey, canonical) {
  const cryptoApi = getCrypto();
  const data = new TextEncoder().encode(canonical);
  return cryptoApi.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, data);
}

function encodeSigBase64Url(sigBuf) {
  const bytes = new Uint8Array(sigBuf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function signDeviceProofRequest(method, url, sidHash) {
  const material = await ensureKeyPair();
  if (!material.sidHash && !sidHash) {
    return {
      headers: null,
      needsRegister: true,
      authDeviceId: material.authDeviceId,
      publicKeySpki: material.publicKeySpki,
      pkcs8: material.pkcs8,
    };
  }
  const effectiveSidHash = material.sidHash || sidHash;
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = generateAuthDeviceId().replace(/^adev_/, 'nonce_');
  const canonical = buildCanonicalProofString(method, url, ts, nonce, effectiveSidHash);
  const sig = await signDigest(material.privateKey, canonical);
  return {
    needsRegister: !!material.needsRegister,
    authDeviceId: material.authDeviceId,
    headers: {
      'X-Auth-Device-Id': material.authDeviceId,
      'X-Auth-Device-Proof': encodeSigBase64Url(sig),
      'X-Auth-Device-Proof-Ts': ts,
      'X-Auth-Device-Proof-Nonce': nonce,
    },
    publicKeySpki: material.publicKeySpki,
    pkcs8: material.pkcs8,
    sidHash: effectiveSidHash,
  };
}

export async function getAuthDeviceHeaders(method, url) {
  if (!isDeviceProofEnforced()) return {};
  try {
    const signed = await signDeviceProofRequest(method, url);
    return signed.headers || {};
  } catch {
    return {};
  }
}
