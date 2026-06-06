/**
 * Unified listener UI preferences — single store, server sync when authenticated.
 * Replaces parallel localStorage keys (mini bar variant + play style).
 */

export const LISTENER_UI_SCHEMA_VERSION = 1;

export const LISTENER_UI_DEFAULTS = Object.freeze({
  v: LISTENER_UI_SCHEMA_VERSION,
  miniBarVariant: 'floating',
  miniPlayStyle: 'adaptive',
  updatedAt: 0,
});

const STORAGE_KEY = 'earflow_listener_ui_v1';
const LEGACY_BAR_KEY = 'earflow_mini_bar_variant';
const LEGACY_PLAY_KEY = 'earflow_mini_play_style';
const CHANGE_EVENT = 'earflow:listener-ui-change';
const LEGACY_PLAY_EVENT = 'earflow:mini-play-style';
const LEGACY_BAR_EVENT = 'earflow:mini-bar-variant';

const VALID_BAR = new Set(['floating', 'classic']);
const VALID_PLAY = new Set(['adaptive', 'metallic']);

let serverSyncTimer = null;

function toMillis(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

export function normalizeListenerUi(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  let miniBarVariant = String(src.miniBarVariant || '').trim().toLowerCase();
  if (!VALID_BAR.has(miniBarVariant)) miniBarVariant = LISTENER_UI_DEFAULTS.miniBarVariant;

  let miniPlayStyle = String(src.miniPlayStyle || '').trim().toLowerCase();
  if (miniPlayStyle === 'ios5s') miniPlayStyle = 'metallic';
  else if (miniPlayStyle === 'ring') miniPlayStyle = 'adaptive';
  if (!VALID_PLAY.has(miniPlayStyle)) miniPlayStyle = LISTENER_UI_DEFAULTS.miniPlayStyle;

  return {
    v: LISTENER_UI_SCHEMA_VERSION,
    miniBarVariant,
    miniPlayStyle,
    updatedAt: toMillis(src.updatedAt),
  };
}

function readLegacyFromStorage() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const bar = localStorage.getItem(LEGACY_BAR_KEY);
    const play = localStorage.getItem(LEGACY_PLAY_KEY);
    if (!bar && !play) return null;
    return normalizeListenerUi({
      miniBarVariant: bar || undefined,
      miniPlayStyle: play || undefined,
      updatedAt: Date.now(),
    });
  } catch {
    return null;
  }
}

function readLocal() {
  if (typeof localStorage === 'undefined') {
    return { ...LISTENER_UI_DEFAULTS };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const legacy = readLegacyFromStorage();
      if (legacy) {
        writeLocal(legacy);
        return legacy;
      }
      return { ...LISTENER_UI_DEFAULTS };
    }
    return normalizeListenerUi(JSON.parse(raw));
  } catch {
    return { ...LISTENER_UI_DEFAULTS };
  }
}

function writeLocal(prefs) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    localStorage.setItem(LEGACY_BAR_KEY, prefs.miniBarVariant);
    localStorage.setItem(LEGACY_PLAY_KEY, prefs.miniPlayStyle);
  } catch {
    // quota / private mode
  }
}

export function applyListenerUiToDocument(prefs) {
  if (typeof document === 'undefined') return;
  const value = normalizeListenerUi(prefs);
  const root = document.documentElement;
  root.dataset.miniBarVariant = value.miniBarVariant;
  root.dataset.miniPlayStyle = value.miniPlayStyle;
  root.style.setProperty('--ef-mini-bar-variant', value.miniBarVariant);
  root.style.setProperty('--ef-mini-play-style', value.miniPlayStyle);
}

function dispatchChange(detail) {
  if (typeof window === 'undefined') return;
  const value = normalizeListenerUi(detail);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: value }));
  window.dispatchEvent(new CustomEvent(LEGACY_PLAY_EVENT, { detail: { style: value.miniPlayStyle } }));
  window.dispatchEvent(new CustomEvent(LEGACY_BAR_EVENT, { detail: { variant: value.miniBarVariant } }));
}

function queueServerSync(prefs) {
  if (typeof window === 'undefined') return;
  if (serverSyncTimer) clearTimeout(serverSyncTimer);
  serverSyncTimer = window.setTimeout(async () => {
    serverSyncTimer = null;
    try {
      const { default: apiClient } = await import('../api/client');
      const user = apiClient.getUser?.();
      if (!user || !(user.id || user.userId)) return;
      await apiClient.updateUserSettings({
        listener_ui: {
          v: prefs.v,
          miniBarVariant: prefs.miniBarVariant,
          miniPlayStyle: prefs.miniPlayStyle,
          updatedAt: prefs.updatedAt,
        },
      });
    } catch {
      // guest / offline — local-only is fine
    }
  }, 350);
}

export function getListenerUiPrefs() {
  return readLocal();
}

/**
 * @param {Partial<typeof LISTENER_UI_DEFAULTS>} patch
 * @param {{ syncServer?: boolean }} [options]
 */
export function setListenerUiPrefs(patch, options = {}) {
  const current = readLocal();
  const next = normalizeListenerUi({
    ...current,
    ...patch,
    updatedAt: Date.now(),
  });
  writeLocal(next);
  applyListenerUiToDocument(next);
  dispatchChange(next);
  if (options.syncServer !== false) {
    queueServerSync(next);
  }
  return next;
}

export function subscribeListenerUiPrefs(onStoreChange) {
  if (typeof window === 'undefined') return () => {};
  const handler = () => onStoreChange();
  const onStorage = (event) => {
    if (event.key === STORAGE_KEY || event.key === LEGACY_BAR_KEY || event.key === LEGACY_PLAY_KEY) {
      onStoreChange();
    }
  };
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener(LEGACY_PLAY_EVENT, handler);
  window.addEventListener(LEGACY_BAR_EVENT, handler);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener(LEGACY_PLAY_EVENT, handler);
    window.removeEventListener(LEGACY_BAR_EVENT, handler);
    window.removeEventListener('storage', onStorage);
  };
}

export function syncListenerUiToDocument() {
  const prefs = readLocal();
  applyListenerUiToDocument(prefs);
  return prefs;
}

/**
 * Merge server snapshot (after GET /api/user/settings). Newer updatedAt wins; pushes local if ahead.
 */
export function hydrateListenerUiFromServer(serverListenerUi) {
  const server = normalizeListenerUi(serverListenerUi || {});
  const local = readLocal();

  if (server.updatedAt > local.updatedAt) {
    writeLocal(server);
    applyListenerUiToDocument(server);
    dispatchChange(server);
    return server;
  }

  if (local.updatedAt > server.updatedAt) {
    queueServerSync(local);
    return local;
  }

  return local;
}

export const subscribeMiniBarVariantFromListenerUi = subscribeListenerUiPrefs;
export const subscribeMiniPlayStyleFromListenerUi = subscribeListenerUiPrefs;
