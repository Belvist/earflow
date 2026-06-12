'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_BODY_LENGTH,
  decodeFeedCursor,
  encodeFeedCursor,
  formatCreatedAtLabel,
  mapSocialPostRow,
  normalizePostBody,
  validatePostInput,
} = require('./socialPosts');

test('normalizePostBody preserves post line breaks and trims noisy whitespace', () => {
  assert.equal(
    normalizePostBody('  Oil-backed\t narrative\r\n\r\n\r\n\r\nlimited   supply  '),
    'Oil-backed narrative\n\n\nlimited supply',
  );
});

test('validatePostInput rejects empty body and truncates long content', () => {
  const empty = validatePostInput({ body: '     ' });
  assert.equal(empty.ok, false);
  assert.equal(empty.code, 'SOCIAL_POST_BODY_REQUIRED');

  const long = validatePostInput({ body: 'a'.repeat(MAX_BODY_LENGTH + 20) });
  assert.equal(long.ok, true);
  assert.equal(long.body.length, MAX_BODY_LENGTH);
});

test('feed cursor round-trips as opaque token', () => {
  const cursor = encodeFeedCursor({ created_at: '2026-06-11T08:00:00.000Z', id: '42' });
  assert.ok(cursor);
  assert.deepEqual(decodeFeedCursor(cursor), {
    createdAt: '2026-06-11T08:00:00.000Z',
    id: '42',
  });
  assert.equal(decodeFeedCursor('not-json'), null);
});

test('mapSocialPostRow returns render-ready viewer and author fields', () => {
  const post = mapSocialPostRow({
    id: '7',
    title: 'Token drop',
    body: 'Oil-backed narrative',
    kind: 'text',
    created_at: '2026-06-11T07:59:00.000Z',
    updated_at: '2026-06-11T08:00:00.000Z',
    user_id: 3,
    author_display_name: 'Maduro Flow',
    author_username: 'maduro',
    avatar_url: 'https://cdn/avatar.webp',
    likes_count: '12',
    liked_by_me: true,
    can_delete: false,
  });

  assert.equal(post.id, '7');
  assert.equal(post.author.handle, '@maduro');
  assert.equal(post.author.initials, 'MF');
  assert.equal(post.metrics.likes, 12);
  assert.equal(Object.prototype.hasOwnProperty.call(post.metrics, 'comments'), false);
  assert.equal(post.viewer.liked, true);
  assert.equal(post.viewer.canDelete, false);
});

test('formatCreatedAtLabel is stable for relative labels', () => {
  assert.equal(
    formatCreatedAtLabel('2026-06-11T08:00:00.000Z', new Date('2026-06-11T08:00:30.000Z')),
    'только что',
  );
  assert.equal(
    formatCreatedAtLabel('2026-06-11T07:55:00.000Z', new Date('2026-06-11T08:00:00.000Z')),
    '5 минут назад',
  );
});
