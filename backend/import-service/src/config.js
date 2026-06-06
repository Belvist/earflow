'use strict';

module.exports = {
    port: parseInt(process.env.PORT || '3073', 10),
    databaseUrl: process.env.DATABASE_URL || '',
    dbMaxConnections: Math.max(1, Math.min(parseInt(process.env.DB_MAX_CONNECTIONS || '3', 10) || 3, 50)),
    musicbrainzUserAgent: process.env.MUSICBRAINZ_USER_AGENT || 'EarflowMusicPlatform/1.0 (contact@earflow.ru)',
    spotifyClientId: process.env.SPOTIFY_CLIENT_ID || '',
    spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
    mbRateLimitMs: 1100,
};
