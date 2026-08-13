/**
 * @jest-environment jsdom
 */

const { webcrypto } = require('node:crypto');
if (!globalThis.crypto?.subtle) {
  globalThis.crypto = webcrypto;
}
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = require('node:util').TextEncoder;
}

require('fake-indexeddb/auto');

import { buildCanonicalProofString, persistAuthDeviceRecord, resetDeviceKeyCacheForTests, signDeviceProofRequest } from '../authDeviceCrypto';

const CANONICAL_MATRIX = [
  {
    name: 'profile simple',
    method: 'GET',
    url: '/api/profile',
    ts: '1710000000',
    nonce: 'nonce-abc',
    sidHash: 'sidhash-xyz',
    wantPath: '/api/profile',
    wantQuery: '',
  },
  {
    name: 'profile sorted query',
    method: 'GET',
    url: 'https://api.earflow.ru/api/profile?z=1&a=2',
    ts: '1710000000',
    nonce: 'nonce-abc',
    sidHash: 'sidhash-xyz',
    wantPath: '/api/profile',
    wantQuery: 'a=2&z=1',
  },
  {
    name: 'artist dollar and space encoded',
    method: 'GET',
    url: '/api/artists/A%24AP%20Rocky/meta',
    ts: '1710000000',
    nonce: 'nonce-artist',
    sidHash: 'sidhash-xyz',
    wantPath: '/api/artists/A$AP Rocky/meta',
    wantQuery: '',
  },
  {
    name: 'artist charli encoded',
    method: 'GET',
    url: '/api/artists/Charli%20XCX/meta',
    ts: '1710000000',
    nonce: 'nonce-charli',
    sidHash: 'sidhash-xyz',
    wantPath: '/api/artists/Charli XCX/meta',
    wantQuery: '',
  },
  {
    name: 'artist tracks with query',
    method: 'GET',
    url: '/api/artists/Charli%20XCX/tracks?limit=200&offset=0',
    ts: '1710000000',
    nonce: 'nonce-tracks',
    sidHash: 'sidhash-xyz',
    wantPath: '/api/artists/Charli XCX/tracks',
    wantQuery: 'limit=200&offset=0',
  },
  {
    name: 'unicode artist',
    method: 'GET',
    url: '/api/artists/%D0%90%D1%80%D1%82%D1%91%D0%BC/meta',
    ts: '1710000000',
    nonce: 'nonce-unicode',
    sidHash: 'sidhash-xyz',
    wantPath: '/api/artists/Артём/meta',
    wantQuery: '',
  },
  {
    name: 'prod absolute url lil krystalll',
    method: 'GET',
    url: 'https://api.earflow.ru/api/artists/LIL%20KRYSTALLL/meta',
    ts: '1710000000',
    nonce: 'nonce-lil',
    sidHash: 'sidhash-xyz',
    wantPath: '/api/artists/LIL KRYSTALLL/meta',
    wantQuery: '',
  },
  {
    name: 'prod absolute url cyrillic platina',
    method: 'GET',
    url: 'https://api.earflow.ru/api/artists/%D0%9F%D0%BB%D0%B0%D1%82%D0%B8%D0%BD%D0%B0/meta',
    ts: '1710000000',
    nonce: 'nonce-platina',
    sidHash: 'sidhash-xyz',
    wantPath: '/api/artists/Платина/meta',
    wantQuery: '',
  },
];

describe('signDeviceProofRequest register path', () => {
  beforeEach(() => {
    resetDeviceKeyCacheForTests();
  });

  test('exposes publicKeySpki when sidHash is not yet bound', async () => {
    const result = await signDeviceProofRequest(
      'POST',
      'https://api.earflow.ru/api/auth/device/register',
    );
    expect(result.needsRegister).toBe(true);
    expect(result.headers).toBeNull();
    expect(result.authDeviceId).toMatch(/^adev_/);
    expect(typeof result.publicKeySpki).toBe('string');
    expect(result.publicKeySpki.length).toBeGreaterThan(10);
    // DECISIONS 2026-08-11 (security review): private key is now extractable=false.
    // The caller must receive null pkcs8 and rely purely on the in-memory CryptoKey.
    expect(result.pkcs8).toBeNull();
  });

  test('keeps the non-extractable key in the page-session slot after bind (regression for DEVICE_PROOF_REQUIRED loop)', async () => {
    const first = await signDeviceProofRequest(
      'POST',
      'https://api.earflow.ru/api/auth/device/register',
    );
    expect(first.needsRegister).toBe(true);
    expect(first.headers).toBeNull();

    // Gateway binds the device -> sidHash is stored in the in-memory slot.
    await persistAuthDeviceRecord({
      authDeviceId: first.authDeviceId,
      sidHash: 'bound-sid-hash',
      publicKeySpki: first.publicKeySpki,
      pkcs8: null,
    });

    // Second call must reuse the SAME keypair and now produce a real proof.
    const second = await signDeviceProofRequest(
      'GET',
      'https://api.earflow.ru/api/auth/profile',
    );
    expect(second.needsRegister).toBe(false);
    expect(second.authDeviceId).toBe(first.authDeviceId);
    expect(second.publicKeySpki).toBe(first.publicKeySpki);
    expect(second.headers).not.toBeNull();
    expect(second.headers['X-Auth-Device-Id']).toBe(first.authDeviceId);
    expect(second.headers['X-Auth-Device-Proof']).toBeTruthy();
    expect(second.headers['X-Auth-Device-Proof-Ts']).toBeTruthy();
  });
});

describe('authDeviceCrypto canonical string matrix (gateway contract)', () => {
  test.each(CANONICAL_MATRIX)('$name', ({ method, url, ts, nonce, sidHash, wantPath, wantQuery }) => {
    const canonical = buildCanonicalProofString(method, url, ts, nonce, sidHash);
    expect(canonical).toBe([
      'v1',
      method,
      wantPath,
      wantQuery,
      ts,
      nonce,
      sidHash,
    ].join('\n'));
  });
});
