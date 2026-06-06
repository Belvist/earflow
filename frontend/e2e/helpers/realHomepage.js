/**
 * Shared harness для e2e тестов на РЕАЛЬНОЙ главной странице (/).
 *
 * Поднимает настоящий App с реальными PlayerProvider/AuthProvider и мокает
 * только сетевой слой (/api/**, /covers/**). В отличие от playground это
 * проверяет полный путь: рекомендации -> очередь -> mini-bar -> full player.
 *
 * Параметры:
 *   trackCount        — сколько треков вернёт /api/songs (для длинной очереди).
 *   deviceSyncEnabled — включить device sync (для теста device bottom-sheet).
 *   user              — авторизованный пользователь.
 */
const { expect } = require('@playwright/test');

const SELECTORS = {
  MINI_BAR: '[data-testid="mini-player-bar"]',
  MODAL: '[data-testid="mobile-player-modal"]',
  HOME_ROOT: '[data-testid="home-player-root"]',
  HOME_COVER: '[data-testid="home-cover-top"]',
  HOME_DESKTOP_LAYOUT: '[data-testid="home-desktop-layout-v3"]',
  HOME_DESKTOP_HERO: '[data-testid="home-desktop-hero-v3"]',
  HOME_MOBILE_LAYOUT: '[data-testid="home-mobile-layout-v3"]',
  HOME_MOBILE_HERO: '[data-testid="home-mobile-hero-v3"]',
  HOME_FOR_YOU_ROW: '[data-testid="home-for-you-row"]',
  HOME_FOR_YOU_LIST: '[data-testid="home-for-you-list"]',
  HOME_TITLE: '[data-testid="home-track-title"]',
  GLOBAL_BAR: '[data-testid="global-player-bar"]',
  PLAYLIST_CARD: '[data-testid="home-playlist-card"]',
  PLAYLIST_RAIL: '[data-testid="home-playlist-rail"]',
};

const DEFAULT_USER = { id: 777, userId: 777, username: 'e2e-homepage' };

function makeTracks(count) {
  const safeCount = Math.max(1, Number(count) || 1);
  return Array.from({ length: safeCount }, (_, index) => ({
    id: index + 1,
    title: `E2E Главная ${index + 1}`,
    artist: 'Earflow Test Artist',
    album: 'Real Homepage',
    duration: 184 + index,
    cover_path: `e2e-cover-${index + 1}.svg`,
    updated_at: '2026-05-28T00:00:00Z',
  }));
}

const playlistTracks = (railIndex, playlistIndex) => Array.from({ length: 5 }, (_, trackIndex) => ({
  id: 10_000 + (railIndex * 100) + (playlistIndex * 10) + trackIndex,
  title: `Плейлист ${railIndex + 1}.${playlistIndex + 1} трек ${trackIndex + 1}`,
  artist: 'Earflow Playlist Artist',
  album: 'Real Homepage Playlists',
  duration: 190 + trackIndex,
  cover_path: `e2e-playlist-track-${railIndex + 1}-${playlistIndex + 1}-${trackIndex + 1}.svg`,
  updated_at: '2026-05-28T00:00:00Z',
}));

const discoverRails = {
  rails: Array.from({ length: 4 }, (_, railIndex) => ({
    id: `rail-${railIndex + 1}`,
    title: `E2E подборка ${railIndex + 1}`,
    playlists: Array.from({ length: 10 }, (_, playlistIndex) => ({
      id: `${railIndex + 1}-${playlistIndex + 1}`,
      title: `Плейлист ${railIndex + 1}.${playlistIndex + 1}`,
      name: `Плейлист ${railIndex + 1}.${playlistIndex + 1}`,
      track_count: 12,
      cover_path: `e2e-playlist-${railIndex + 1}-${playlistIndex + 1}.svg`,
      tracks: playlistTracks(railIndex, playlistIndex),
    })),
  })),
};

const json = (data, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(data),
});

async function mockRealHomepageApi(page, opts = {}) {
  const user = opts.user || DEFAULT_USER;
  const trackCount = Number.isFinite(opts.trackCount) ? opts.trackCount : 8;
  const deviceSyncEnabled = opts.deviceSyncEnabled ? 'true' : 'false';
  const tracks = makeTracks(trackCount);

  await page.addInitScript((init) => {
    window.__EARFLOW_RUNTIME_CONFIG__ = {
      ...(window.__EARFLOW_RUNTIME_CONFIG__ || {}),
      apiBaseUrl: window.location.origin,
      streamingBaseUrl: window.location.origin,
      deviceSyncEnabled: init.deviceSyncEnabled,
    };
    localStorage.setItem('user', JSON.stringify(init.user));
    localStorage.setItem('userId', String(init.user.id));
  }, { user, deviceSyncEnabled });

  await page.route('**/covers/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="640"><rect width="512" height="640" fill="#151515"/><circle cx="256" cy="260" r="150" fill="#1db954"/><rect x="96" y="450" width="320" height="36" rx="18" fill="#ffffff" opacity="0.9"/></svg>',
    });
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === '/api/auth/csrf') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'Set-Cookie': 'mp_csrf=e2e-csrf-token; Path=/; SameSite=Lax',
        },
        body: JSON.stringify({ csrfToken: 'e2e-csrf-token' }),
      });
      return;
    }
    if (path === '/api/auth/device/register') {
      await route.fulfill(json({ ok: true, sidHash: 'e2e-sid-hash' }));
      return;
    }
    if (path === '/api/profile' || path === '/api/auth/profile') {
      await route.fulfill(json(user));
      return;
    }
    if (path === '/api/songs') {
      await route.fulfill(json(tracks));
      return;
    }
    const waveformMatch = path.match(/^\/api\/songs\/(\d+)\/waveform$/);
    if (waveformMatch) {
      const songId = Number(waveformMatch[1]);
      const peaks = Array.from({ length: 128 }, (_, index) => (
        0.22 + 0.68 * Math.abs(Math.sin((index + songId) / 7))
      ));
      await route.fulfill(json({
        songId,
        status: 'ready',
        bars: peaks.length,
        peaks,
      }));
      return;
    }
    if (path === '/api/recommendations/init' || path === '/api/recommendations/refresh') {
      await route.fulfill(json({ sessionId: 'e2e-homepage-session', tracks, hasMore: true, recommendationMeta: { mode: 'personalized', profileStrength: 1 } }));
      return;
    }
    if (path === '/api/recommendations/feedback' || path === '/api/recommendations/batch-complete') {
      await route.fulfill(json({ ok: true }));
      return;
    }
    if (path === '/api/recommendations/next' || path === '/api/recommendations/infinite') {
      await route.fulfill(json({ tracks, hasMore: true }));
      return;
    }
    if (path === '/api/likes' || path === '/api/dislikes') {
      await route.fulfill(json([]));
      return;
    }
    if (path === '/api/playlists') {
      await route.fulfill(json({ playlists: [] }));
      return;
    }
    if (path === '/api/playlists/discover') {
      await route.fulfill(json(discoverRails));
      return;
    }
    if (path === '/api/artists/popular') {
      await route.fulfill(json({ items: [] }));
      return;
    }
    if (path === '/api/devices/register') {
      await route.fulfill(json({ deviceId: 'e2e-device', ticket: '', wsTicket: '' }));
      return;
    }
    if (path === '/api/devices' || path === '/api/devices/now-playing') {
      await route.fulfill(json({ devices: [], nowPlaying: null }));
      return;
    }
    if (path === '/api/devices/heartbeat') {
      await route.fulfill(json({ ok: true }));
      return;
    }
    if (path === '/api/log/error') {
      await route.fulfill(json({ ok: true }));
      return;
    }

    await route.fulfill(json({ ok: true }));
  });

  return { tracks, user };
}

async function openRealHomepage(page, opts = {}) {
  const ctx = await mockRealHomepageApi(page, opts);
  await seedCookieConsent(page);
  await page.goto('/');
  await acceptCookiesIfVisible(page);
  await expect(page.locator(SELECTORS.HOME_ROOT)).toBeVisible({ timeout: 12_000 });
  await expect(page.locator(SELECTORS.HOME_COVER)).toBeVisible({ timeout: 12_000 });
  await expect.poll(async () => (await page.locator(SELECTORS.HOME_TITLE).textContent())?.trim() || '', {
    timeout: 8_000,
  }).toBe('E2E Главная 1');
  return ctx;
}

const { acceptCookiesIfVisible, seedCookieConsent } = require('./cookies');

module.exports = {
  SELECTORS,
  ...SELECTORS,
  DEFAULT_USER,
  makeTracks,
  mockRealHomepageApi,
  acceptCookiesIfVisible,
  seedCookieConsent,
  openRealHomepage,
};
