const { lazyWithRetry } = require('./lazyWithRetry');

describe('lazyWithRetry', () => {
  beforeEach(() => {
    try {
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
  });

  it('exports a lazy component factory', () => {
    const Lazy = lazyWithRetry(() => Promise.resolve({ default: () => null }), 'test');
    expect(Lazy).toBeTruthy();
    expect(typeof Lazy).toBe('object');
  });
});
