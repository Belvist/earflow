/**
 * @jest-environment jsdom
 */

const { webcrypto } = require('node:crypto');
if (!globalThis.crypto?.subtle) {
  globalThis.crypto = webcrypto;
}

require('fake-indexeddb/auto');

import { buildCanonicalProofString, signDeviceProofRequest } from '../authDeviceCrypto';

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
    expect(result.pkcs8).toBeTruthy();
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
