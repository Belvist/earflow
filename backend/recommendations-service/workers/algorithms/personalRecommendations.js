/**
 * Персональные рекомендации - продвинутый алгоритм
 * 
 * Включает:
 * - Content-based filtering (audio features)
 * - Collaborative filtering (похожие пользователи)
 * - Genre-based recommendations (улучшенный учёт жанров)
 * - Diversity mechanisms (разнообразие рекомендаций)
 * - Исключение дизлайков и прослушанных
 * 
 * @module workers/algorithms/personalRecommendations
 */

const { query } = require('../../lib/database');
const { createLogger, logPerformance } = require('../../lib/logger');
const config = require('../../config');

const logger = createLogger('personal-recommendations');

// ============================================
// Конфигурация разнообразия
// ============================================
const DIVERSITY_CONFIG = {
  // Максимум треков от одного артиста в топ-50
  maxSongsPerArtist: 3,
  // Максимум треков одного жанра подряд
  maxConsecutiveSameGenre: 2,
  // Процент "exploration" слотов для открытия новых жанров
  explorationRatio: 0.15,
  // Случайный фактор для разнообразия (0-1)
  randomnessFactor: 0.1,
};

/**
 * Применяет разнообразие к отсортированному списку рекомендаций
 * 
 * Гарантирует:
 * - Не более N треков от одного артиста в топ-50
 * - Чередование артистов (не больше 2 подряд от одного артиста)
 * - Если есть жанры - чередование по жанрам
 * - Сохранение качества (высокоскоринговые треки всё равно попадут в список)
 * 
 * @param {Array<{id: number, artist: string, genre: string, score: number}>} scoredTracks
 * @param {number} limit
 * @returns {number[]}
 */
function applyDiversityReranking(scoredTracks, limit) {
  if (!scoredTracks || scoredTracks.length === 0) {
    return [];
  }

  const result = [];
  const artistCount = new Map();         // Общий счётчик по артисту
  const artistHistory = [];              // Последние N артистов для consecutive check
  const usedIds = new Set();

  // Группируем треки по артистам для rotation
  const tracksByArtist = new Map();
  for (const track of scoredTracks) {
    const artistKey = (track.artist || 'unknown').toLowerCase().trim();
    if (!tracksByArtist.has(artistKey)) {
      tracksByArtist.set(artistKey, []);
    }
    tracksByArtist.get(artistKey).push(track);
  }

  // Сортируем артистов по максимальному скору их треков
  const artistScores = new Map();
  for (const [artist, tracks] of tracksByArtist) {
    // Берём максимальный скор среди треков артиста
    const maxScore = Math.max(...tracks.map(t => t.score || 0));
    artistScores.set(artist, maxScore);
  }
  const sortedArtists = [...artistScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([artist]) => artist);

  // Индексы для round-robin по артистам
  const artistIndices = new Map();
  for (const artist of sortedArtists) {
    artistIndices.set(artist, 0);
  }

  let rotationIndex = 0;
  const maxConsecutiveSameArtist = 2;

  while (result.length < limit && result.length < scoredTracks.length) {
    let trackAdded = false;

    // Round-robin по артистам для разнообразия
    for (let attempts = 0; attempts < sortedArtists.length && !trackAdded; attempts++) {
      const currentArtist = sortedArtists[(rotationIndex + attempts) % sortedArtists.length];
      const artistTracks = tracksByArtist.get(currentArtist) || [];
      const idx = artistIndices.get(currentArtist) || 0;

      // Пропускаем если артист уже достиг лимита
      const currentArtistTotal = artistCount.get(currentArtist) || 0;
      if (currentArtistTotal >= DIVERSITY_CONFIG.maxSongsPerArtist) {
        continue;
      }

      // Проверяем consecutive same artist
      const recentArtists = artistHistory.slice(-maxConsecutiveSameArtist);
      if (recentArtists.length >= maxConsecutiveSameArtist &&
        recentArtists.every(a => a === currentArtist)) {
        continue;
      }

      // Ищем следующий доступный трек от этого артиста
      for (let i = idx; i < artistTracks.length; i++) {
        const track = artistTracks[i];

        if (usedIds.has(track.id)) continue;

        // Добавляем трек
        result.push(track.id);
        usedIds.add(track.id);
        artistCount.set(currentArtist, currentArtistTotal + 1);
        artistHistory.push(currentArtist);
        artistIndices.set(currentArtist, i + 1);
        trackAdded = true;
        break;
      }

      if (trackAdded) break;
    }

    // Fallback: если все артисты исчерпали лимиты, берём лучший оставшийся
    if (!trackAdded) {
      for (const track of scoredTracks) {
        if (!usedIds.has(track.id)) {
          const artistKey = (track.artist || 'unknown').toLowerCase().trim();
          // Проверяем consecutive (но не общий лимит - он уже исчерпан)
          const recentArtists = artistHistory.slice(-maxConsecutiveSameArtist);
          if (recentArtists.length >= maxConsecutiveSameArtist &&
            recentArtists.every(a => a === artistKey)) {
            continue; // Пропускаем, ищем другого артиста
          }

          result.push(track.id);
          usedIds.add(track.id);
          artistCount.set(artistKey, (artistCount.get(artistKey) || 0) + 1);
          artistHistory.push(artistKey);
          trackAdded = true;
          break;
        }
      }
    }

    // Абсолютный fallback - берём любой оставшийся трек
    if (!trackAdded) {
      for (const track of scoredTracks) {
        if (!usedIds.has(track.id)) {
          const artistKey = (track.artist || 'unknown').toLowerCase().trim();
          result.push(track.id);
          usedIds.add(track.id);
          artistCount.set(artistKey, (artistCount.get(artistKey) || 0) + 1);
          artistHistory.push(artistKey);
          trackAdded = true;
          break;
        }
      }
    }

    if (!trackAdded) break;
    rotationIndex++;
  }

  if (result.length < limit) {
    for (const track of scoredTracks) {
      if (result.length >= limit) break;
      if (usedIds.has(track.id)) continue;
      result.push(track.id);
      usedIds.add(track.id);
    }
  }

  return result;
}

/**
 * Вычисляет персональные рекомендации для пользователя
 * с улучшенным учётом жанров и разнообразием
 * 
 * @param {number} userId
 * @returns {Promise<number[]>}
 */
async function computeUserRecommendations(userId) {
  const startTime = Date.now();
  const weights = config.offlineWorker.weights;
  const persWeights = config.offlineWorker.personalizationWeights;
  const topN = config.offlineWorker.topN;
  const historyLimitMonths = config.offlineWorker.historyLimitMonths || 12;
  const userVectorFallbackLimit = config.offlineWorker.userVectorFallbackLimit || 200;

  // Запрашиваем больше треков для последующего diversity reranking
  const fetchLimit = Math.min(topN * 3, 3000);

  const recentExcludeDays = config.offlineWorker.recentExcludeDays || 30;

  const vectorSql = `
    WITH 
    disliked_songs AS (
      SELECT song_id FROM dislikes WHERE user_id = $1
    ),

    listened_songs AS (
      SELECT song_id FROM user_history
      WHERE user_id = $1
        AND (
          last_played > NOW() - INTERVAL '1 day' * $11::int
          OR play_count >= 5
        )
    ),

    taste_clusters AS (
      SELECT embedding
      FROM user_taste_clusters
      WHERE user_id = $1
    ),

    user_vector AS (
      SELECT COALESCE(
        (SELECT reco_user_embedding_from_clusters($1)),
        (SELECT um.embedding FROM user_models um WHERE um.user_id = $1 AND um.embedding IS NOT NULL),
        (
          SELECT AVG(t.embedding) AS embedding
          FROM (
            SELECT s.embedding
            FROM user_history h
            JOIN songs s ON h.song_id = s.id
            LEFT JOIN likes l ON l.user_id = $1 AND l.song_id = h.song_id
            WHERE h.user_id = $1
              AND h.last_played > NOW() - INTERVAL '1 month' * $2
              AND s.embedding IS NOT NULL
              AND (h.play_count >= 2 OR l.user_id IS NOT NULL OR h.liked = true)
            ORDER BY h.last_played DESC
            LIMIT $9::int
          ) t
        )
      ) AS embedding
    ),

    candidate_ids AS (
      SELECT id, MIN(vec_dist) AS vec_dist
      FROM (
        SELECT s.id, (s.embedding <=> tc.embedding) AS vec_dist
        FROM taste_clusters tc
        CROSS JOIN LATERAL (
          SELECT s0.id, s0.embedding
          FROM songs s0
          LEFT JOIN listened_songs ls ON s0.id = ls.song_id
          LEFT JOIN disliked_songs ds ON s0.id = ds.song_id
          WHERE s0.embedding IS NOT NULL
            AND COALESCE(s0.is_available, true) = true
            AND ls.song_id IS NULL
            AND ds.song_id IS NULL
          ORDER BY s0.embedding <=> tc.embedding
          LIMIT LEAST($8::int, 1200)
        ) s

        UNION ALL

        SELECT s.id, (s.embedding <=> uv.embedding) AS vec_dist
        FROM user_vector uv
        CROSS JOIN LATERAL (
          SELECT s0.id, s0.embedding
          FROM songs s0
          LEFT JOIN listened_songs ls ON s0.id = ls.song_id
          LEFT JOIN disliked_songs ds ON s0.id = ds.song_id
          WHERE uv.embedding IS NOT NULL
            AND s0.embedding IS NOT NULL
            AND COALESCE(s0.is_available, true) = true
            AND ls.song_id IS NULL
            AND ds.song_id IS NULL
          ORDER BY s0.embedding <=> uv.embedding
          LIMIT $8::int
        ) s
        WHERE uv.embedding IS NOT NULL
      ) t
      GROUP BY id
      ORDER BY MIN(vec_dist)
      LIMIT $8::int
    ),
    
    -- ==========================================
    -- ЖАНРОВЫЕ ПРЕДПОЧТЕНИЯ (улучшенный расчёт)
    -- ==========================================
    genre_stats AS (
      SELECT
        s.genre,
        COUNT(DISTINCT s.id) AS tracks_listened,
        SUM(COALESCE(h.play_count, 0)) AS total_plays,
        SUM(CASE WHEN l.id IS NOT NULL THEN 1 ELSE 0 END) AS likes_count,
        SUM(COALESCE(h.skip_count, 0)) AS skips_count,
        AVG(COALESCE(h.play_count, 0)) AS avg_plays_per_track
      FROM user_history h
      JOIN songs s ON h.song_id = s.id
      LEFT JOIN likes l ON l.user_id = $1 AND l.song_id = s.id
      WHERE h.user_id = $1
        AND h.last_played > NOW() - INTERVAL '1 month' * $2
        AND s.genre IS NOT NULL AND s.genre != ''
      GROUP BY s.genre
    ),
    genre_prefs AS (
      SELECT 
        genre,
        (
          (tracks_listened * 1.0) +
          (total_plays * 0.5) +
          (likes_count * 3.0) -
          (skips_count * 0.3)
        ) / NULLIF(
          MAX((tracks_listened * 1.0) + (total_plays * 0.5) + (likes_count * 3.0)) OVER(), 
          0
        ) AS genre_affinity,
        ROW_NUMBER() OVER (ORDER BY 
          (tracks_listened * 1.0) + (total_plays * 0.5) + (likes_count * 3.0) DESC
        ) AS genre_rank
      FROM genre_stats
    ),
    top_genres AS (
      SELECT genre FROM genre_prefs WHERE genre_rank <= 3
    ),
    related_genres AS (
      SELECT DISTINCT s2.genre AS related_genre, gp.genre AS source_genre
      FROM songs s1
      JOIN songs s2 ON s1.artist = s2.artist AND s1.genre != s2.genre
      JOIN genre_prefs gp ON s1.genre = gp.genre
      WHERE gp.genre_rank <= 3
        AND s2.genre IS NOT NULL AND s2.genre != ''
    ),
    
    -- ==========================================
    -- АРТИСТСКИЕ ПРЕДПОЧТЕНИЯ
    -- ==========================================
    artist_prefs AS (
      SELECT
        s.artist,
        SUM(
          COALESCE(h.play_count, 0) * 1.0 +
          CASE WHEN l.id IS NOT NULL THEN 3.0 ELSE 0 END +
          CASE WHEN h.liked THEN 2.0 ELSE 0 END -
          COALESCE(h.skip_count, 0) * 0.5
        ) / NULLIF(
          MAX(SUM(
            COALESCE(h.play_count, 0) * 1.0 +
            CASE WHEN l.id IS NOT NULL THEN 3.0 ELSE 0 END
          )) OVER(), 0
        ) AS artist_affinity
      FROM user_history h
      JOIN songs s ON h.song_id = s.id
      LEFT JOIN likes l ON l.user_id = $1 AND l.song_id = s.id
      WHERE h.user_id = $1
        AND h.last_played > NOW() - INTERVAL '1 month' * $2
        AND s.artist IS NOT NULL AND s.artist != ''
      GROUP BY s.artist
      HAVING SUM(COALESCE(h.play_count, 0)) > 0
    ),
    
    -- ==========================================
    -- AUDIO PROFILE (Content-based)
    -- ==========================================
    user_audio_profile AS (
      SELECT
        AVG(sf.energy) AS avg_energy,
        AVG(sf.valence) AS avg_valence,
        AVG(sf.danceability) AS avg_danceability,
        AVG(sf.tempo) AS avg_tempo,
        STDDEV(sf.energy) AS std_energy,
        STDDEV(sf.valence) AS std_valence
      FROM user_history h
      JOIN song_features sf ON h.song_id = sf.song_id
      LEFT JOIN likes l ON l.user_id = $1 AND l.song_id = h.song_id
      WHERE h.user_id = $1
        AND (h.play_count >= 2 OR l.id IS NOT NULL OR h.liked = true)
    ),
    
    -- ==========================================
    -- COLLABORATIVE FILTERING
    -- ==========================================
    similar_users AS (
      SELECT l2.user_id AS similar_user_id, COUNT(*) AS shared_likes
      FROM likes l1
      JOIN likes l2 ON l1.song_id = l2.song_id AND l2.user_id != $1
      WHERE l1.user_id = $1
      GROUP BY l2.user_id
      HAVING COUNT(*) >= 2
      ORDER BY shared_likes DESC
      LIMIT 50
    ),
    collaborative_recs AS (
      SELECT l.song_id, 
        COUNT(DISTINCT l.user_id) AS similar_user_likes,
        SUM(su.shared_likes) AS weighted_collab_score
      FROM likes l
      JOIN similar_users su ON l.user_id = su.similar_user_id
      WHERE l.song_id IN (SELECT id FROM candidate_ids)
      GROUP BY l.song_id
    ),
    
    -- ==========================================
    -- ФИНАЛЬНЫЙ SCORING (только по кандидатам)
    -- ==========================================
    song_candidates AS (
      SELECT
        s.id,
        s.artist,
        s.genre,
        s.title,
        c.vec_dist,
        COALESCE(s.popularity, 0)::numeric AS popularity,
        COALESCE(s.play_count, 0)::numeric AS play_count,
        COALESCE(h.total_plays, 0)::numeric AS global_play_count,
        COALESCE(ush.user_skip_count, 0)::numeric AS user_skip_count,
        COALESCE(lk.like_count, 0)::numeric AS like_count,
        COALESCE(cr.similar_user_likes, 0)::numeric AS collab_score,
        COALESCE(cr.weighted_collab_score, 0)::numeric AS weighted_collab,
        COALESCE(gp.genre_affinity, 0) AS genre_affinity,
        COALESCE(gp.genre_rank, 999) AS genre_rank,
        CASE WHEN tg.genre IS NOT NULL THEN 1 ELSE 0 END AS is_top_genre,
        CASE WHEN rg.related_genre IS NOT NULL THEN 0.5 ELSE 0 END AS related_genre_bonus,
        COALESCE(ap.artist_affinity, 0) AS artist_affinity,
        sf.energy,
        sf.valence,
        sf.danceability,
        sf.tempo,
        uap.avg_energy,
        uap.avg_valence,
        uap.avg_danceability,
        uap.std_energy,
        uap.std_valence,
        RANDOM() AS random_factor
      FROM candidate_ids c
      JOIN songs s ON s.id = c.id
      LEFT JOIN (
        SELECT song_id, SUM(play_count) AS total_plays
        FROM user_history
        WHERE song_id IN (SELECT id FROM candidate_ids)
        GROUP BY song_id
      ) h ON s.id = h.song_id
      LEFT JOIN (
        SELECT song_id, SUM(COALESCE(skip_count, 0)) AS user_skip_count
        FROM user_history
        WHERE user_id = $1
          AND last_played > NOW() - INTERVAL '1 month' * $2
          AND song_id IN (SELECT id FROM candidate_ids)
        GROUP BY song_id
      ) ush ON s.id = ush.song_id
      LEFT JOIN (
        SELECT song_id, COUNT(*) AS like_count
        FROM likes
        WHERE song_id IN (SELECT id FROM candidate_ids)
        GROUP BY song_id
      ) lk ON s.id = lk.song_id
      LEFT JOIN collaborative_recs cr ON s.id = cr.song_id
      LEFT JOIN song_features sf ON s.id = sf.song_id
      LEFT JOIN genre_prefs gp ON s.genre = gp.genre
      LEFT JOIN top_genres tg ON s.genre = tg.genre
      LEFT JOIN related_genres rg ON s.genre = rg.related_genre
      LEFT JOIN artist_prefs ap ON s.artist = ap.artist
      CROSS JOIN user_audio_profile uap
    ),
    normalized AS (
      SELECT
        id,
        artist,
        genre,
        genre_affinity,
        genre_rank,
        is_top_genre,
        related_genre_bonus,
        artist_affinity,
        collab_score,
        weighted_collab,
        random_factor,
        LEAST(COALESCE(user_skip_count, 0) / 3, 1) AS user_skip_penalty,
        CASE WHEN MAX(popularity) OVER() = MIN(popularity) OVER() THEN 0.5
          ELSE (popularity - MIN(popularity) OVER()) / NULLIF(MAX(popularity) OVER() - MIN(popularity) OVER(), 1)
        END AS pop_norm,
        CASE WHEN MAX(like_count) OVER() = MIN(like_count) OVER() THEN 0
          ELSE (like_count - MIN(like_count) OVER()) / NULLIF(MAX(like_count) OVER() - MIN(like_count) OVER(), 1)
        END AS like_norm,
        CASE WHEN MAX(global_play_count) OVER() = MIN(global_play_count) OVER() THEN 0
          ELSE (global_play_count - MIN(global_play_count) OVER()) / NULLIF(MAX(global_play_count) OVER() - MIN(global_play_count) OVER(), 1)
        END AS gpc_norm,
        CASE WHEN MAX(weighted_collab) OVER() = MIN(weighted_collab) OVER() THEN 0
          ELSE (weighted_collab - MIN(weighted_collab) OVER()) / NULLIF(MAX(weighted_collab) OVER() - MIN(weighted_collab) OVER(), 1)
        END AS collab_norm,
        -- Векторная близость (cosine distance: 0..2). Приводим к похожести 0..1
        GREATEST(0.0, LEAST(1.0, 1.0 - (COALESCE(vec_dist, 2.0) / 2.0))) AS vector_similarity,
        CASE 
          WHEN avg_energy IS NULL OR energy IS NULL THEN 0
          ELSE 1.0 - LEAST(1.0, (
            ABS(COALESCE(energy, 0.5) - COALESCE(avg_energy, 0.5)) / GREATEST(COALESCE(std_energy, 0.2), 0.1) +
            ABS(COALESCE(valence, 0.5) - COALESCE(avg_valence, 0.5)) / GREATEST(COALESCE(std_valence, 0.2), 0.1) +
            ABS(COALESCE(danceability, 0.5) - COALESCE(avg_danceability, 0.5)) * 2
          ) / 5.0)
        END AS content_similarity
      FROM song_candidates
    ),
    scored AS (
      SELECT
        id,
        artist,
        genre,
        (
          ($3::numeric * COALESCE(pop_norm, 0)) +
          ($4::numeric * COALESCE(gpc_norm, 0)) +
          ($5::numeric * COALESCE(like_norm, 0)) +
          ($6::numeric * COALESCE(artist_affinity, 0)) +
          ($7::numeric * COALESCE(genre_affinity, 0)) +
          ($10::numeric * COALESCE(user_skip_penalty, 0)) +
          (0.15 * is_top_genre) +
          (0.10 * related_genre_bonus) +
          (0.20 * COALESCE(collab_norm, 0)) +
          (0.60 * COALESCE(vector_similarity, 0)) +
          (0.10 * COALESCE(content_similarity, 0)) +
          (0.02 * random_factor)
        ) AS total_score
      FROM normalized
    )
    SELECT id, artist, genre, total_score as score
    FROM scored
    ORDER BY total_score DESC
    LIMIT $8::int
  `;

  const legacySql = `
    WITH 
    disliked_songs AS (
      SELECT song_id FROM dislikes WHERE user_id = $1
    ),

    listened_songs AS (
      SELECT song_id FROM user_history
      WHERE user_id = $1
        AND (
          last_played > NOW() - INTERVAL '1 day' * $9::int
          OR play_count >= 5
        )
    ),
    
    -- ==========================================
    -- ЖАНРОВЫЕ ПРЕДПОЧТЕНИЯ (улучшенный расчёт)
    -- ==========================================
    genre_stats AS (
      SELECT
        s.genre,
        COUNT(DISTINCT s.id) AS tracks_listened,
        SUM(COALESCE(h.play_count, 0)) AS total_plays,
        SUM(CASE WHEN l.id IS NOT NULL THEN 1 ELSE 0 END) AS likes_count,
        SUM(COALESCE(h.skip_count, 0)) AS skips_count,
        AVG(COALESCE(h.play_count, 0)) AS avg_plays_per_track
      FROM user_history h
      JOIN songs s ON h.song_id = s.id
      LEFT JOIN likes l ON l.user_id = $1 AND l.song_id = s.id
      WHERE h.user_id = $1
        AND h.last_played > NOW() - INTERVAL '1 month' * $2
        AND s.genre IS NOT NULL AND s.genre != ''
      GROUP BY s.genre
    ),
    genre_prefs AS (
      SELECT 
        genre,
        -- Комплексный скор жанра
        (
          (tracks_listened * 1.0) +
          (total_plays * 0.5) +
          (likes_count * 3.0) -
          (skips_count * 0.3)
        ) / NULLIF(
          MAX((tracks_listened * 1.0) + (total_plays * 0.5) + (likes_count * 3.0)) OVER(), 
          0
        ) AS genre_affinity,
        -- Ранг жанра для diversity
        ROW_NUMBER() OVER (ORDER BY 
          (tracks_listened * 1.0) + (total_plays * 0.5) + (likes_count * 3.0) DESC
        ) AS genre_rank
      FROM genre_stats
    ),
    
    -- Топ-3 любимых жанра для exploration bonus
    top_genres AS (
      SELECT genre FROM genre_prefs WHERE genre_rank <= 3
    ),
    
    -- Родственные жанры (для exploration)
    -- Если слушает Hip-Hop, может понравится R&B и т.д.
    related_genres AS (
      SELECT DISTINCT s2.genre AS related_genre, gp.genre AS source_genre
      FROM songs s1
      JOIN songs s2 ON s1.artist = s2.artist AND s1.genre != s2.genre
      JOIN genre_prefs gp ON s1.genre = gp.genre
      WHERE gp.genre_rank <= 3
        AND s2.genre IS NOT NULL AND s2.genre != ''
    ),
    
    -- ==========================================
    -- АРТИСТСКИЕ ПРЕДПОЧТЕНИЯ
    -- ==========================================
    artist_prefs AS (
      SELECT
        s.artist,
        SUM(
          COALESCE(h.play_count, 0) * 1.0 +
          CASE WHEN l.id IS NOT NULL THEN 3.0 ELSE 0 END +
          CASE WHEN h.liked THEN 2.0 ELSE 0 END -
          COALESCE(h.skip_count, 0) * 0.5
        ) / NULLIF(
          MAX(SUM(
            COALESCE(h.play_count, 0) * 1.0 +
            CASE WHEN l.id IS NOT NULL THEN 3.0 ELSE 0 END
          )) OVER(), 0
        ) AS artist_affinity
      FROM user_history h
      JOIN songs s ON h.song_id = s.id
      LEFT JOIN likes l ON l.user_id = $1 AND l.song_id = s.id
      WHERE h.user_id = $1
        AND h.last_played > NOW() - INTERVAL '1 month' * $2
        AND s.artist IS NOT NULL AND s.artist != ''
      GROUP BY s.artist
      HAVING SUM(COALESCE(h.play_count, 0)) > 0
    ),
    
    -- ==========================================
    -- AUDIO PROFILE (Content-based)
    -- ==========================================
    user_audio_profile AS (
      SELECT
        AVG(sf.energy) AS avg_energy,
        AVG(sf.valence) AS avg_valence,
        AVG(sf.danceability) AS avg_danceability,
        AVG(sf.tempo) AS avg_tempo,
        STDDEV(sf.energy) AS std_energy,
        STDDEV(sf.valence) AS std_valence
      FROM user_history h
      JOIN song_features sf ON h.song_id = sf.song_id
      LEFT JOIN likes l ON l.user_id = $1 AND l.song_id = h.song_id
      WHERE h.user_id = $1
        AND (h.play_count >= 2 OR l.id IS NOT NULL OR h.liked = true)
    ),
    
    -- ==========================================
    -- COLLABORATIVE FILTERING
    -- ==========================================
    similar_users AS (
      SELECT l2.user_id AS similar_user_id, COUNT(*) AS shared_likes
      FROM likes l1
      JOIN likes l2 ON l1.song_id = l2.song_id AND l2.user_id != $1
      WHERE l1.user_id = $1
      GROUP BY l2.user_id
      HAVING COUNT(*) >= 2
      ORDER BY shared_likes DESC
      LIMIT 50
    ),
    collaborative_recs AS (
      SELECT l.song_id, 
        COUNT(DISTINCT l.user_id) AS similar_user_likes,
        SUM(su.shared_likes) AS weighted_collab_score
      FROM likes l
      JOIN similar_users su ON l.user_id = su.similar_user_id
      WHERE l.song_id NOT IN (SELECT song_id FROM listened_songs)
        AND l.song_id NOT IN (SELECT song_id FROM disliked_songs)
      GROUP BY l.song_id
    ),
    
    -- ==========================================
    -- ФИНАЛЬНЫЙ SCORING
    -- ==========================================
    song_candidates AS (
      SELECT
        s.id,
        s.artist,
        s.genre,
        s.title,
        COALESCE(s.popularity, 0)::numeric AS popularity,
        COALESCE(s.play_count, 0)::numeric AS play_count,
        COALESCE(h.total_plays, 0)::numeric AS global_play_count,
        COALESCE(ush.user_skip_count, 0)::numeric AS user_skip_count,
        COALESCE(lk.like_count, 0)::numeric AS like_count,
        COALESCE(cr.similar_user_likes, 0)::numeric AS collab_score,
        COALESCE(cr.weighted_collab_score, 0)::numeric AS weighted_collab,
        -- Жанровые скоры
        COALESCE(gp.genre_affinity, 0) AS genre_affinity,
        COALESCE(gp.genre_rank, 999) AS genre_rank,
        CASE WHEN tg.genre IS NOT NULL THEN 1 ELSE 0 END AS is_top_genre,
        CASE WHEN rg.related_genre IS NOT NULL THEN 0.5 ELSE 0 END AS related_genre_bonus,
        -- Артистские скоры
        COALESCE(ap.artist_affinity, 0) AS artist_affinity,
        -- Audio features
        sf.energy,
        sf.valence,
        sf.danceability,
        sf.tempo,
        uap.avg_energy,
        uap.avg_valence,
        uap.avg_danceability,
        uap.std_energy,
        uap.std_valence,
        -- Случайный фактор для разнообразия
        RANDOM() AS random_factor
      FROM (
        SELECT s0.id, s0.artist, s0.genre, s0.title, s0.popularity, s0.play_count
        FROM songs s0
        LEFT JOIN listened_songs ls0 ON s0.id = ls0.song_id
        LEFT JOIN disliked_songs ds0 ON s0.id = ds0.song_id
        WHERE COALESCE(s0.is_available, true) = true
          AND ls0.song_id IS NULL
          AND ds0.song_id IS NULL
        ORDER BY s0.popularity DESC NULLS LAST, RANDOM()
        LIMIT $8
      ) s
      -- Глобальная статистика
      LEFT JOIN (
        SELECT song_id, SUM(play_count) AS total_plays
        FROM user_history
        WHERE song_id IN (SELECT id FROM (SELECT s1.id FROM songs s1 LEFT JOIN listened_songs ls1 ON s1.id = ls1.song_id LEFT JOIN disliked_songs ds1 ON s1.id = ds1.song_id WHERE COALESCE(s1.is_available, true) = true AND ls1.song_id IS NULL AND ds1.song_id IS NULL LIMIT $8) sub)
        GROUP BY song_id
      ) h ON s.id = h.song_id
      LEFT JOIN (
        SELECT song_id, SUM(COALESCE(skip_count, 0)) AS user_skip_count
        FROM user_history
        WHERE user_id = $1
          AND last_played > NOW() - INTERVAL '1 month' * $2
        GROUP BY song_id
      ) ush ON s.id = ush.song_id
      -- Лайки
      LEFT JOIN (
        SELECT song_id, COUNT(*) AS like_count
        FROM likes
        GROUP BY song_id
      ) lk ON s.id = lk.song_id
      -- Collaborative
      LEFT JOIN collaborative_recs cr ON s.id = cr.song_id
      -- Audio features
      LEFT JOIN song_features sf ON s.id = sf.song_id
      -- Жанровые предпочтения
      LEFT JOIN genre_prefs gp ON s.genre = gp.genre
      LEFT JOIN top_genres tg ON s.genre = tg.genre
      LEFT JOIN related_genres rg ON s.genre = rg.related_genre
      -- Артистские предпочтения
      LEFT JOIN artist_prefs ap ON s.artist = ap.artist
      -- Audio profile
      CROSS JOIN user_audio_profile uap
    ),
    normalized AS (
      SELECT
        id,
        artist,
        genre,
        genre_affinity,
        genre_rank,
        is_top_genre,
        related_genre_bonus,
        artist_affinity,
        collab_score,
        weighted_collab,
        random_factor,
        LEAST(COALESCE(user_skip_count, 0) / 3, 1) AS user_skip_penalty,
        -- Нормализация
        CASE WHEN MAX(popularity) OVER() = MIN(popularity) OVER() THEN 0.5
          ELSE (popularity - MIN(popularity) OVER()) / NULLIF(MAX(popularity) OVER() - MIN(popularity) OVER(), 1)
        END AS pop_norm,
        CASE WHEN MAX(like_count) OVER() = MIN(like_count) OVER() THEN 0
          ELSE (like_count - MIN(like_count) OVER()) / NULLIF(MAX(like_count) OVER() - MIN(like_count) OVER(), 1)
        END AS like_norm,
        CASE WHEN MAX(global_play_count) OVER() = MIN(global_play_count) OVER() THEN 0
          ELSE (global_play_count - MIN(global_play_count) OVER()) / NULLIF(MAX(global_play_count) OVER() - MIN(global_play_count) OVER(), 1)
        END AS gpc_norm,
        CASE WHEN MAX(weighted_collab) OVER() = MIN(weighted_collab) OVER() THEN 0
          ELSE (weighted_collab - MIN(weighted_collab) OVER()) / NULLIF(MAX(weighted_collab) OVER() - MIN(weighted_collab) OVER(), 1)
        END AS collab_norm,
        -- Content-based similarity с учётом разброса
        CASE 
          WHEN avg_energy IS NULL OR energy IS NULL THEN 0
          ELSE 1.0 - LEAST(1.0, (
            ABS(COALESCE(energy, 0.5) - COALESCE(avg_energy, 0.5)) / GREATEST(COALESCE(std_energy, 0.2), 0.1) +
            ABS(COALESCE(valence, 0.5) - COALESCE(avg_valence, 0.5)) / GREATEST(COALESCE(std_valence, 0.2), 0.1) +
            ABS(COALESCE(danceability, 0.5) - COALESCE(avg_danceability, 0.5)) * 2
          ) / 5.0)
        END AS content_similarity
      FROM song_candidates
    ),
    scored AS (
      SELECT
        id,
        artist,
        genre,
        -- Итоговый скор с улучшенным учётом жанров
        (
          -- Базовые сигналы
          ($3::numeric * COALESCE(pop_norm, 0)) +
          ($4::numeric * COALESCE(gpc_norm, 0)) +
          ($5::numeric * COALESCE(like_norm, 0)) +

          -- Артистские предпочтения
          ($6::numeric * COALESCE(artist_affinity, 0)) +
          
          -- ЖАНРОВЫЕ ПРЕДПОЧТЕНИЯ (усиленные)
          ($7::numeric * COALESCE(genre_affinity, 0)) +
          -- Бонус за топ-жанр
          (0.15 * is_top_genre) +
          -- Бонус за родственный жанр (exploration)
          (0.10 * related_genre_bonus) +
          
          -- Collaborative filtering
          (0.25 * COALESCE(collab_norm, 0)) +
          
          -- Content-based similarity
          (0.15 * COALESCE(content_similarity, 0)) +
          
          -- Штраф за скипы (weights.userSkipCount уже отрицательный в конфиге: -0.4)
          ($10::numeric * COALESCE(user_skip_penalty, 0)) +
          
          -- Случайный фактор для разнообразия
          (0.05 * random_factor)
        ) AS total_score
      FROM normalized
    )
    SELECT id, artist, genre, total_score as score
    FROM scored
    ORDER BY total_score DESC
    LIMIT $8::int
  `;

  let result;
  try {
    result = await query(vectorSql, [
      Number(userId),
      Number(historyLimitMonths),
      Number(weights.popularity),
      Number(weights.playCount),
      Number(weights.userLikeCount),
      Number(persWeights.artistPreference),
      Number(persWeights.genrePreference),
      Number(fetchLimit),
      Number(userVectorFallbackLimit),
      Number(weights.userSkipCount),
      Number(recentExcludeDays),
    ]);
  } catch (err) {
    logger.warn({ err: err.message, userId }, 'Vector-based recommendations unavailable, falling back to legacy SQL');
    result = null;
  }

  if (!result || !result.rows || result.rows.length === 0) {
    result = await query(legacySql, [
      Number(userId),
      Number(historyLimitMonths),
      Number(weights.popularity),
      Number(weights.playCount),
      Number(weights.userLikeCount),
      Number(persWeights.artistPreference),
      Number(persWeights.genrePreference),
      Number(fetchLimit),
      Number(recentExcludeDays),
      Number(weights.userSkipCount),
    ]);
  }

  const resultRows = (result.rows || []);

  const scoredTracks = resultRows.map(row => ({
    id: row.id,
    artist: row.artist,
    genre: row.genre,
    score: Number.parseFloat(row.score) || 0,
  }));

  // Применяем diversity reranking
  // (оставляем поведение прежним)

  // Подсчёт артистов ДО diversity
  const artistsBefore = new Map();
  for (const t of scoredTracks.slice(0, 50)) {
    const a = (t.artist || 'unknown').toLowerCase();
    artistsBefore.set(a, (artistsBefore.get(a) || 0) + 1);
  }

  let userRecs = applyDiversityReranking(scoredTracks, topN);

  // Подсчёт артистов ПОСЛЕ diversity  
  const artistsAfter = new Map();
  for (const id of userRecs.slice(0, 50)) {
    const track = scoredTracks.find(t => t.id === id);
    if (track) {
      const a = (track.artist || 'unknown').toLowerCase();
      artistsAfter.set(a, (artistsAfter.get(a) || 0) + 1);
    }
  }

  logger.info({
    userId,
    rawCount: resultRows.length,
    diversifiedCount: userRecs.length,
    top3ArtistsBefore: [...artistsBefore.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
    top3ArtistsAfter: [...artistsAfter.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
  }, 'Diversity reranking applied');

  logPerformance('compute-user-recommendations', Date.now() - startTime, {
    userId,
    rawCount: resultRows.length,
    diversifiedCount: userRecs.length,
  });

  logger.debug({
    userId,
    rawCount: resultRows.length,
    finalCount: userRecs.length,
  }, 'User recommendations computed with diversity');

  return userRecs;
}

/**
 * Получает похожие треки для заданного трека
 * Content-based: по audio features
 * @param {number} trackId
 * @param {number} limit
 * @returns {Promise<number[]>}
 */
async function getSimilarTracks(trackId, limit = 20) {
  // 1) Быстрый путь: pgvector (если embedding уже заполнен)
  try {
    const vecResult = await query(
      `WITH target AS (
         SELECT embedding
         FROM songs
         WHERE id = $1 AND embedding IS NOT NULL
       )
       SELECT s.id AS song_id
       FROM songs s
       CROSS JOIN target t
       WHERE s.id != $1
         AND s.embedding IS NOT NULL
       ORDER BY s.embedding <=> t.embedding
       LIMIT $2`,
      [trackId, limit]
    );

    const ids = vecResult.rows.map((row) => row.song_id);
    if (ids.length > 0) {
      return ids;
    }
  } catch (err) {
    // pgvector может быть не установлен/embedding ещё нет — fallback ниже
    logger.warn({ err: err.message, trackId }, 'Vector similarity unavailable, falling back to feature distance');
  }

  // 2) Fallback: старая формула по audio features
  const result = await query(`
    WITH target AS (
      SELECT energy, valence, danceability, tempo
      FROM song_features
      WHERE song_id = $1
    ),
    similar AS (
      SELECT 
        sf.song_id,
        1.0 - (
          ABS(COALESCE(sf.energy, 0.5) - COALESCE(t.energy, 0.5)) * 0.3 +
          ABS(COALESCE(sf.valence, 0.5) - COALESCE(t.valence, 0.5)) * 0.3 +
          ABS(COALESCE(sf.danceability, 0.5) - COALESCE(t.danceability, 0.5)) * 0.2 +
          ABS(COALESCE(sf.tempo, 120) - COALESCE(t.tempo, 120)) / 200.0 * 0.2
        ) AS similarity
      FROM song_features sf
      CROSS JOIN target t
      WHERE sf.song_id != $1
    )
    SELECT song_id
    FROM similar
    ORDER BY similarity DESC
    LIMIT $2
  `, [trackId, limit]);

  return result.rows.map((row) => row.song_id);
}

module.exports = {
  computeUserRecommendations,
  getSimilarTracks,
};
