'use strict';

const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 2000;
const MAX_FEED_LIMIT = 50;
const DEFAULT_FEED_LIMIT = 20;

function parsePositiveInt(value) {
  const s = value === undefined || value === null ? '' : String(value).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function parsePositiveBigIntString(value) {
  const s = value === undefined || value === null ? '' : String(value).trim();
  if (!/^\d+$/.test(s)) return null;
  try {
    const n = BigInt(s);
    return n > 0n ? s : null;
  } catch {
    return null;
  }
}

function truncateCodepoints(value, maxLen) {
  const chars = Array.from(value);
  if (chars.length <= maxLen) return value;
  return chars.slice(0, maxLen).join('');
}

function normalizeTitle(value) {
  if (value === undefined || value === null) return '';
  const compact = String(value)
    .normalize('NFC')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return truncateCodepoints(compact, MAX_TITLE_LENGTH);
}

function normalizePostBody(value) {
  if (value === undefined || value === null) return '';
  const normalized = String(value)
    .normalize('NFC')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  return truncateCodepoints(normalized, MAX_BODY_LENGTH);
}

function validatePostInput(input) {
  const src = input && typeof input === 'object' ? input : {};
  const title = normalizeTitle(src.title);
  const body = normalizePostBody(src.body);

  if (!body) {
    return {
      ok: false,
      status: 400,
      code: 'SOCIAL_POST_BODY_REQUIRED',
      error: 'Текст поста обязателен',
    };
  }

  return { ok: true, title, body };
}

function parseFeedLimit(value) {
  const n = parsePositiveInt(value);
  if (!n) return DEFAULT_FEED_LIMIT;
  return Math.min(n, MAX_FEED_LIMIT);
}

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function pluralRu(n, one, few, many) {
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function formatCreatedAtLabel(value, nowValue = new Date()) {
  const iso = toIso(value);
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const now = nowValue instanceof Date ? nowValue.getTime() : new Date(nowValue).getTime();
  if (!Number.isFinite(then) || !Number.isFinite(now)) return '';

  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 45) return 'только что';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} ${pluralRu(diffMin, 'минуту', 'минуты', 'минут')} назад`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} ${pluralRu(diffHour, 'час', 'часа', 'часов')} назад`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return 'вчера';
  if (diffDay < 7) return `${diffDay} ${pluralRu(diffDay, 'день', 'дня', 'дней')} назад`;

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

function initialsFromName(name) {
  const s = typeof name === 'string' ? name.normalize('NFC').trim() : '';
  if (!s) return 'EF';
  const parts = s.split(/\s+/g).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function mapSocialPostRow(row) {
  const r = row && typeof row === 'object' ? row : {};
  const displayName = String(r.author_display_name || '').trim() || 'Слушатель';
  const id = String(r.id || '');

  return {
    id,
    title: String(r.title || ''),
    body: String(r.body || ''),
    kind: String(r.kind || 'text'),
    createdAtLabel: formatCreatedAtLabel(r.created_at),
    author: {
      displayName,
      avatarUrl: r.avatar_url ? String(r.avatar_url) : null,
      initials: initialsFromName(displayName),
    },
    metrics: {
      likes: toCount(r.likes_count),
    },
    viewer: {
      liked: r.liked_by_me === true || r.liked_by_me === 't',
      canManage: r.can_manage === true || r.can_manage === 't' || r.can_delete === true || r.can_delete === 't',
    },
  };
}

function mapSocialReaction(postId, row, liked) {
  const r = row && typeof row === 'object' ? row : {};
  return {
    postId: String(postId || r.post_id || r.id || ''),
    liked: liked === true,
    likes: toCount(r.likes_count),
  };
}

function encodeFeedCursor(row) {
  if (!row) return null;
  const createdAt = toIso(row.created_at);
  const id = parsePositiveBigIntString(row.id);
  if (!createdAt || !id) return null;
  return Buffer.from(JSON.stringify([createdAt, id]), 'utf8').toString('base64url');
}

function decodeFeedCursor(raw) {
  const s = raw === undefined || raw === null ? '' : String(raw).trim();
  if (!s) return null;
  try {
    const parsed = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const createdAt = toIso(parsed[0]);
    const id = parsePositiveBigIntString(parsed[1]);
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

module.exports = {
  MAX_TITLE_LENGTH,
  MAX_BODY_LENGTH,
  MAX_FEED_LIMIT,
  DEFAULT_FEED_LIMIT,
  parsePositiveInt,
  parsePositiveBigIntString,
  normalizeTitle,
  normalizePostBody,
  validatePostInput,
  parseFeedLimit,
  mapSocialPostRow,
  mapSocialReaction,
  encodeFeedCursor,
  decodeFeedCursor,
  formatCreatedAtLabel,
};
