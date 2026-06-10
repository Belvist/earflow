import {
  MOBILE_NAV_TAB_ORDER,
  getNavTabIndex,
  normalizeNavTabForSwipe,
  pointerClientXToChipX,
  resolveAdjacentNavTab,
  resolveTabFromDragOffset,
  snapIndexFromChipX,
  snapTabFromChipX,
} from './mobileBottomNavTabs';

describe('mobileBottomNavTabs', () => {
  it('exposes stable tab order', () => {
    expect(MOBILE_NAV_TAB_ORDER).toEqual(['home', 'social', 'search', 'profile']);
  });

  it('swipe left (-1) moves to next tab', () => {
    expect(resolveAdjacentNavTab('home', -1)).toBe('social');
    expect(resolveAdjacentNavTab('social', -1)).toBe('search');
    expect(resolveAdjacentNavTab('search', -1)).toBe('profile');
    expect(resolveAdjacentNavTab('profile', -1)).toBeNull();
  });

  it('swipe right (1) moves to previous tab', () => {
    expect(resolveAdjacentNavTab('profile', 1)).toBe('search');
    expect(resolveAdjacentNavTab('search', 1)).toBe('social');
    expect(resolveAdjacentNavTab('social', 1)).toBe('home');
    expect(resolveAdjacentNavTab('home', 1)).toBeNull();
  });

  it('returns null for zero direction', () => {
    expect(resolveAdjacentNavTab('home', 0)).toBeNull();
  });

  it('maps off-tab routes to home anchor for swipe', () => {
    expect(normalizeNavTabForSwipe('artists')).toBe('home');
    expect(getNavTabIndex('artists')).toBe(0);
    expect(resolveAdjacentNavTab('artists', -1)).toBe('social');
    expect(resolveAdjacentNavTab('', -1)).toBe('social');
  });

  it('resolveTabFromDragOffset settles to nearest tab by drag distance', () => {
    const seg = 80;
    expect(resolveTabFromDragOffset({ activeTab: 'home', dx: -50, segmentWidthPx: seg })).toBe('social');
    expect(resolveTabFromDragOffset({ activeTab: 'social', dx: 50, segmentWidthPx: seg })).toBe('home');
    expect(resolveTabFromDragOffset({ activeTab: 'home', dx: -8, segmentWidthPx: seg })).toBeNull();
    expect(resolveTabFromDragOffset({ activeTab: 'home', dx: -20, segmentWidthPx: seg, velocityX: -700 })).toBe('social');
  });

  it('snapIndexFromChipX rounds to nearest slot on release', () => {
    const seg = 80;
    expect(snapIndexFromChipX(0, seg)).toBe(0);
    expect(snapIndexFromChipX(39, seg)).toBe(0);
    expect(snapIndexFromChipX(41, seg)).toBe(1);
    expect(snapIndexFromChipX(159, seg)).toBe(2);
    expect(snapTabFromChipX(120, seg)).toBe('search');
  });

  it('pointerClientXToChipX centers chip on finger and clamps inside track', () => {
    const seg = 80;
    const trackRect = { left: 100, width: 320 };
    const innerPad = 4;
    expect(pointerClientXToChipX({
      clientX: 100 + 4 + 40,
      trackRect,
      innerPadPx: innerPad,
      segmentWidthPx: seg,
    })).toBe(0);
    expect(pointerClientXToChipX({
      clientX: 100 + 4 + 120,
      trackRect,
      innerPadPx: innerPad,
      segmentWidthPx: seg,
    })).toBe(80);
    const maxX = 320 - 8 - seg;
    expect(pointerClientXToChipX({
      clientX: 9999,
      trackRect,
      innerPadPx: innerPad,
      segmentWidthPx: seg,
    })).toBe(maxX);
  });
});
