import postgres from 'postgres';

export type LoudnessData = {
    inputLufs: number | null;
    inputTp: number | null;
    inputLra: number | null;
    targetLufs: number;
    targetTp: number;
};

export type QualityVariant = {
    tag: string;
    bitrate: number;
    codec: string;
    sampleRate: number;
    key: string;
    size: number;
    container?: string;
    channels?: number;
    loudness?: LoudnessData;
};

export type SongRow = {
    id: number;
    public_id: string | null;
    uploader_id: number | null;
    file_path: string;
    mime_type: string | null;
    file_size: number | null;
    file_hash: string | null;
    is_available: boolean | null;
    transcode_status: string | null;
    quality_variants: QualityVariant[] | null;
};

type SongsTableCapabilities = {
    hasFileHash: boolean;
    hasIsAvailable: boolean;
    hasPublicId: boolean;
    hasTranscodeStatus: boolean;
    hasQualityVariants: boolean;
};

let songsTableCapabilitiesPromise: Promise<SongsTableCapabilities> | null = null;
let songsTableCapabilitiesExpiresAt = 0;

async function getSongsTableCapabilities(sql: postgres.Sql): Promise<SongsTableCapabilities> {
    const now = Date.now();
    if (!songsTableCapabilitiesPromise || now >= songsTableCapabilitiesExpiresAt) {
        songsTableCapabilitiesPromise = (async () => {
            const rows = await sql<{ column_name: string }[]>`
                select column_name
                from information_schema.columns
                where table_schema = 'public' and table_name = 'songs'
            `;
            const cols = new Set((rows || []).map((r) => String(r.column_name || '').trim().toLowerCase()).filter(Boolean));
            songsTableCapabilitiesExpiresAt = Date.now() + 5 * 60 * 1000;
            return {
                hasFileHash: cols.has('file_hash'),
                hasIsAvailable: cols.has('is_available'),
                hasPublicId: cols.has('public_id'),
                hasTranscodeStatus: cols.has('transcode_status'),
                hasQualityVariants: cols.has('quality_variants'),
            };
        })().catch(() => {
            songsTableCapabilitiesPromise = null;
            songsTableCapabilitiesExpiresAt = 0;
            return {
                hasFileHash: false,
                hasIsAvailable: false,
                hasPublicId: false,
                hasTranscodeStatus: false,
                hasQualityVariants: false,
            };
        });
    }
    return await songsTableCapabilitiesPromise;
}

function normalizePublicId(raw: string): string | null {
    const v = String(raw || '').trim().toLowerCase();
    if (!v) return null;
    if (v.length > 64) return null;
    if (!/^[a-f0-9]{16,64}$/.test(v)) return null;
    return v;
}

export function createDb(params: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    sslMode: 'disable' | 'require';
    maxConnections?: number;
    idleTimeoutSeconds?: number;
    connectionTimeoutSeconds?: number;
    prepare?: boolean;
}): postgres.Sql {
    const ssl = params.sslMode === 'require' ? ({ rejectUnauthorized: false } as any) : false;
    return postgres({
        host: params.host,
        port: params.port,
        database: params.name,
        username: params.user,
        password: params.password,
        ssl,
        max: params.maxConnections ?? 10,
        idle_timeout: params.idleTimeoutSeconds ?? 30,
        connect_timeout: params.connectionTimeoutSeconds ?? 5,
        prepare: params.prepare ?? true,
    });
}

export async function getSongForStreaming(sql: postgres.Sql, trackId: number): Promise<SongRow | null> {
    const id = Number(trackId);
    if (!Number.isFinite(id) || id <= 0) return null;

    const caps = await getSongsTableCapabilities(sql);
    const publicIdExpr = caps.hasPublicId ? 'public_id' : 'null::text as public_id';
    const fileHashExpr = caps.hasFileHash ? 'file_hash' : 'null::text as file_hash';
    const isAvailableExpr = caps.hasIsAvailable ? 'is_available' : 'null::boolean as is_available';
    const transcodeStatusExpr = caps.hasTranscodeStatus ? 'transcode_status' : 'null::text as transcode_status';
    const qualityVariantsExpr = caps.hasQualityVariants ? 'quality_variants' : 'null::jsonb as quality_variants';

    const query = `
        select id, ${publicIdExpr}, uploader_id, file_path, mime_type, file_size, ${fileHashExpr}, ${isAvailableExpr}, ${transcodeStatusExpr}, ${qualityVariantsExpr}
        from songs
        where id = $1
        limit 1
    `;

    const rows = await sql.unsafe<SongRow[]>(query, [id]);

    if (!rows || rows.length === 0) return null;
    const row = rows[0];
    if (!row || !row.file_path) return null;
    return row;
}

export async function getSongForStreamingByPublicId(sql: postgres.Sql, publicIdRaw: string): Promise<SongRow | null> {
    const publicId = normalizePublicId(publicIdRaw);
    if (!publicId) return null;

    const caps = await getSongsTableCapabilities(sql);
    if (!caps.hasPublicId) return null;

    const fileHashExpr = caps.hasFileHash ? 'file_hash' : 'null::text as file_hash';
    const isAvailableExpr = caps.hasIsAvailable ? 'is_available' : 'null::boolean as is_available';
    const transcodeStatusExpr = caps.hasTranscodeStatus ? 'transcode_status' : 'null::text as transcode_status';
    const qualityVariantsExpr = caps.hasQualityVariants ? 'quality_variants' : 'null::jsonb as quality_variants';

    const query = `
        select id, public_id, uploader_id, file_path, mime_type, file_size, ${fileHashExpr}, ${isAvailableExpr}, ${transcodeStatusExpr}, ${qualityVariantsExpr}
        from songs
        where public_id = $1
        limit 1
    `;

    const rows = await sql.unsafe<SongRow[]>(query, [publicId]);

    if (!rows || rows.length === 0) return null;
    const row = rows[0];
    if (!row || !row.file_path) return null;
    return row;
}
