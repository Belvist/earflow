import { toListenerSameOriginCoverUrl } from './listenerCoverUrl';

describe('listenerCoverUrl', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: new URL('https://earflow.ru/'),
      writable: true,
    });
  });

  it('rewrites api covers to same-origin path', () => {
    expect(toListenerSameOriginCoverUrl('https://api.earflow.ru/covers/a.jpg?t=1'))
      .toBe('/covers/a.jpg?t=1');
  });

  it('passes through relative cover paths', () => {
    expect(toListenerSameOriginCoverUrl('/covers/b.jpg')).toBe('/covers/b.jpg');
  });

  it('returns empty for invalid input', () => {
    expect(toListenerSameOriginCoverUrl('')).toBe('');
    expect(toListenerSameOriginCoverUrl(null)).toBe('');
  });
});
