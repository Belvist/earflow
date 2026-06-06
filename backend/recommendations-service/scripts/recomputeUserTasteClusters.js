#!/usr/bin/env node

'use strict';

require('dotenv').config();

const { Pool } = require('pg');

const DIM = 8;

function parseVector(value) {
    if (Array.isArray(value)) {
        const out = value.map((x) => Number(x));
        return out.length === DIM && out.every((n) => Number.isFinite(n)) ? out : null;
    }

    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
        return null;
    }

    const body = trimmed.slice(1, -1);
    const parts = body.split(',');
    if (parts.length !== DIM) {
        return null;
    }

    const out = [];
    for (const p of parts) {
        const n = Number.parseFloat(p);
        if (!Number.isFinite(n)) return null;
        out.push(n);
    }

    return out;
}

function dot(a, b) {
    let s = 0;
    for (let i = 0; i < DIM; i += 1) {
        s += a[i] * b[i];
    }
    return s;
}

function norm(a) {
    return Math.sqrt(dot(a, a));
}

function l2Normalize(a) {
    const n = norm(a);
    if (!Number.isFinite(n) || n <= 0) return null;
    const out = new Array(DIM);
    for (let i = 0; i < DIM; i += 1) {
        out[i] = a[i] / n;
    }
    return out;
}

function cosineDistance(a, b) {
    const na = norm(a);
    const nb = norm(b);
    if (!Number.isFinite(na) || !Number.isFinite(nb) || na <= 0 || nb <= 0) {
        return 2;
    }
    const c = dot(a, b) / (na * nb);
    const clamped = Math.max(-1, Math.min(1, c));
    return 1 - clamped;
}

function weightedBlend(oldVec, newVec, alpha) {
    const out = new Array(DIM);
    for (let i = 0; i < DIM; i += 1) {
        out[i] = oldVec[i] * (1 - alpha) + newVec[i] * alpha;
    }
    return l2Normalize(out);
}

function aggregateEmbedding(clusters) {
    let sumW = 0;
    const sum = new Array(DIM).fill(0);
    for (const c of clusters) {
        const w = Number(c.weight);
        if (!Number.isFinite(w) || w <= 0) continue;
        sumW += w;
        for (let i = 0; i < DIM; i += 1) {
            sum[i] += c.embedding[i] * w;
        }
    }
    if (sumW <= 0) return null;
    const scaled = sum.map((x) => x / sumW);
    return l2Normalize(scaled);
}

function buildClusters(samples, maxClusters, distThreshold) {
    const clusters = [];

    const baseAlpha = 0.15;

    for (const s of samples) {
        const vec = l2Normalize(s.embedding);
        if (!vec) continue;

        const sampleWeight = Number.isFinite(s.weight) && s.weight > 0 ? s.weight : 0.01;
        const alpha = Math.min(Math.max(baseAlpha * sampleWeight, 0.01), 0.25);

        if (clusters.length === 0) {
            clusters.push({ embedding: vec, weight: sampleWeight });
            continue;
        }

        let bestIdx = 0;
        let bestDist = cosineDistance(vec, clusters[0].embedding);

        for (let i = 1; i < clusters.length; i += 1) {
            const d = cosineDistance(vec, clusters[i].embedding);
            if (d < bestDist) {
                bestDist = d;
                bestIdx = i;
            }
        }

        if (clusters.length < maxClusters && bestDist > distThreshold) {
            clusters.push({ embedding: vec, weight: sampleWeight });
            continue;
        }

        const current = clusters[bestIdx];
        const blended = weightedBlend(current.embedding, vec, alpha);
        if (blended) {
            current.embedding = blended;
            current.weight = current.weight * (1 - alpha) + sampleWeight * alpha;
        }
    }

    return clusters;
}

async function run() {
    const pool = new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: Number.parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DB_NAME || 'music_platform',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
    });

    const maxClusters = Math.min(Math.max(Number(process.env.RECO_TASTE_MAX_CLUSTERS || 5), 1), 5);
    const months = Math.min(Math.max(Number(process.env.RECO_TASTE_RECOMPUTE_MONTHS || 12), 1), 60);
    const maxTracks = Math.min(Math.max(Number(process.env.RECO_TASTE_RECOMPUTE_MAX_TRACKS_PER_USER || 500), 50), 5000);
    const distThreshold = Math.min(Math.max(Number(process.env.RECO_TASTE_NEW_CLUSTER_DIST_THRESHOLD || 0.25), 0.05), 1.0);

    const halfLifeDays = Math.max(7, Math.floor((months * 30) / 3));
    const ln2 = Math.log(2);

    const client = await pool.connect();
    try {
        await client.query('CREATE EXTENSION IF NOT EXISTS vector');

        const usersRes = await client.query(
            `SELECT DISTINCT user_id
       FROM user_history
       WHERE last_played > NOW() - ($1::int || ' months')::interval`,
            [months]
        );

        const userIds = (usersRes.rows || []).map((r) => Number.parseInt(r.user_id, 10)).filter((x) => Number.isFinite(x) && x > 0);

        for (const userId of userIds) {
            const tracksRes = await client.query(
                `SELECT s.embedding, h.last_played
         FROM user_history h
         JOIN songs s ON s.id = h.song_id
         LEFT JOIN likes l ON l.user_id = $1 AND l.song_id = h.song_id
         WHERE h.user_id = $1
           AND h.last_played > NOW() - ($2::int || ' months')::interval
           AND s.embedding IS NOT NULL
           AND (h.play_count >= 2 OR l.user_id IS NOT NULL OR h.liked = true)
         ORDER BY h.last_played DESC
         LIMIT $3::int`,
                [userId, months, maxTracks]
            );

            const samples = [];
            for (const row of tracksRes.rows || []) {
                const vec = parseVector(row.embedding);
                if (!vec) continue;

                const ts = row.last_played ? new Date(row.last_played).getTime() : 0;
                const ageDays = ts > 0 ? Math.max(0, (Date.now() - ts) / 86400000) : (months * 30);
                const w = Math.exp(-ln2 * (ageDays / halfLifeDays));
                samples.push({ embedding: vec, weight: Math.min(Math.max(w, 0.05), 1.0) });
            }

            if (samples.length === 0) {
                continue;
            }

            const clusters = buildClusters(samples, maxClusters, distThreshold);
            const agg = aggregateEmbedding(clusters);

            await client.query('BEGIN');
            try {
                await client.query(
                    `INSERT INTO user_models (user_id, last_updated)
             VALUES ($1, NOW())
             ON CONFLICT (user_id) DO NOTHING`,
                    [userId]
                );

                await client.query(
                    `DELETE FROM user_taste_clusters WHERE user_id = $1`,
                    [userId]
                );

                for (let i = 0; i < clusters.length; i += 1) {
                    const cid = i + 1;
                    const vec = clusters[i].embedding;
                    const weight = clusters[i].weight;
                    await client.query(
                        `INSERT INTO user_taste_clusters (user_id, cluster_id, embedding, weight, updated_at)
                 VALUES ($1, $2, $3::vector, $4, NOW())`,
                        [userId, cid, `[${vec.join(',')}]`, weight]
                    );
                }

                if (agg) {
                    await client.query(
                        `UPDATE user_models
                 SET embedding = $2::vector, last_updated = NOW()
                 WHERE user_id = $1`,
                        [userId, `[${agg.join(',')}]`]
                    );
                }

                await client.query('COMMIT');
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            }
        }
    } catch (err) {
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

run().catch((err) => {
    const msg = err && err.message ? String(err.message) : 'recomputeUserTasteClusters failed';
    console.error(msg);
    process.exitCode = 1;
});
