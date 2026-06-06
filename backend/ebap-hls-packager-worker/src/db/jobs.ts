import type { Pool, PoolClient } from 'pg';

export type Lease = {
    songId: number;
    filePath: string;
    hlsStatus: string | null;
};

function parseNonEmptyString(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    const s = v.trim();
    return s ? s : null;
}

async function markSongErrorTx(client: PoolClient, params: { songId: number; error: string }): Promise<void> {
    if (!Number.isInteger(params.songId) || params.songId <= 0) return;
    const message = (params.error || '').slice(0, 2000);
    await client.query(
        `UPDATE songs
            SET hls_status = 'error',
                has_hls = FALSE,
                hls_error = $2,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [params.songId, message]
    );
}

export async function leaseOneSongForHls(pool: Pool): Promise<Lease | null> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const result = await client.query(
            `SELECT id, file_path, hls_status
               FROM songs
              WHERE has_ebap = TRUE
                AND (hls_status = 'reencode' OR has_hls = FALSE OR hls_status IN ('none', 'error'))
              ORDER BY id ASC
              LIMIT 1
              FOR UPDATE SKIP LOCKED`
        );

        if (!result.rows || result.rows.length === 0) {
            await client.query('COMMIT');
            return null;
        }

        const row = result.rows[0] as any;
        const songId = Number(row.id);
        const filePath = parseNonEmptyString(row.file_path);

        if (!Number.isInteger(songId) || songId <= 0 || !filePath) {
            await markSongErrorTx(client, { songId: Number.isInteger(songId) ? songId : 0, error: 'Invalid song row' });
            await client.query('COMMIT');
            return null;
        }

        await client.query(`UPDATE songs SET hls_status = 'processing', hls_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [songId]);
        await client.query('COMMIT');

        return {
            songId,
            filePath,
            hlsStatus: row.hls_status ? String(row.hls_status) : null,
        };
    } catch (e) {
        try {
            await client.query('ROLLBACK');
        } catch {
        }
        throw e;
    } finally {
        client.release();
    }
}

export async function markSongCompleted(pool: Pool, params: { songId: number }): Promise<void> {
    await pool.query(`UPDATE songs SET hls_status = 'completed', has_hls = TRUE, hls_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [params.songId]);
}

export async function markSongError(pool: Pool, params: { songId: number; error: string }): Promise<void> {
    const message = (params.error || '').slice(0, 2000);
    await pool.query(`UPDATE songs SET hls_status = 'error', has_hls = FALSE, hls_error = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [params.songId, message]);
}

export async function touchProcessingSong(pool: Pool, params: { songId: number }): Promise<void> {
    const songId = Number(params.songId);
    if (!Number.isInteger(songId) || songId <= 0) return;
    await pool.query(
        `UPDATE songs
            SET updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
            AND hls_status = 'processing'`,
        [songId]
    );
}

export async function releaseStuckProcessingJobs(pool: Pool, params: { olderThanMs: number; limit?: number }): Promise<number[]> {
    const olderThanMs = Number.isFinite(params.olderThanMs) ? Math.floor(params.olderThanMs) : 0;
    if (!Number.isInteger(olderThanMs) || olderThanMs <= 0) {
        throw new Error('Invalid olderThanMs');
    }
    const limit = Math.min(Math.max(Math.floor(Number(params.limit ?? 500)), 1), 5000);

    const minutes = Math.max(1, Math.floor(olderThanMs / 60000));

    const res = await pool.query(
        `WITH picked AS (
            SELECT id
              FROM songs
             WHERE hls_status = 'processing'
               AND updated_at < (CURRENT_TIMESTAMP - make_interval(mins => $1::int))
             ORDER BY updated_at ASC
             LIMIT $2
             FOR UPDATE SKIP LOCKED
         )
         UPDATE songs s
            SET hls_status = 'error',
                has_hls = FALSE,
                hls_error = 'processing_timeout',
                updated_at = CURRENT_TIMESTAMP
           FROM picked p
          WHERE s.id = p.id
        RETURNING s.id`,
        [minutes, limit]
    );

    return (res.rows || []).map((r: any) => Number(r.id)).filter((n: number) => Number.isFinite(n) && n > 0);
}
