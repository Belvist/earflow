#!/usr/bin/env node
/**
 * Migrate covers from local storage to MinIO
 * Run: node scripts/migrate-covers.js
 */

const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs-extra');
const path = require('path');

const config = {
  endpoint: process.env.MINIO_ENDPOINT || 'minio',
  port: parseInt(process.env.MINIO_PORT, 10) || 9000,
  accessKey: process.env.MINIO_ACCESS_KEY || '',
  secretKey: process.env.MINIO_SECRET_KEY || '',
  coversBucket: process.env.MINIO_BUCKET_COVERS || 'music-covers',
};

const COVERS_DIR = '/app/uploads/covers';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('              MinIO Covers Migration Script');
  console.log('═══════════════════════════════════════════════════════════════');
  
  if (!config.accessKey || !config.secretKey) {
    console.error('❌ MinIO credentials not set');
    process.exit(1);
  }

  const endpoint = `http://${config.endpoint}:${config.port}`;
  console.log(`📡 MinIO: ${endpoint}`);
  console.log(`📦 Bucket: ${config.coversBucket}`);
  
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
      Bucket: config.coversBucket,
      Key: '.test',
    }));
  } catch (err) {
    if (err.name !== 'NotFound' && err.$metadata?.httpStatusCode !== 404) {
      console.error('❌ MinIO connection failed:', err.message);
      process.exit(1);
    }
  }
  console.log('✅ MinIO connected\n');

  // Scan covers
  if (!await fs.pathExists(COVERS_DIR)) {
    console.log('❌ Covers directory not found:', COVERS_DIR);
    process.exit(1);
  }

  const files = await fs.readdir(COVERS_DIR);
  const webpFiles = files.filter(f => f.endsWith('.webp'));
  
  console.log(`📁 Found ${webpFiles.length} cover files\n`);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  let totalSize = 0;

  for (const file of webpFiles) {
    const key = `covers/${file}`;
    const localPath = path.join(COVERS_DIR, file);
    
    try {
      // Check if exists in MinIO
      try {
        await s3.send(new HeadObjectCommand({
          Bucket: config.coversBucket,
          Key: key,
        }));
        skipped++;
        continue;
      } catch (err) {
        // Not found, proceed to upload
      }

      const buffer = await fs.readFile(localPath);
      const stat = await fs.stat(localPath);
      
      await s3.send(new PutObjectCommand({
        Bucket: config.coversBucket,
        Key: key,
        Body: buffer,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000',
      }));

      uploaded++;
      totalSize += stat.size;
      
      if (uploaded % 50 === 0) {
        console.log(`   📤 Uploaded ${uploaded} files...`);
      }
    } catch (err) {
      console.error(`   ❌ Failed: ${file} - ${err.message}`);
      failed++;
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                        Summary');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`   Total files:  ${webpFiles.length}`);
  console.log(`   Uploaded:     ${uploaded} (${(totalSize / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`   Skipped:      ${skipped}`);
  console.log(`   Failed:       ${failed}`);
  console.log('\n✅ Migration complete!\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
