#!/usr/bin/env node
/**
 * Migrate audio files from local storage to MinIO
 * Run: node scripts/migrate-audio.js
 */

const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs-extra');
const path = require('path');

const config = {
  endpoint: process.env.MINIO_ENDPOINT || 'minio',
  port: parseInt(process.env.MINIO_PORT, 10) || 9000,
  accessKey: process.env.MINIO_ACCESS_KEY || '',
  secretKey: process.env.MINIO_SECRET_KEY || '',
  audioBucket: process.env.MINIO_BUCKET_AUDIO || 'music-audio',
};

const UPLOAD_DIR = '/app/uploads';
const LIBRARY_DIR = '/app/uploads/library';
const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.wma'];

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
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('              MinIO Audio Migration Script');
  console.log('═══════════════════════════════════════════════════════════════');
  
  if (!config.accessKey || !config.secretKey) {
    console.error('❌ MinIO credentials not set');
    process.exit(1);
  }

  const endpoint = `http://${config.endpoint}:${config.port}`;
  console.log(`📡 MinIO: ${endpoint}`);
  console.log(`📦 Bucket: ${config.audioBucket}`);
  
  const s3 = new S3Client({
    endpoint,
    region: 'us-east-1',
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
    forcePathStyle: true,
  });

  // Test connection
  try {
    await s3.send(new HeadObjectCommand({
      Bucket: config.audioBucket,
      Key: '.test',
    }));
  } catch (err) {
    if (err.name !== 'NotFound' && err.$metadata?.httpStatusCode !== 404) {
      console.error('❌ MinIO connection failed:', err.message);
      process.exit(1);
    }
  }
  console.log('✅ MinIO connected\n');

  // Collect all audio files
  const audioFiles = [];
  
  async function scanDir(dir, prefix = '') {
    if (!await fs.pathExists(dir)) return;
    
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        await scanDir(fullPath, prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (AUDIO_EXTENSIONS.includes(ext)) {
          audioFiles.push({
            localPath: fullPath,
            key: `audio/${prefix ? prefix + '/' : ''}${entry.name}`,
            name: entry.name,
          });
        }
      }
    }
  }

  console.log('📁 Scanning directories...');
  await scanDir(LIBRARY_DIR, 'library');
  
  // Also scan root uploads for user-uploaded files
  const rootFiles = await fs.readdir(UPLOAD_DIR, { withFileTypes: true });
  for (const entry of rootFiles) {
    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (AUDIO_EXTENSIONS.includes(ext)) {
        audioFiles.push({
          localPath: path.join(UPLOAD_DIR, entry.name),
          key: `audio/${entry.name}`,
          name: entry.name,
        });
      }
    }
  }

  console.log(`📁 Found ${audioFiles.length} audio files\n`);

  if (audioFiles.length === 0) {
    console.log('✅ No audio files to migrate');
    return;
  }

  // Calculate total size
  let totalSize = 0;
  for (const file of audioFiles) {
    try {
      const stat = await fs.stat(file.localPath);
      file.size = stat.size;
      totalSize += stat.size;
    } catch (err) {
      file.size = 0;
    }
  }
  console.log(`📊 Total size: ${formatBytes(totalSize)}\n`);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  let uploadedSize = 0;

  const startTime = Date.now();

  for (let i = 0; i < audioFiles.length; i++) {
    const file = audioFiles[i];
    
    try {
      // Check if exists in MinIO
      try {
        await s3.send(new HeadObjectCommand({
          Bucket: config.audioBucket,
          Key: file.key,
        }));
        skipped++;
        continue;
      } catch (err) {
        // Not found, proceed to upload
      }

      const buffer = await fs.readFile(file.localPath);
      
      await s3.send(new PutObjectCommand({
        Bucket: config.audioBucket,
        Key: file.key,
        Body: buffer,
        ContentType: getContentType(file.localPath),
        Metadata: {
          'original-filename': encodeURIComponent(file.name),
          'migrated-at': new Date().toISOString(),
        },
      }));

      uploaded++;
      uploadedSize += file.size;
      
      // Progress update every 10 files
      if (uploaded % 10 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = uploadedSize / elapsed;
        const remaining = (totalSize - uploadedSize) / rate;
        console.log(`   📤 ${uploaded}/${audioFiles.length - skipped} | ${formatBytes(uploadedSize)} | ETA: ${Math.round(remaining)}s`);
      }
    } catch (err) {
      console.error(`   ❌ Failed: ${file.name} - ${err.message}`);
      failed++;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                        Summary');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`   Total files:  ${audioFiles.length}`);
  console.log(`   Uploaded:     ${uploaded} (${formatBytes(uploadedSize)})`);
  console.log(`   Skipped:      ${skipped}`);
  console.log(`   Failed:       ${failed}`);
  console.log(`   Time:         ${elapsed}s`);
  console.log('\n✅ Audio migration complete!\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
