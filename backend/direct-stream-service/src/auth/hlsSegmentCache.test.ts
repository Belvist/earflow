import { describe, expect, test } from 'bun:test';

import {
    buildHlsSegmentCacheUrl,
    createHlsSegmentCacheSig,
    hlsSegmentCacheExpSec,
    verifyHlsSegmentCacheSig,
} from './hlsSegmentCache';

const secret = new TextEncoder().encode('test-secret-for-hls-segment-cache-signing-key!!');
const secrets = [secret];

describe('hlsSegmentCache', () => {
    test('bucketed exp is stable within the same TTL window', () => {
        const ttl = 7 * 24 * 3600;
        const t0 = Date.UTC(2026, 5, 1, 12, 0, 0);
        const t1 = Date.UTC(2026, 5, 2, 8, 0, 0);
        expect(hlsSegmentCacheExpSec(t0, ttl)).toBe(hlsSegmentCacheExpSec(t1, ttl));
    });

    test('sign and verify round-trip', () => {
        const expSec = hlsSegmentCacheExpSec(Date.now(), 3600);
        const sig = createHlsSegmentCacheSig({
            secrets,
            trackId: 42,
            manifestHash8B64Url: 'abcdEF12',
            variant: 'aac_128',
            asset: 'seg_00001.m4s',
            expSec,
        });

        expect(verifyHlsSegmentCacheSig({
            secrets,
            trackId: 42,
            manifestHash8B64Url: 'abcdEF12',
            variant: 'aac_128',
            asset: 'seg_00001.m4s',
            expSec,
            sig,
            nowMs: Date.now(),
        })).toBe(true);

        expect(verifyHlsSegmentCacheSig({
            secrets,
            trackId: 42,
            manifestHash8B64Url: 'abcdEF12',
            variant: 'aac_128',
            asset: 'seg_00002.m4s',
            expSec,
            sig,
            nowMs: Date.now(),
        })).toBe(false);
    });

    test('buildHlsSegmentCacheUrl uses public origin', () => {
        const expSec = 1_800_000_000;
        const sig = createHlsSegmentCacheSig({
            secrets,
            trackId: 9,
            manifestHash8B64Url: 'hash1234',
            variant: 'aac_128',
            asset: 'init.mp4',
            expSec,
        });

        const url = buildHlsSegmentCacheUrl({
            publicOrigin: 'https://strmhaha.earflow.ru',
            trackId: 9,
            manifestHash8B64Url: 'hash1234',
            variant: 'aac_128',
            asset: 'init.mp4',
            expSec,
            sig,
        });

        expect(url.startsWith('https://strmhaha.earflow.ru/audio/v3/cache/9/')).toBe(true);
        expect(url).toContain('exp=');
        expect(url).toContain('sig=');
    });
});
