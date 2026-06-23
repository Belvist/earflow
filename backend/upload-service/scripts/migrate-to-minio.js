#!/usr/bin/env node
/**
 * Migration Script: Local Files → MinIO
 * 
 * Переносит существующие аудиофайлы и обложки из локального хранилища в MinIO.
 * Можно запускать многократно - уже перенесённые файлы пропускаются.
 * 
 * Usage:
 *   node scripts/migrate-to-minio.js [--dry-run] [--audio-only] [--covers-only]
 * 
 * Options:
 *   --dry-run      Только показать что будет перенесено, без фактического переноса
 *   --audio-only   Переносить только аудиофайлы
 *   --covers-only  Переносить только обложки
 */

const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

// ============================================================================
// Configuration
// ============================================================================

const config = {
  endpoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT, 10) || 9000,
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER || '',
  secretKey: process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || '',
  audioBucket: process.env.MINIO_BUCKET_AUDIO || 'music-audio',
  coversBucket: process.env.MINIO_BUCKET_COVERS || 'music-covers',
};

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const COVERS_DIR = path.join(__dirname, '..', '..', 'covers'); // Если есть отдельная папка

// CLI Arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const AUDIO_ONLY = args.includes('--audio-only');
const COVERS_ONLY = args.includes('--covers-only');

// Audio extensions
const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.wma'];
const COVER_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

// ============================================================================
// S3 Client
// ============================================================================

const endpoint = `http://${config.endpoint}:${config.port}`;
const s3Client = new S3Client({
  endpoint,
  region: 'us-east-1',
  credentials: {
    accessKeyId: config.accessKey,
    secretAccessKey: config.secretKey,
  },
  forcePathStyle: true,
});

// ============================================================================
// Utility Functions
// ============================================================================

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.wma': 'audio/x-ms-wma',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

async function fileExistsInMinio(bucket, key) {
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
}

async function uploadToMinio(localPath, bucket, key) {
  const buffer = await fs.readFile(localPath);
  const contentType = getContentType(localPath);
  
  await s3Client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    Metadata: {
      'original-filename': encodeURIComponent(path.basename(localPath)),
      'migrated-at': new Date().toISOString(),
    },
  }));
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ============================================================================
// Migration Functions
// ============================================================================

async function migrateAudioFiles() {
  console.log('\n📁 Scanning audio files...');
  
  if (!await fs.pathExists(UPLOAD_DIR)) {
    console.log('   No uploads directory found');
    return { total: 0, migrated: 0, skipped: 0, failed: 0, size: 0 };
  }

  const stats = { total: 0, migrated: 0, skipped: 0, failed: 0, size: 0 };
  
  // Scan uploads directory recursively
  const scanDir = async (dir, prefix = 'audio/') => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        // Recurse into subdirectories
        await scanDir(fullPath, `${prefix}${entry.name}/`);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!AUDIO_EXTENSIONS.includes(ext)) continue;
        
        stats.total++;
        const key = `${prefix}${entry.name}`;
        const fileStat = await fs.stat(fullPath);
        
        try {
          // Check if already exists in MinIO
          const exists = await fileExistsInMinio(config.audioBucket, key);
          
          if (exists) {
            console.log(`   ⏭️  Skip (exists): ${entry.name}`);
            stats.skipped++;
            continue;
          }
          
          if (DRY_RUN) {
            console.log(`   📦 Would migrate: ${entry.name} (${formatBytes(fileStat.size)})`);
            stats.migrated++;
            stats.size += fileStat.size;
          } else {
            process.stdout.write(`   📤 Uploading: ${entry.name}...`);
            await uploadToMinio(fullPath, config.audioBucket, key);
            console.log(` ✅ (${formatBytes(fileStat.size)})`);
            stats.migrated++;
            stats.size += fileStat.size;
          }
        } catch (err) {
          console.log(`   ❌ Failed: ${entry.name} - ${err.message}`);
          stats.failed++;
        }
      }
    }
  };
  
  await scanDir(UPLOAD_DIR);
  return stats;
}

async function migrateCoverFiles() {
  console.log('\n🖼️  Scanning cover files...');
  
  const stats = { total: 0, migrated: 0, skipped: 0, failed: 0, size: 0 };
  
  // Check multiple possible cover locations
  const coverDirs = [
    COVERS_DIR,
    path.join(UPLOAD_DIR, 'covers'),
    path.join(__dirname, '..', '..', 'track-processor', 'covers'),
  ];
  
  for (const coverDir of coverDirs) {
    if (!await fs.pathExists(coverDir)) continue;
    
    console.log(`   Scanning: ${coverDir}`);
    const entries = await fs.readdir(coverDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      
      const ext = path.extname(entry.name).toLowerCase();
      if (!COVER_EXTENSIONS.includes(ext)) continue;
      
      stats.total++;
      const fullPath = path.join(coverDir, entry.name);
      const key = `covers/${entry.name}`;
      const fileStat = await fs.stat(fullPath);
      
      try {
        const exists = await fileExistsInMinio(config.coversBucket, key);
        
        if (exists) {
          stats.skipped++;
          continue;
        }
        
        if (DRY_RUN) {
          console.log(`   📦 Would migrate: ${entry.name}`);
          stats.migrated++;
          stats.size += fileStat.size;
        } else {
          await uploadToMinio(fullPath, config.coversBucket, key);
          stats.migrated++;
          stats.size += fileStat.size;
        }
      } catch (err) {
        console.log(`   ❌ Failed: ${entry.name} - ${err.message}`);
        stats.failed++;
      }
    }
  }
  
  return stats;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        MinIO Migration Script - Local → Object Storage');
  console.log('═══════════════════════════════════════════════════════════════');
  
  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No files will be uploaded');
  }
  
  console.log(`\n📡 MinIO Endpoint: ${endpoint}`);
  console.log(`📦 Audio Bucket: ${config.audioBucket}`);
  console.log(`🖼️  Covers Bucket: ${config.coversBucket}`);
  
  // Test connection
  try {
    await fileExistsInMinio(config.audioBucket, '.test');
    console.log('✅ MinIO connection successful\n');
  } catch (err) {
    console.error('❌ MinIO connection failed:', err.message);
    console.error('   Make sure MinIO is running and credentials are correct');
    process.exit(1);
  }
  
  let audioStats = { total: 0, migrated: 0, skipped: 0, failed: 0, size: 0 };
  let coverStats = { total: 0, migrated: 0, skipped: 0, failed: 0, size: 0 };
  
  if (!COVERS_ONLY) {
    audioStats = await migrateAudioFiles();
  }
  
  if (!AUDIO_ONLY) {
    coverStats = await migrateCoverFiles();
  }
  
  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                        Migration Summary');
  console.log('═══════════════════════════════════════════════════════════════');
  
  if (!COVERS_ONLY) {
    console.log(`\n🎵 Audio Files:`);
    console.log(`   Total found:  ${audioStats.total}`);
    console.log(`   Migrated:     ${audioStats.migrated} (${formatBytes(audioStats.size)})`);
    console.log(`   Skipped:      ${audioStats.skipped}`);
    console.log(`   Failed:       ${audioStats.failed}`);
  }
  
  if (!AUDIO_ONLY) {
    console.log(`\n🖼️  Cover Files:`);
    console.log(`   Total found:  ${coverStats.total}`);
    console.log(`   Migrated:     ${coverStats.migrated} (${formatBytes(coverStats.size)})`);
    console.log(`   Skipped:      ${coverStats.skipped}`);
    console.log(`   Failed:       ${coverStats.failed}`);
  }
  
  const totalSize = audioStats.size + coverStats.size;
  console.log(`\n📊 Total migrated: ${formatBytes(totalSize)}`);
  
  if (DRY_RUN) {
    console.log('\n💡 Run without --dry-run to perform actual migration');
  }
  
  console.log('\n✅ Migration complete!\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
