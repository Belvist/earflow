/**
 * @jest-environment jsdom
 */
/* global globalThis */

// jsdom предоставляет свой Blob, но fake-indexeddb использует structuredClone,
// который в Node.js корректно клонирует только нативный Node Blob.
const { Blob: NodeBlob } = require('buffer');
globalThis.Blob = NodeBlob;

// jsdom environment фильтрует глобальный structuredClone из Node.
// Восстанавливаем через v8.serialize/deserialize — полный эквивалент для IDB put.
if (typeof globalThis.structuredClone !== 'function') {
    const v8 = require('node:v8');
    globalThis.structuredClone = (value) => v8.deserialize(v8.serialize(value));
}

require('fake-indexeddb/auto');

const {
    saveTrack,
    getTrackMeta,
    getTrackBlob,
    hasTrack,
    deleteTrack,
    listTracks,
    listTrackIds,
    clearAll,
    computeTotalBytes,
} = require('../OfflineStorage');

function makeBlob(sizeBytes) {
    const data = new Uint8Array(sizeBytes).fill(0x42);
    return new Blob([data], { type: 'audio/mpeg' });
}

function makeMeta(id, sizeBytes = 1024) {
    return {
        id: String(id),
        title: `Title ${id}`,
        artist: `Artist ${id}`,
        durationSec: 180,
        addedAt: Date.now(),
        sizeBytes,
        mime: 'audio/mpeg',
    };
}

describe('OfflineStorage', () => {
    beforeEach(async () => {
        try { await clearAll(); } catch { }
    });

    test('saveTrack + getTrackMeta + getTrackBlob returns stored data', async () => {
        const meta = makeMeta('t1', 2048);
        const blob = makeBlob(2048);

        await saveTrack(meta, blob);

        const got = await getTrackMeta('t1');
        expect(got).not.toBeNull();
        expect(got.id).toBe('t1');
        expect(got.title).toBe('Title t1');
        expect(got.sizeBytes).toBe(2048);

        const gotBlob = await getTrackBlob('t1');
        expect(gotBlob).not.toBeNull();
        expect(typeof gotBlob.size).toBe('number');
        expect(gotBlob.size).toBe(2048);
        expect(typeof gotBlob.type).toBe('string');
    });

    test('hasTrack true after save, false after delete', async () => {
        await saveTrack(makeMeta('t2'), makeBlob(100));
        expect(await hasTrack('t2')).toBe(true);

        await deleteTrack('t2');
        expect(await hasTrack('t2')).toBe(false);
        expect(await getTrackMeta('t2')).toBeNull();
        expect(await getTrackBlob('t2')).toBeNull();
    });

    test('listTracks + listTrackIds returns saved entries', async () => {
        await saveTrack(makeMeta('a', 100), makeBlob(100));
        await saveTrack(makeMeta('b', 200), makeBlob(200));
        await saveTrack(makeMeta('c', 300), makeBlob(300));

        const ids = await listTrackIds();
        expect(ids.sort()).toEqual(['a', 'b', 'c']);

        const tracks = await listTracks();
        expect(tracks.length).toBe(3);
        const idSet = new Set(tracks.map((t) => t.id));
        expect(idSet.has('a')).toBe(true);
        expect(idSet.has('b')).toBe(true);
        expect(idSet.has('c')).toBe(true);
    });

    test('computeTotalBytes sums sizeBytes', async () => {
        await saveTrack(makeMeta('x', 1000), makeBlob(1000));
        await saveTrack(makeMeta('y', 2000), makeBlob(2000));
        await saveTrack(makeMeta('z', 3000), makeBlob(3000));

        const total = await computeTotalBytes();
        expect(total).toBe(6000);
    });

    test('clearAll removes everything', async () => {
        await saveTrack(makeMeta('c1'), makeBlob(50));
        await saveTrack(makeMeta('c2'), makeBlob(50));
        expect((await listTrackIds()).length).toBe(2);

        await clearAll();
        expect((await listTrackIds()).length).toBe(0);
        expect(await computeTotalBytes()).toBe(0);
    });

    test('saveTrack with invalid meta throws', async () => {
        await expect(saveTrack(null, makeBlob(100))).rejects.toThrow();
        await expect(saveTrack({}, makeBlob(100))).rejects.toThrow();
    });

    test('saveTrack with invalid blob throws', async () => {
        await expect(saveTrack(makeMeta('bad'), null)).rejects.toThrow();
        await expect(saveTrack(makeMeta('bad'), 'not-a-blob')).rejects.toThrow();
    });

    test('getTrackMeta returns null for unknown id', async () => {
        const meta = await getTrackMeta('nope');
        expect(meta).toBeNull();
    });

    test('getTrackBlob returns null for unknown id', async () => {
        const blob = await getTrackBlob('nope');
        expect(blob).toBeNull();
    });

    test('hasTrack handles empty id gracefully', async () => {
        expect(await hasTrack('')).toBe(false);
        expect(await hasTrack(null)).toBe(false);
        expect(await hasTrack(undefined)).toBe(false);
    });

    test('deleteTrack of unknown id does not throw', async () => {
        await expect(deleteTrack('ghost')).resolves.not.toThrow();
    });

    test('saveTrack replaces existing entry with same id', async () => {
        await saveTrack(makeMeta('replace', 1000), makeBlob(1000));
        await saveTrack({ ...makeMeta('replace', 2000), title: 'Updated' }, makeBlob(2000));

        const meta = await getTrackMeta('replace');
        expect(meta.title).toBe('Updated');
        expect(meta.sizeBytes).toBe(2000);

        const ids = await listTrackIds();
        expect(ids.filter((id) => id === 'replace').length).toBe(1);
    });
});
