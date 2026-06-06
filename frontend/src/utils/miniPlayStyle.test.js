import {
  MINI_PLAY_STYLE,
  getMiniPlayStyle,
  setMiniPlayStyle,
  syncMiniPlayStyleToDocument,
} from './miniPlayStyle';

describe('miniPlayStyle', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.miniPlayStyle;
  });

  it('defaults to adaptive', () => {
    expect(getMiniPlayStyle()).toBe(MINI_PLAY_STYLE.ADAPTIVE);
  });

  it('migrates legacy ios5s to metallic in storage', () => {
    localStorage.setItem('earflow_mini_play_style', 'ios5s');
    expect(getMiniPlayStyle()).toBe(MINI_PLAY_STYLE.METALLIC);
    expect(localStorage.getItem('earflow_mini_play_style')).toBe('metallic');
  });

  it('migrates legacy ring to adaptive in storage', () => {
    localStorage.setItem('earflow_mini_play_style', 'ring');
    expect(getMiniPlayStyle()).toBe(MINI_PLAY_STYLE.ADAPTIVE);
    expect(localStorage.getItem('earflow_mini_play_style')).toBe('adaptive');
  });

  it('setMiniPlayStyle updates html dataset and dispatches unified store event', () => {
    const handler = jest.fn();
    window.addEventListener('earflow:listener-ui-change', handler);
    setMiniPlayStyle(MINI_PLAY_STYLE.METALLIC);
    expect(document.documentElement.dataset.miniPlayStyle).toBe('metallic');
    expect(handler).toHaveBeenCalled();
    window.removeEventListener('earflow:listener-ui-change', handler);
  });

  it('syncMiniPlayStyleToDocument applies stored value', () => {
    localStorage.setItem('earflow_mini_play_style', 'metallic');
    expect(syncMiniPlayStyleToDocument()).toBe('metallic');
    expect(document.documentElement.dataset.miniPlayStyle).toBe('metallic');
  });
});
