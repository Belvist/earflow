import { buildTrackRoutePath, normalizeTrackPublicId, parseTrackRouteParam } from './trackRoute';

describe('trackRoute', () => {
  describe('normalizeTrackPublicId', () => {
    it('accepts a 16-hex id, lowercased', () => {
      expect(normalizeTrackPublicId('1F8214E8F8DC61E1')).toBe('1f8214e8f8dc61e1');
    });

    it('rejects non-16-hex values', () => {
      expect(normalizeTrackPublicId('1f8214e8f8dc61e')).toBeNull();
      expect(normalizeTrackPublicId('1f8214e8f8dc61e1a')).toBeNull();
      expect(normalizeTrackPublicId('123')).toBeNull();
      expect(normalizeTrackPublicId('zzzzzzzzzzzzzzzz')).toBeNull();
      expect(normalizeTrackPublicId(null)).toBeNull();
      expect(normalizeTrackPublicId(undefined)).toBeNull();
    });
  });

  describe('buildTrackRoutePath', () => {
    it('builds /track/{public_id}-{slug} like albums', () => {
      expect(buildTrackRoutePath({
        public_id: '1f8214e8f8dc61e1',
        title: 'Neo Original Mix',
        artist: 'DJ Daniil',
      })).toBe('/track/1f8214e8f8dc61e1-dj-daniil-neo-original-mix');
    });

    it('keeps cyrillic slug', () => {
      expect(buildTrackRoutePath({
        public_id: '1f8214e8f8dc61e1',
        title: 'Ночь',
        artist: 'Артист',
      })).toBe('/track/1f8214e8f8dc61e1-' + encodeURIComponent('артист-ночь'));
    });

    it('falls back to title-only slug when artist missing', () => {
      expect(buildTrackRoutePath({ public_id: '1f8214e8f8dc61e1', title: 'Solo' }))
        .toBe('/track/1f8214e8f8dc61e1-solo');
    });

    it('omits slug when no readable title/artist', () => {
      expect(buildTrackRoutePath({ public_id: '1f8214e8f8dc61e1' }))
        .toBe('/track/1f8214e8f8dc61e1');
    });

    it('never emits numeric or invalid ids', () => {
      expect(buildTrackRoutePath({ id: 303, title: 'X' })).toBeNull();
      expect(buildTrackRoutePath({ public_id: 'not-hex', title: 'X' })).toBeNull();
      expect(buildTrackRoutePath(null)).toBeNull();
      expect(buildTrackRoutePath({})).toBeNull();
    });
  });

  describe('parseTrackRouteParam', () => {
    it('parses public_id with slug', () => {
      expect(parseTrackRouteParam('1f8214e8f8dc61e1-dj-daniil-neo'))
        .toEqual({ kind: 'publicId', publicId: '1f8214e8f8dc61e1', slug: 'dj-daniil-neo' });
    });

    it('parses bare public_id', () => {
      expect(parseTrackRouteParam('1F8214E8F8DC61E1'))
        .toEqual({ kind: 'publicId', publicId: '1f8214e8f8dc61e1', slug: '' });
    });

    it('parses legacy numeric id', () => {
      expect(parseTrackRouteParam('303')).toEqual({ kind: 'numeric', id: 303, slug: '' });
      expect(parseTrackRouteParam('303-old-name')).toEqual({ kind: 'numeric', id: 303, slug: '' });
    });

    it('returns null for garbage', () => {
      expect(parseTrackRouteParam('abc')).toBeNull();
      expect(parseTrackRouteParam('')).toBeNull();
      expect(parseTrackRouteParam(null)).toBeNull();
    });
  });
});
