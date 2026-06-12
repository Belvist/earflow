import {
  buildMusicSeoMeta,
  buildMusicSeoPath,
  getMusicSeoSitemapEntries,
  getMusicTopicBySlug,
  getMusicIntentBySlug,
} from './musicSeoCatalog';

describe('musicSeoCatalog', () => {
  test('resolves whitelisted music topics and intent pages', () => {
    expect(getMusicTopicBySlug('rock')?.name).toBe('рок');
    expect(getMusicIntentBySlug('slushat-online')?.label).toBe('Слушать онлайн');
    expect(buildMusicSeoPath('rock', 'slushat-online')).toBe('/music/rock/slushat-online');
  });

  test('marks unknown generated-looking routes as noindex', () => {
    const meta = buildMusicSeoMeta({ topicSlug: 'random-word', intentSlug: 'slushat-online' });
    expect(meta.invalid).toBe(true);
    expect(meta.robots).toBe('noindex,nofollow');
    expect(meta.canonicalPath).toBe('/music');
  });

  test('sitemap entries are controlled by the catalog whitelist', () => {
    const entries = getMusicSeoSitemapEntries();
    expect(entries.length).toBeGreaterThan(400);
    expect(entries.some((entry) => entry.path === '/music/rock')).toBe(true);
    expect(entries.some((entry) => entry.path === '/music/rock/slushat-online')).toBe(true);
    expect(entries.some((entry) => entry.path.includes('random-word'))).toBe(false);
  });
});
