import { MOBILE_NAV_TAB_ORDER, resolveAdjacentNavTab } from './mobileBottomNavTabs';

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

  it('returns null for unknown active tab or zero direction', () => {
    expect(resolveAdjacentNavTab('', -1)).toBeNull();
    expect(resolveAdjacentNavTab('home', 0)).toBeNull();
  });
});
