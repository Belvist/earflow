let schemaPromise = null;

async function getSongsSchemaCapabilities(pool) {
    if (!schemaPromise) {
        schemaPromise = (async () => {
            const [songsColumns, tables, listensColumns, songFeaturesColumns] = await Promise.all([
                pool.query(
                    `SELECT column_name
               FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'songs'`
                ),
                pool.query(
                    `SELECT table_name
               FROM information_schema.tables
              WHERE table_schema = 'public'
                AND table_name = ANY($1::text[])`,
                    [['listens', 'likes', 'dislikes', 'song_features', 'song_mood_scores', 'statistics_cache', 'user_daily_recommendations']]
                ),
                pool.query(
                    `SELECT column_name
               FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'listens'`
                ).catch(() => ({ rows: [] })),
                pool.query(
                    `SELECT column_name
               FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'song_features'`
                ).catch(() => ({ rows: [] })),
            ]);

            const songCols = new Set((songsColumns.rows || []).map((r) => r.column_name));
            const presentTables = new Set((tables.rows || []).map((r) => r.table_name));
            const listenCols = new Set((listensColumns.rows || []).map((r) => r.column_name));
            const featureCols = new Set((songFeaturesColumns.rows || []).map((r) => r.column_name));

            const hasListens = presentTables.has('listens');
            const hasLikes = presentTables.has('likes');
            const hasDislikes = presentTables.has('dislikes');
            const hasSongFeatures = presentTables.has('song_features');
            const hasSongMoodScores = presentTables.has('song_mood_scores');
            const hasStatisticsCache = presentTables.has('statistics_cache');
            const hasUserDailyRecommendations = presentTables.has('user_daily_recommendations');

            return {
                hasIsAvailable: songCols.has('is_available'),
                hasReleaseDate: songCols.has('release_date'),
                hasCreatedAt: songCols.has('created_at'),
                hasGenreNorm: songCols.has('genre_norm'),
                hasArtistNorm: songCols.has('artist_norm'),
                hasListens,
                hasLikes,
                hasDislikes,
                listensHasListenedAt: hasListens && listenCols.has('listened_at'),
                hasSongFeatures,
                songFeaturesCols: featureCols,
                hasSongMoodScores,
                hasStatisticsCache,
                hasUserDailyRecommendations,
            };
        })().catch(() => ({
            hasIsAvailable: false,
            hasReleaseDate: false,
            hasCreatedAt: false,
            hasGenreNorm: false,
            hasArtistNorm: false,
            hasListens: false,
            hasLikes: false,
            hasDislikes: false,
            listensHasListenedAt: false,
            hasSongFeatures: false,
            songFeaturesCols: new Set(),
            hasSongMoodScores: false,
            hasStatisticsCache: false,
            hasUserDailyRecommendations: false,
        }));
    }
    return schemaPromise;
}

module.exports = {
    getSongsSchemaCapabilities,
};
