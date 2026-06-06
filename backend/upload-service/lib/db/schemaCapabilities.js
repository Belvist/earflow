const { query } = require('./pool');

let schemaCapabilitiesPromise = null;
let schemaCapabilitiesExpiresAt = 0;

async function getSchemaCapabilities() {
    const now = Date.now();
    if (!schemaCapabilitiesPromise || now >= schemaCapabilitiesExpiresAt) {
        schemaCapabilitiesPromise = (async () => {
            const result = await query(
                `SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'songs'`
            );
            const columns = new Set((result.rows || []).map((r) => r.column_name));

            const playlistTracksRes = await query(
                `SELECT 1
           FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'playlist_tracks'
          LIMIT 1`
            );
            const hasPlaylistTracks = Array.isArray(playlistTracksRes.rows) && playlistTracksRes.rows.length > 0;

            schemaCapabilitiesExpiresAt = Date.now() + 5 * 60 * 1000;
            return {
                hasUserId: columns.has('user_id'),
                hasUploaderId: columns.has('uploader_id'),
                hasFileHash: columns.has('file_hash'),
                hasIsAvailable: columns.has('is_available'),
                hasEbapStatus: columns.has('ebap_status'),
                hasEbapReadyFlag: columns.has('has_ebap'),
                hasHlsStatus: columns.has('hls_status'),
                hasHlsReadyFlag: columns.has('has_hls'),
                hasTranscodeStatus: columns.has('transcode_status'),
                hasQualityVariants: columns.has('quality_variants'),
                hasMetadataParseStatus: columns.has('metadata_parse_status'),
                hasWaveformStatus: columns.has('waveform_status'),
                hasWaveformPeaks: columns.has('waveform_peaks'),
                hasPlayCount: columns.has('play_count'),
                hasPlaylistTracks,
            };
        })().catch((error) => {
            schemaCapabilitiesPromise = null;
            schemaCapabilitiesExpiresAt = 0;
            const e = new Error('Schema capabilities unavailable');
            e.code = 'SCHEMA_UNAVAILABLE';
            e.cause = error;
            throw e;
        });
    }
    return await schemaCapabilitiesPromise;
}

module.exports = {
    getSchemaCapabilities,
};
