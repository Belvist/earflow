'use strict';

const { createClient } = require('redis');

let client = null;
let connectPromise = null;

function buildRedisUrl(env = process.env) {
    const explicit = String(env.REDIS_URL || '').trim();
    if (explicit) return explicit;

    const host = String(env.REDIS_HOST || 'redis').trim() || 'redis';
    const portRaw = Number(env.REDIS_PORT);
    const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 6379;
    const password = String(env.REDIS_PASSWORD || '').trim();
    const dbRaw = Number(env.REDIS_DB);
    const db = Number.isFinite(dbRaw) && dbRaw >= 0 ? dbRaw : 0;

    return password
        ? `redis://:${encodeURIComponent(password)}@${host}:${port}/${db}`
        : `redis://${host}:${port}/${db}`;
}

async function getRedisClient() {
    if (client && client.isOpen) {
        return client;
    }

    if (connectPromise) {
        return connectPromise;
    }

    connectPromise = (async () => {
        try {
            const url = buildRedisUrl();
            client = createClient({
                url,
                socket: {
                    connectTimeout: 1500,
                    reconnectStrategy: () => new Error('Redis reconnect disabled'),
                },
            });

            client.on('error', () => {
            });

            await client.connect();
            return client;
        } catch {
            try {
                if (client) {
                    await client.quit();
                }
            } catch {
            }
            client = null;
            return null;
        } finally {
            connectPromise = null;
        }
    })();

    return connectPromise;
}

module.exports = {
    getRedisClient,
};
