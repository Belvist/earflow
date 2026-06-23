const { Pool } = require('pg');
const config = require('../config');

async function main() {
    const pgOptions = [];
    if (config.db.statementTimeoutMs > 0) {
        const timeoutMs = Number.parseInt(config.db.statementTimeoutMs, 10);
        if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
            pgOptions.push(`-c statement_timeout=${timeoutMs}`);
        }
    }

    const pool = new Pool({
        host: config.db.host,
        port: config.db.port,
        database: config.db.database,
        user: config.db.user,
        password: config.db.password,
        ...(pgOptions.length > 0 ? { options: pgOptions.join(' ') } : {}),
    });

    const client = await pool.connect();
    try {
        const existing = await client.query(
            `SELECT
               to_regclass('public.idx_songs_embedding_hnsw') AS hnsw,
               to_regclass('public.idx_songs_embedding_ivfflat') AS ivfflat`
        );

        const hnsw = existing.rows?.[0]?.hnsw;
        const ivfflat = existing.rows?.[0]?.ivfflat;

        const indexName = hnsw ? 'idx_songs_embedding_hnsw' : (ivfflat ? 'idx_songs_embedding_ivfflat' : null);
        if (!indexName) {
            throw new Error('No vector index found: expected idx_songs_embedding_hnsw or idx_songs_embedding_ivfflat');
        }

        await client.query(`REINDEX INDEX CONCURRENTLY ${indexName}`);
        await client.query('ANALYZE songs');

        process.stdout.write(`OK: reindexed ${indexName} and analyzed songs\n`);
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch((err) => {
    process.stderr.write(`ERROR: ${err?.message || String(err)}\n`);
    process.exitCode = 1;
});
