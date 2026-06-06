import {
  LISTENER_UI_DEFAULTS,
  getListenerUiPrefs,
  setListenerUiPrefs,
  hydrateListenerUiFromServer,
  syncListenerUiToDocument,
  normalizeListenerUi,
} from './listenerUiPrefs';

describe('listenerUiPrefs', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.miniBarVariant;
    delete document.documentElement.dataset.miniPlayStyle;
  });

  it('defaults when empty', () => {
    expect(getListenerUiPrefs()).toEqual(
      expect.objectContaining({
        miniBarVariant: 'floating',
        miniPlayStyle: 'adaptive',
      }),
    );
  });

  it('migrates legacy localStorage keys', () => {
    localStorage.setItem('earflow_mini_bar_variant', 'classic');
    localStorage.setItem('earflow_mini_play_style', 'metallic');
    const prefs = getListenerUiPrefs();
    expect(prefs.miniBarVariant).toBe('classic');
    expect(prefs.miniPlayStyle).toBe('metallic');
    expect(localStorage.getItem('earflow_listener_ui_v1')).toContain('classic');
  });

  it('setListenerUiPrefs updates document dataset and css vars', () => {
    setListenerUiPrefs({ miniPlayStyle: 'metallic', miniBarVariant: 'classic' }, { syncServer: false });
    expect(document.documentElement.dataset.miniPlayStyle).toBe('metallic');
    expect(document.documentElement.dataset.miniBarVariant).toBe('classic');
    expect(document.documentElement.style.getPropertyValue('--ef-mini-play-style')).toBe('metallic');
  });

  it('hydrateListenerUiFromServer prefers newer server snapshot', () => {
    setListenerUiPrefs({ miniPlayStyle: 'adaptive' }, { syncServer: false });
    const localBefore = getListenerUiPrefs().updatedAt;
    const server = normalizeListenerUi({
      miniPlayStyle: 'metallic',
      updatedAt: localBefore + 1000,
    });
    hydrateListenerUiFromServer(server);
    expect(getListenerUiPrefs().miniPlayStyle).toBe('metallic');
  });

  it('syncListenerUiToDocument applies stored prefs', () => {
    localStorage.setItem(
      'earflow_listener_ui_v1',
      JSON.stringify({ ...LISTENER_UI_DEFAULTS, miniBarVariant: 'classic', updatedAt: 1 }),
    );
    syncListenerUiToDocument();
    expect(document.documentElement.dataset.miniBarVariant).toBe('classic');
  });
});
