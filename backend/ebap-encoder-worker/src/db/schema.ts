import type { Pool } from 'pg';

export async function hasEbapColumns(pool: Pool): Promise<boolean> {
    const res = await pool.query(
        `SELECT COUNT(*)::int AS c
         FROM information_schema.columns
         WHERE table_name = 'songs'
           AND column_name IN ('has_ebap', 'ebap_status', 'ebap_error')`
    );

    const c = Number(res.rows?.[0]?.c ?? 0);
    return c === 3;
}
