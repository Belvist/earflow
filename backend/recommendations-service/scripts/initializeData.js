#!/usr/bin/env node
/**
 * Скрипт инициализации данных для рекомендаций
 * Заполняет popularity, создаёт начальную статистику
 * 
 * Запуск: node scripts/initializeData.js
 */

require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'music_platform',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

async function run() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Начинаю инициализацию данных для рекомендаций...\n');

    // 1. Проверяем наличие треков
    const songsCount = await client.query('SELECT COUNT(*) FROM songs');
    console.log(`📊 Всего треков в базе: ${songsCount.rows[0].count}`);

    if (parseInt(songsCount.rows[0].count, 10) === 0) {
      console.log('⚠️  Нет треков в базе. Загрузите треки через track-processor.');
      return;
    }

    // 2. Заполняем popularity если пустое
    console.log('\n📈 Обновляю popularity...');
    const popularityResult = await client.query(`
      UPDATE songs 
      SET popularity = LEAST(100, GREATEST(0,
        COALESCE(play_count, 0)::numeric / NULLIF(
          (SELECT MAX(play_count) FROM songs WHERE play_count > 0), 1
        ) * 100
      ))
      WHERE popularity IS NULL OR popularity = 0
      RETURNING id
    `);
    console.log(`   Обновлено: ${popularityResult.rowCount} треков`);

    // 3. Создаём базовый play_count если его нет
    console.log('\n🎵 Инициализирую play_count...');
    const playCountResult = await client.query(`
      UPDATE songs 
      SET play_count = FLOOR(RANDOM() * 100 + 1)
      WHERE play_count IS NULL OR play_count = 0
      RETURNING id
    `);
    console.log(`   Обновлено: ${playCountResult.rowCount} треков`);

    // 4. Проверяем таблицы рекомендаций
    console.log('\n📋 Проверяю структуру таблиц...');
    
    const tables = ['user_history', 'user_interactions', 'likes', 'dislikes', 'song_features'];
    for (const table of tables) {
      const exists = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = $1
        )
      `, [table]);
      const status = exists.rows[0].exists ? '✅' : '❌';
      console.log(`   ${status} ${table}`);
    }

    // 5. Статистика по данным
    console.log('\n📊 Статистика данных:');
    
    const stats = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM songs) AS songs_count,
        (SELECT COUNT(*) FROM songs WHERE popularity > 0) AS songs_with_popularity,
        (SELECT COUNT(*) FROM user_history) AS history_records,
        (SELECT COUNT(DISTINCT user_id) FROM user_history) AS users_with_history,
        (SELECT COUNT(*) FROM likes) AS total_likes,
        (SELECT COUNT(*) FROM dislikes) AS total_dislikes,
        (SELECT COUNT(*) FROM song_features) AS songs_with_features,
        (SELECT COUNT(*) FROM user_interactions) AS total_interactions
    `);
    
    const s = stats.rows[0];
    console.log(`   Треков: ${s.songs_count}`);
    console.log(`   С popularity > 0: ${s.songs_with_popularity}`);
    console.log(`   Записей в user_history: ${s.history_records}`);
    console.log(`   Пользователей с историей: ${s.users_with_history}`);
    console.log(`   Лайков: ${s.total_likes}`);
    console.log(`   Дизлайков: ${s.total_dislikes}`);
    console.log(`   Треков с audio features: ${s.songs_with_features}`);
    console.log(`   Взаимодействий: ${s.total_interactions}`);

    // 6. Проверяем жанры
    console.log('\n🎸 Топ-10 жанров:');
    const genres = await client.query(`
      SELECT genre, COUNT(*) as count 
      FROM songs 
      WHERE genre IS NOT NULL AND genre != ''
      GROUP BY genre 
      ORDER BY count DESC 
      LIMIT 10
    `);
    genres.rows.forEach((row, i) => {
      console.log(`   ${i + 1}. ${row.genre}: ${row.count} треков`);
    });

    // 7. Проверяем артистов
    console.log('\n🎤 Топ-10 артистов:');
    const artists = await client.query(`
      SELECT artist, COUNT(*) as count 
      FROM songs 
      WHERE artist IS NOT NULL AND artist != ''
      GROUP BY artist 
      ORDER BY count DESC 
      LIMIT 10
    `);
    artists.rows.forEach((row, i) => {
      console.log(`   ${i + 1}. ${row.artist}: ${row.count} треков`);
    });

    console.log('\n✅ Инициализация завершена!');
    console.log('\n📝 Следующие шаги:');
    console.log('   1. Запустите Redis: docker-compose up -d redis');
    console.log('   2. Запустите offline worker: node workers/offlineWorker.js');
    console.log('   3. Запустите feedback worker: node workers/feedbackWorker.js');
    console.log('   4. Запустите сервер: node server.js');

  } catch (err) {
    console.error('❌ Ошибка:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
