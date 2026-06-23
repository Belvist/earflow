/**
 * Track Processor - автоматическая обработка аудиофайлов
 * Извлекает метаданные, создает обложки, сохраняет в БД
 */

const fs = require('fs-extra');
const path = require('path');
const http = require('http');
const sharp = require('sharp');
const chokidar = require('chokidar');
const axios = require('axios');
const crypto = require('crypto');
const { execFile } = require('child_process');
const util = require('util');
const execFilePromise = util.promisify(execFile);
let iconv = null;
try {
  iconv = require('iconv-lite');
} catch {
  iconv = null;
}

// MinIO storage for covers
const minioStorage = require('./lib/minio-storage');

const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || '3015', 10);
const START_TIME = Date.now();

function sanitizeUrlForLogs(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''), 'http://localhost');
    for (const key of [...url.searchParams.keys()]) {
      const lower = key.toLowerCase();
      if (lower === 'token' || lower.includes('token') || lower.includes('authorization') || lower.includes('password') || lower.includes('secret')) {
        url.searchParams.set(key, '[REDACTED]');
      }
    }
    return url.pathname + (url.search ? url.search : '');
  } catch {
    return String(rawUrl || '').replace(/([?&]token=)[^&]+/gi, '$1[REDACTED]');
  }
}

function formatErrorForLogs(error) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  const status = error && typeof error === 'object' ? (error.response && error.response.status ? error.response.status : null) : null;
  const method = error && typeof error === 'object' ? (error.config && error.config.method ? String(error.config.method).toUpperCase() : null) : null;
  const url = error && typeof error === 'object' ? (error.config && error.config.url ? sanitizeUrlForLogs(error.config.url) : null) : null;
  const parts = [];
  if (method && url) parts.push(`${method} ${url}`);
  if (status) parts.push(`status=${status}`);
  return { message, context: parts.length ? parts.join(' ') : null };
}

class TrackProcessor {
  constructor() {
    this.uploadDir = process.env.UPLOAD_DIR || '/app/uploads';
    this.coversDir = path.join(this.uploadDir, 'covers');
    this.processedFile = path.join(this.uploadDir, '.processed');
    this.apiUrl = process.env.DB_SERVICE_URL || process.env.API_URL || 'http://localhost:3003';
    this.serviceKey = process.env.SERVICE_KEY_TRACK_PROCESSOR;
    this.mm = null; // Will be initialized with dynamic import
    this.sourceFolder = process.env.SOURCE_FOLDER || path.join(this.uploadDir, 'library');
    this.albumCoverCache = new Map();
    this.minioEnabled = false;
    this.dbServiceToken = null;
    this.dbServiceTokenExpiresAtMs = 0;
    this.dbServiceTokenRequestPromise = null;
    this.dbServiceTokenBackoffUntilMs = 0;

    // Создаем папку для обложек (локальный fallback)
    fs.ensureDirSync(this.coversDir);

    // Загружаем список уже обработанных файлов
    this.processedFiles = this.loadProcessedFiles();

    console.log('🎵 Track Processor запущен');
    console.log(`📁 Upload directory: ${this.uploadDir}`);
    console.log(`📚 Library directory: ${this.sourceFolder}`);
    console.log(`🖼️ Covers directory: ${this.coversDir}`);
    console.log(`📋 Processed files: ${this.processedFiles.size}`);
  }

  getAudioContentType(filePath) {
    const ext = path.extname(filePath || '').toLowerCase();
    const map = {
      '.flac': 'audio/flac',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.m4a': 'audio/mp4',
      '.ogg': 'audio/ogg'
    };
    return map[ext] || 'application/octet-stream';
  }

  getAudioObjectKey(filePath) {
    let relativePath = path.relative(this.uploadDir, filePath);
    relativePath = relativePath.split(path.sep).join('/');
    relativePath = relativePath.replace(/^\/+/, '');
    return `audio/${relativePath}`;
  }

  async ensureAudioInMinio(filePath) {
    if (!this.minioEnabled) {
      return false;
    }

    const objectKey = this.getAudioObjectKey(filePath);

    try {
      const exists = await minioStorage.audioExists(objectKey);
      if (exists) {
        return true;
      }

      const contentType = this.getAudioContentType(filePath);
      await minioStorage.uploadAudioFromPath(filePath, objectKey, contentType);
      return true;
    } catch (err) {
      console.warn(`⚠️ Failed to ensure audio in MinIO (${path.basename(filePath)}):`, err.message || err);
      return false;
    }
  }

  async initializeMinIO() {
    try {
      this.minioEnabled = await minioStorage.initialize();
      const status = minioStorage.getStatus();
      console.log(`📦 MinIO: ${status.available ? 'connected' : 'unavailable'} (mode: ${status.mode})`);
    } catch (err) {
      console.warn('⚠️ MinIO init failed:', err.message);
      this.minioEnabled = false;
    }
  }

  loadProcessedFiles() {
    try {
      if (fs.existsSync(this.processedFile)) {
        const data = fs.readFileSync(this.processedFile, 'utf8');
        return new Set(data.split('\n').filter(Boolean));
      }
    } catch (error) {
      const info = formatErrorForLogs(error);
      console.error('Ошибка загрузки списка обработанных файлов:', info.message);
    }
    return new Set();
  }

  saveProcessedFile(filename) {
    try {
      this.processedFiles.add(filename);
      fs.appendFileSync(this.processedFile, filename + '\n');
    } catch (error) {
      const info = formatErrorForLogs(error);
      console.error('Ошибка сохранения в список обработанных:', info.message);
    }
  }

  getAlbumKey(trackData) {
    if (!trackData) return null;

    const artist = (trackData.artist || '').toString().toLowerCase().trim();
    const album = (trackData.album || '').toString().toLowerCase().trim();

    if (!artist && !album) {
      return null;
    }

    return `${artist}::${album}`;
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  parseJwtExpMs(token) {
    try {
      if (!token) return 0;
      const parts = String(token).split('.');
      if (parts.length < 2) return 0;
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (!payload || typeof payload.exp !== 'number') return 0;
      return payload.exp * 1000;
    } catch {
      return 0;
    }
  }

  isTokenValid(token, expiresAtMs) {
    const now = Date.now();
    const effectiveExpiry = Number.isFinite(expiresAtMs) && expiresAtMs > 0
      ? expiresAtMs
      : this.parseJwtExpMs(token);
    return !!token && effectiveExpiry - now > 60_000;
  }

  async getDbToken() {
    if (this.isTokenValid(this.dbServiceToken, this.dbServiceTokenExpiresAtMs)) {
      return this.dbServiceToken;
    }

    if (!this.serviceKey) {
      const err = new Error('SERVICE_KEY_TRACK_PROCESSOR is not set');
      err.code = 'SERVICE_KEY_TRACK_PROCESSOR_MISSING';
      throw err;
    }

    if (this.dbServiceTokenRequestPromise) {
      return this.dbServiceTokenRequestPromise;
    }

    const now = Date.now();
    if (this.dbServiceTokenBackoffUntilMs > now) {
      await this.delay(this.dbServiceTokenBackoffUntilMs - now);
      if (this.isTokenValid(this.dbServiceToken, this.dbServiceTokenExpiresAtMs)) {
        return this.dbServiceToken;
      }
    }

    this.dbServiceTokenRequestPromise = (async () => {
      try {
        const response = await axios.post(`${this.apiUrl}/auth/service-token`, {
          serviceName: 'track-processor',
          serviceKey: this.serviceKey
        });

        const token = response?.data?.token || null;
        const expiresAtIso = response?.data?.expiresAt || null;
        const expiresAtMs = expiresAtIso ? Date.parse(expiresAtIso) : 0;

        this.dbServiceToken = token;
        this.dbServiceTokenExpiresAtMs = Number.isFinite(expiresAtMs) ? expiresAtMs : 0;
        this.dbServiceTokenBackoffUntilMs = 0;

        if (!this.isTokenValid(this.dbServiceToken, this.dbServiceTokenExpiresAtMs)) {
          const decodedExpMs = this.parseJwtExpMs(this.dbServiceToken);
          this.dbServiceTokenExpiresAtMs = decodedExpMs;
        }

        if (!this.dbServiceToken) {
          const err = new Error('DB service token response is missing token');
          err.code = 'DB_SERVICE_TOKEN_MISSING';
          throw err;
        }

        return this.dbServiceToken;
      } catch (error) {
        const status = error?.response?.status;
        if (status === 429) {
          const retryAfterHeader = error?.response?.headers?.['retry-after'];
          const retryAfterSeconds = Number.parseInt(String(retryAfterHeader || ''), 10);
          const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? retryAfterSeconds * 1000
            : 15 * 60 * 1000;

          this.dbServiceTokenBackoffUntilMs = Date.now() + retryAfterMs;
        }

        console.error('❌ Ошибка получения токена DB:', error.message);
        throw error;
      } finally {
        this.dbServiceTokenRequestPromise = null;
      }
    })();

    return this.dbServiceTokenRequestPromise;
  }

  async extractCoverArtWithFfmpeg(audioPath) {
    const tempCoverPath = path.join(this.uploadDir, `temp_cover_${crypto.randomBytes(4).toString('hex')}.jpg`);
    try {
      // Пытаемся извлечь обложку с помощью ffmpeg с таймаутом 30с
      await execFilePromise('ffmpeg', ['-y', '-i', audioPath, '-an', '-vcodec', 'copy', tempCoverPath], { timeout: 30000 });

      if (await fs.pathExists(tempCoverPath)) {
        const stats = await fs.stat(tempCoverPath);
        if (stats.size > 0) {
          const buffer = await fs.readFile(tempCoverPath);
          await fs.remove(tempCoverPath);
          return buffer;
        }
      }
    } catch (error) {
      // Игнорируем ошибки ffmpeg, так как это fallback
    } finally {
      if (await fs.pathExists(tempCoverPath)) {
        await fs.remove(tempCoverPath).catch(() => { });
      }
    }
    return null;
  }

  async extractCoverArt(audioPath, outputPath) {
    try {
      let pictureData = null;

      // 1. Пробуем music-metadata
      try {
        const metadata = await this.mm.parseFile(audioPath);
        if (metadata.common.picture && metadata.common.picture.length > 0) {
          pictureData = metadata.common.picture[0].data;
        }
      } catch (err) {
        console.warn(`⚠️ music-metadata не справился с обложкой (${path.basename(audioPath)}), пробуем ffmpeg...`);
      }

      // 2. Если не вышло, пробуем ffmpeg
      if (!pictureData) {
        pictureData = await this.extractCoverArtWithFfmpeg(audioPath);
      }

      // 3. Если всё ещё нет — пробуем внешние файлы обложек в папке трека
      if (!pictureData) {
        const dir = path.dirname(audioPath);
        const baseName = path.basename(audioPath, path.extname(audioPath));
        const candidates = [
          `${baseName}.jpg`, `${baseName}.jpeg`, `${baseName}.png`, `${baseName}.webp`,
          'cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp',
          'folder.jpg', 'folder.png', 'front.jpg', 'album.jpg'
        ];

        for (const name of candidates) {
          const candidatePath = path.join(dir, name);
          if (await fs.pathExists(candidatePath)) {
            try {
              pictureData = await fs.readFile(candidatePath);
              break;
            } catch (e) { }
          }
        }
      }

      if (!pictureData) {
        return null;
      }

      // Создаем различные размеры обложек
      const sizes = [
        { suffix: '_small', width: 150, height: 188 },
        { suffix: '_medium', width: 280, height: 350 },
        { suffix: '_large', width: 400, height: 500 }
      ];

      const coverPaths = {};

      for (const size of sizes) {
        const coverFilename = path.basename(outputPath).replace('.jpg', `${size.suffix}.webp`);
        const coverPath = outputPath.replace('.jpg', `${size.suffix}.webp`);

        if (this.minioEnabled) {
          const existsInMinio = await minioStorage.coverExists(coverFilename);
          if (existsInMinio) {
            coverPaths[size.suffix.substring(1)] = `covers/${coverFilename}`;
            continue;
          }
        } else if (fs.existsSync(coverPath)) {
          coverPaths[size.suffix.substring(1)] = `covers/${coverFilename}`;
          continue;
        }

        const coverBuffer = await sharp(pictureData)
          .resize(size.width, size.height, { fit: 'cover', position: 'center' })
          .webp({ quality: 85, effort: 6 })
          .toBuffer();

        if (this.minioEnabled) {
          await minioStorage.uploadCover(coverBuffer, coverFilename);
        }

        await fs.writeFile(coverPath, coverBuffer);
        coverPaths[size.suffix.substring(1)] = `covers/${coverFilename}`;
      }

      return coverPaths;
    } catch (error) {
      const info = formatErrorForLogs(error);
      console.error('Ошибка извлечения обложки:', info.message);
      return null;
    }
  }

  async extractMetadataWithFfmpeg(filePath) {
    try {
      // Используем ffprobe с таймаутом 30с
      const { stdout } = await execFilePromise('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', filePath], { timeout: 30000 });
      const data = JSON.parse(stdout);
      return data.format?.tags || {};
    } catch (error) {
      const info = formatErrorForLogs(error);
      console.error(`Ошибка ffprobe для ${path.basename(filePath)}:`, info.message);
      return {};
    }
  }

  async extractMetadata(filePath) {
    const scoreDecodedText = (text) => {
      const s = (text || '').toString();
      if (!s) return -1e9;
      const len = s.length;
      const replacementCount = (s.match(/\uFFFD/g) || []).length;
      const controlCount = (s.match(/[\u0000-\u001F\u007F]/g) || []).length;
      let letters = 0;
      try {
        letters = (s.match(/\p{L}/gu) || []).length;
      } catch {
        letters = 0;
      }
      const printableRatio = Math.max(0, (len - replacementCount - controlCount) / Math.max(1, len));
      return printableRatio * 100 + Math.min(letters, 20) - replacementCount * 50 - controlCount * 10;
    };

    const pickBestDecoded = (candidates) => {
      let best = null;
      let bestScore = -1e9;
      for (const c of candidates) {
        const score = scoreDecodedText(c);
        if (score > bestScore) {
          best = c;
          bestScore = score;
        }
      }
      return best;
    };

    const decodePossiblyMojibake = (value) => {
      if (value === null || value === undefined) return '';
      if (Buffer.isBuffer(value)) {
        const buf = value;
        const candidates = [];
        try { candidates.push(buf.toString('utf8')); } catch { }
        if (iconv) {
          try { candidates.push(iconv.decode(buf, 'win1251')); } catch { }
          try { candidates.push(iconv.decode(buf, 'latin1')); } catch { }
          try { candidates.push(iconv.decode(buf, 'utf16le')); } catch { }
        }
        const best = pickBestDecoded(candidates);
        return (best || '').normalize('NFC');
      }
      const s = String(value);
      const candidates = [s];
      try { candidates.push(Buffer.from(s, 'latin1').toString('utf8')); } catch { }
      if (iconv) {
        try { candidates.push(iconv.decode(Buffer.from(s, 'latin1'), 'win1251')); } catch { }
      }
      try {
        candidates.push(Buffer.from(Buffer.from(s, 'utf8').toString('latin1'), 'latin1').toString('utf8'));
      } catch { }
      const best = pickBestDecoded(candidates);
      return (best || '').normalize('NFC');
    };

    const cleanText = (text) => {
      if (text === null || text === undefined) return null;
      const decoded = decodePossiblyMojibake(text);
      const cleaned = decoded.replace(/[\u0000-\u001F\u007F]/g, '').trim();
      return cleaned ? cleaned : null;
    };

    const parseYear = (rawYear, rawDate) => {
      if (typeof rawYear === 'number' && Number.isFinite(rawYear)) {
        if (rawYear >= 0 && rawYear <= 3000) return rawYear;
      }
      const dateCandidate = cleanText(rawDate) || cleanText(rawYear);
      if (!dateCandidate) return null;
      const m = dateCandidate.match(/(\d{4})/);
      if (!m) return null;
      const y = parseInt(m[1], 10);
      if (!Number.isFinite(y) || y < 0 || y > 3000) return null;
      return y;
    };

    const fileName = path.basename(filePath, path.extname(filePath));

    const parseFromFileName = () => {
      const result = { artistFromName: null, titleFromName: null, albumFromName: null };
      if (!fileName) return result;
      const parts = fileName.split(' - ');
      if (parts.length === 0) return result;
      const artistPart = cleanText(parts[0]);
      const rightPartRaw = parts.length > 1 ? parts.slice(1).join(' - ') : null;
      let titleFromName = null;
      let albumFromName = null;
      if (rightPartRaw) {
        const tokens = rightPartRaw.split(/\s+/).filter(Boolean);
        let removedNumeric = 0;
        while (tokens.length > 0 && removedNumeric < 2) {
          const last = tokens[tokens.length - 1];
          if (/^(\d+)$/.test(last)) {
            tokens.pop();
            removedNumeric += 1;
          } else break;
        }
        let titleTokens = tokens;
        let albumTokens = [];
        if (tokens.length > 2) {
          const isAllUpper = (s) => (/[A-ZА-ЯЁ]/.test(s) && !/[a-zа-яё]/.test(s));
          const last = tokens[tokens.length - 1];
          const secondLast = tokens[tokens.length - 2];
          if (isAllUpper(last) && isAllUpper(secondLast)) {
            albumTokens = [secondLast, last];
            titleTokens = tokens.slice(0, -2);
          } else if (isAllUpper(last)) {
            albumTokens = [last];
            titleTokens = tokens.slice(0, -1);
          }
        }
        if (titleTokens.length === 0 && tokens.length > 0) {
          titleTokens = tokens;
          albumTokens = [];
        }
        titleFromName = cleanText(titleTokens.join(' '));
        albumFromName = cleanText(albumTokens.join(' '));
      }
      result.artistFromName = artistPart || null;
      result.titleFromName = titleFromName || null;
      result.albumFromName = albumFromName || null;
      return result;
    };

    const { artistFromName, titleFromName, albumFromName } = parseFromFileName();

    let common = {};
    let format = {};
    let useFfmpeg = false;

    try {
      const metadata = await this.mm.parseFile(filePath);
      common = metadata.common || {};
      format = metadata.format || {};
    } catch (error) {
      useFfmpeg = true;
    }

    if (useFfmpeg) {
      const tags = await this.extractMetadataWithFfmpeg(filePath);
      common = {
        title: tags.title || tags.TITLE || null,
        artist: tags.artist || tags.ARTIST || null,
        album: tags.album || tags.ALBUM || null,
        date: tags.date || tags.DATE || tags.year || tags.YEAR || null,
        genre: tags.genre ? [tags.genre] : (tags.GENRE ? [tags.GENRE] : null)
      };
      if (!format.duration) {
        try {
          const { stdout } = await execFilePromise('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', filePath], { timeout: 30000 });
          const data = JSON.parse(stdout);
          if (data.format && data.format.duration) {
            format.duration = parseFloat(data.format.duration);
          }
        } catch (e) {
          console.warn(`⚠️ ffprobe duration fallback failed for ${path.basename(filePath)}:`, e.message || e);
        }
      }
    }

    let title = cleanText(common.title) || titleFromName || 'Unknown Title';
    let artist = cleanText(common.artist || common.albumartist) || artistFromName || 'Unknown Artist';
    let relativePath = path.relative(this.uploadDir, filePath).split(path.sep).join('/').replace(/^\/+/, '');

    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = { '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg' };
    const mimeType = mimeMap[ext] || 'audio/mpeg';

    return {
      title, artist,
      album: cleanText(common.album) || albumFromName || 'Unknown Album',
      year: parseYear(common.year, common.date || common.originaldate || common.releasedate),
      genre: cleanText(Array.isArray(common.genre) ? common.genre[0] : common.genre) || null,
      duration: Math.round(format.duration || 0),
      file_path: relativePath,
      file_size: fs.statSync(filePath).size,
      mime_type: mimeType,
      user_id: 1
    };
  }

  getQualityScore(filePath, fileSize, duration) {
    const ext = path.extname(filePath || '').toLowerCase();
    const extBaseScores = { '.flac': 500, '.wav': 450, '.m4a': 400, '.ogg': 350, '.mp3': 300 };
    const base = extBaseScores[ext] || 200;
    let bitrateScore = 0;
    if (duration && fileSize && duration > 0) {
      const bitrateKbps = (fileSize * 8) / duration / 1000;
      if (Number.isFinite(bitrateKbps) && bitrateKbps > 0) {
        bitrateScore = Math.min(bitrateKbps, 1000);
      }
    }
    return base + bitrateScore;
  }

  async findExistingSong(trackData, token) {
    const { title, artist, user_id, duration } = trackData;
    if (!title || !artist) return null;
    try {
      const response = await axios.get(`${this.apiUrl}/api/songs/lookup`, {
        params: { title, artist, userId: user_id },
        headers: { 'X-Service-Token': token }
      });
      const candidates = Array.isArray(response.data) ? response.data : [];
      if (candidates.length === 0) return null;
      let filtered = candidates;
      if (duration && duration > 0) {
        filtered = candidates.filter((c) => Math.abs((c.duration || 0) - duration) <= 3);
        if (filtered.length === 0) filtered = candidates;
      }
      let best = null;
      let bestScore = -Infinity;
      for (const candidate of filtered) {
        const score = this.getQualityScore(candidate.file_path, candidate.file_size, candidate.duration);
        if (score > bestScore) {
          best = candidate;
          bestScore = score;
        }
      }
      return best;
    } catch (error) {
      console.error('Ошибка поиска существующего трека:', error.message);
      return null;
    }
  }

  async saveToDatabase(trackData, coverPaths) {
    try {
      const token = await this.getDbToken();
      const albumKey = this.getAlbumKey(trackData);
      let finalCoverPath = trackData.cover_path || coverPaths?.medium || (albumKey ? this.albumCoverCache.get(albumKey) : null) || null;
      if (finalCoverPath) trackData.cover_path = finalCoverPath;

      const existing = await this.findExistingSong(trackData, token);
      const newScore = this.getQualityScore(trackData.file_path, trackData.file_size, trackData.duration);

      if (existing) {
        const existingScore = this.getQualityScore(existing.file_path, existing.file_size, existing.duration);
        const hasNewCover = !existing.cover_path && trackData.cover_path;
        if (newScore <= existingScore && !hasNewCover) return null;

        const response = await axios.put(`${this.apiUrl}/api/songs/${existing.id}`, {
          ...trackData,
          cover_path: trackData.cover_path || existing.cover_path || null
        }, {
          headers: { 'X-Service-Token': token, 'Content-Type': 'application/json' }
        });
        if (albumKey && trackData.cover_path) this.albumCoverCache.set(albumKey, trackData.cover_path);
        return response.data;
      }

      const response = await axios.post(`${this.apiUrl}/api/songs`, trackData, {
        headers: { 'X-Service-Token': token, 'Content-Type': 'application/json' }
      });
      if (albumKey && trackData.cover_path) this.albumCoverCache.set(albumKey, trackData.cover_path);
      return response.data;
    } catch (error) {
      if (error.response?.status === 409) return null;
      console.error('Ошибка сохранения в БД:', error.message);
      throw error;
    }
  }

  async processTrack(filePath) {
    try {
      const fileId = crypto.createHash('md5').update(filePath).digest('hex');
      await this.ensureAudioInMinio(filePath);
      if (this.processedFiles.has(fileId)) return;
      const trackData = await this.extractMetadata(filePath);
      if (!trackData) return;
      const coverBaseName = crypto.createHash('md5').update(filePath + trackData.file_size).digest('hex');
      const coverPath = path.join(this.coversDir, `${coverBaseName}.jpg`);
      const coverPaths = await this.extractCoverArt(filePath, coverPath);
      await this.saveToDatabase(trackData, coverPaths);
      this.saveProcessedFile(fileId);
      processorStats.tracksProcessed++;
      processorStats.lastProcessedAt = new Date().toISOString();
    } catch (error) {
      const info = formatErrorForLogs(error);
      const ctx = info.context ? ` (${info.context})` : '';
      console.error(`❌ Ошибка обработки ${filePath}: ${info.message}${ctx}`);
      processorStats.errors++;
    }
  }

  async scanDirectory(dir) {
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) await this.scanDirectory(fullPath);
        else if (/\.(mp3|wav|flac|m4a|ogg)$/i.test(file)) await this.processTrack(fullPath);
      }
    } catch (error) {
      const info = formatErrorForLogs(error);
      console.error(`Ошибка сканирования ${dir}: ${info.message}`);
    }
  }

  async start() {
    console.log('🚀 Запуск Track Processor...\n');
    try {
      const mmModule = await import('music-metadata');
      this.mm = mmModule;
      await this.initializeMinIO();
      if (fs.existsSync(this.sourceFolder)) {
        console.log('🔍 Сканирование библиотеки...');
        processorStats.isScanning = true;
        await this.scanDirectory(this.sourceFolder);
        processorStats.isScanning = false;
        console.log('✅ Сканирование завершено');
      }
      this.startWatching();
    } catch (error) {
      const info = formatErrorForLogs(error);
      console.error(`❌ Ошибка запуска: ${info.message}`);
      process.exit(1);
    }
  }

  startWatching() {
    chokidar.watch(this.sourceFolder, {
      ignored: [/(^|[\/\\])\../, '*.txt', '*.log', '*.jpg', '*.png', '*.webp'],
      persistent: true, ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 }
    }).on('add', (filePath) => {
      if (/\.(mp3|wav|flac|m4a|ogg)$/i.test(filePath)) this.processTrack(filePath);
    });
  }
}

let processorStats = { tracksProcessed: 0, lastProcessedAt: null, isScanning: false, errors: 0 };

function startHealthServer() {
  http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'healthy', service: 'track-processor', uptime: (Date.now() - START_TIME) / 1000, stats: processorStats }));
    } else if (req.url === '/metrics') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`track_processor_tracks_processed ${processorStats.tracksProcessed}\ntrack_processor_errors ${processorStats.errors}\n`);
    } else { res.writeHead(404); res.end(); }
  }).listen(HEALTH_PORT, () => console.log(`📊 Health server started on port ${HEALTH_PORT}`));
}

const processor = new TrackProcessor();
startHealthServer();
processor.start();
module.exports = { TrackProcessor, processorStats };
