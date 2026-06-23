#!/usr/bin/env node
/**
 * Скрипт запуска миграций для recommendations-service
 * Выполняет только новые миграции, которые ещё не применены
 * 
 * Запуск: node scripts/runMigrations.js
 */

try {
  require('dotenv').config();
} catch {
}

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'music_platform',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

const MIGRATIONS_ADVISORY_LOCK_ID = '742938472938472';

function normalizeSqlForDetection(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:""|[^"])*"/g, '""');
}

function isNonTransactionalMigration(sql) {
  const normalized = normalizeSqlForDetection(sql);
  return (
    /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i.test(normalized) ||
    /\bREINDEX\s+(?:INDEX|TABLE|SCHEMA|DATABASE)?\s*CONCURRENTLY\b/i.test(normalized) ||
    /\bVACUUM\b/i.test(normalized)
  );
}

function splitSqlStatements(sql) {
  const statements = [];
  let buf = '';

  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag = null;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = i + 1 < sql.length ? sql[i + 1] : '';

    if (inLineComment) {
      buf += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      buf += ch;
      if (ch === '*' && next === '/') {
        buf += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }

    if (dollarTag) {
      buf += ch;
      if (ch === '$') {
        const maybeClose = sql.slice(i, i + dollarTag.length);
        if (maybeClose === dollarTag) {
          buf += dollarTag.slice(1);
          i += dollarTag.length - 1;
          dollarTag = null;
        }
      }
      continue;
    }

    if (inSingleQuote) {
      buf += ch;
      if (ch === "'") {
        if (next === "'") {
          buf += next;
          i++;
        } else {
          inSingleQuote = false;
        }
      }
      continue;
    }

    if (inDoubleQuote) {
      buf += ch;
      if (ch === '"') {
        if (next === '"') {
          buf += next;
          i++;
        } else {
          inDoubleQuote = false;
        }
      }
      continue;
    }

    if (ch === '-' && next === '-') {
      buf += ch + next;
      i++;
      inLineComment = true;
      continue;
    }

    if (ch === '/' && next === '*') {
      buf += ch + next;
      i++;
      inBlockComment = true;
      continue;
    }

    if (ch === '$') {
      const m = sql.slice(i).match(/^\$[a-zA-Z0-9_]*\$/);
      if (m) {
        const tag = m[0];
        dollarTag = tag;
        buf += tag;
        i += tag.length - 1;
        continue;
      }
    }

    if (ch === "'") {
      buf += ch;
      inSingleQuote = true;
      continue;
    }

    if (ch === '"') {
      buf += ch;
      inDoubleQuote = true;
      continue;
    }

    if (ch === ';') {
      const stmt = buf.trim();
      if (stmt.length > 0) statements.push(stmt);
      buf = '';
      continue;
    }

    buf += ch;
  }

  const tail = buf.trim();
  if (tail.length > 0) statements.push(tail);
  return statements;
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS reco_migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function getAppliedMigrations(client) {
  const result = await client.query('SELECT name FROM reco_migrations ORDER BY id');
  return new Set(result.rows.map(r => r.name));
}

async function recordMigration(client, name) {
  try {
    await client.query('INSERT INTO reco_migrations (name) VALUES ($1)', [name]);
  } catch (err) {
    if (err && err.code === '23505') return;
    throw err;
  }
}

async function getMigrationFiles() {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
  return files;
}

async function run() {
  const client = await pool.connect();

  try {
    console.log('🚀 Запуск миграций recommendations-service...\n');

    await client.query('SELECT pg_advisory_lock($1::bigint)', [MIGRATIONS_ADVISORY_LOCK_ID]);
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);
    const files = await getMigrationFiles();

    console.log(`📋 Найдено миграций: ${files.length}`);
    console.log(`✅ Применено ранее: ${applied.size}\n`);

    let newCount = 0;

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`⏭️  ${file} (уже применена)`);
        continue;
      }

      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      const nonTransactional = isNonTransactionalMigration(sql);

      console.log(`🔄 Применяю ${file}...`);

      try {
        if (nonTransactional) {
          const statements = splitSqlStatements(sql);
          for (const stmt of statements) {
            await client.query(stmt);
          }
          await recordMigration(client, file);
        } else {
          await client.query('BEGIN');
          await client.query(sql);
          await recordMigration(client, file);
          await client.query('COMMIT');
        }
        console.log(`   ✅ Успешно`);
        newCount++;
      } catch (err) {
        if (!nonTransactional) await client.query('ROLLBACK');
        console.error(`   ❌ Ошибка: ${err.message}`);

        // Для некритичных ошибок (например, "already exists") продолжаем
        if (err.message.includes('already exists') ||
          err.message.includes('duplicate key')) {
          console.log(`   ⚠️  Пропускаю (объект уже существует)`);
          await recordMigration(client, file);
          continue;
        }

        throw err;
      }
    }

    console.log(`\n✅ Миграции завершены! Применено новых: ${newCount}`);

  } catch (err) {
    console.error('\n❌ Критическая ошибка:', err.message);
    throw err;
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [MIGRATIONS_ADVISORY_LOCK_ID]);
    } catch (_) {
    }
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
