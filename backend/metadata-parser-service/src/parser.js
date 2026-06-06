'use strict';

const mm = require('music-metadata');

async function parseSongMetadata(buffer, mimeType) {
    let parsed;
    try {
        parsed = await mm.parseBuffer(buffer, mimeType || 'audio/mpeg', {
            duration: true,
            skipCovers: false,
        });
    } catch {
        return { metadata: {}, coverBuffer: null, coverMime: null };
    }

    const { common, format } = parsed;
    const metadata = {};

    if (common.title) metadata.title = String(common.title).slice(0, 500);
    if (common.artist) metadata.artist = String(common.artist).slice(0, 500);
    if (common.albumartist) metadata.albumArtist = String(common.albumartist).slice(0, 500);
    if (common.album) metadata.album = String(common.album).slice(0, 500);
    if (common.year && Number.isFinite(Number(common.year))) {
        metadata.year = Number(common.year);
    }
    if (Array.isArray(common.genre) && common.genre.length > 0) {
        metadata.genre = String(common.genre[0]).slice(0, 100);
    }
    if (common.track && Number.isFinite(common.track.no)) {
        metadata.trackNo = common.track.no;
    }
    if (common.disk && Number.isFinite(common.disk.no)) {
        metadata.diskNo = common.disk.no;
    }
    if (common.bpm && Number.isFinite(Number(common.bpm))) {
        metadata.bpm = Math.round(Number(common.bpm));
    }
    if (Array.isArray(common.comment) && common.comment.length > 0) {
        const c = common.comment[0];
        const text = typeof c === 'object' ? (c.text || '') : String(c);
        if (text) metadata.comment = text.slice(0, 1000);
    }
    if (Array.isArray(common.composer) && common.composer.length > 0) {
        metadata.composer = String(common.composer[0]).slice(0, 500);
    }
    if (Array.isArray(common.label) && common.label.length > 0) {
        metadata.label = String(common.label[0]).slice(0, 200);
    }
    if (common.isrc) metadata.isrc = String(common.isrc).slice(0, 20);
    if (common.copyright) metadata.copyright = String(common.copyright).slice(0, 500);

    if (format.duration && Number.isFinite(format.duration)) {
        metadata.duration = Math.round(format.duration * 1000) / 1000;
    }
    if (format.bitrate && Number.isFinite(format.bitrate)) {
        metadata.bitrate = Math.round(format.bitrate);
    }
    if (format.sampleRate) metadata.sampleRate = format.sampleRate;
    if (format.numberOfChannels) metadata.channels = format.numberOfChannels;
    if (format.codec) metadata.codec = format.codec;
    if (format.container) metadata.container = format.container;
    if (format.lossless !== undefined) metadata.lossless = !!format.lossless;
    if (format.tagTypes && format.tagTypes.length > 0) metadata.tagTypes = format.tagTypes;

    let coverBuffer = null;
    let coverMime = null;
    if (Array.isArray(common.picture) && common.picture.length > 0) {
        const pic = common.picture[0];
        if (pic && pic.data && pic.data.length > 0) {
            coverBuffer = Buffer.from(pic.data);
            coverMime = pic.format || 'image/jpeg';
        }
    }

    return { metadata, coverBuffer, coverMime };
}

module.exports = { parseSongMetadata };
