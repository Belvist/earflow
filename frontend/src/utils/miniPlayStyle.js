import {
  getListenerUiPrefs,
  setListenerUiPrefs,
  subscribeListenerUiPrefs,
  syncListenerUiToDocument,
} from '../preferences/listenerUiPrefs';

export const MINI_PLAY_STYLE = Object.freeze({
  ADAPTIVE: 'adaptive',
  METALLIC: 'metallic',
});

function normalizeStyle(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (value === MINI_PLAY_STYLE.METALLIC || value === 'ios5s') {
    return MINI_PLAY_STYLE.METALLIC;
  }
  if (value === MINI_PLAY_STYLE.ADAPTIVE || value === 'ring') {
    return MINI_PLAY_STYLE.ADAPTIVE;
  }
  return MINI_PLAY_STYLE.ADAPTIVE;
}

export function getMiniPlayStyle() {
  return getListenerUiPrefs().miniPlayStyle;
}

export function setMiniPlayStyle(next) {
  const value = normalizeStyle(next);
  setListenerUiPrefs({ miniPlayStyle: value });
  return value;
}

export function subscribeMiniPlayStyle(onStoreChange) {
  return subscribeListenerUiPrefs(onStoreChange);
}

export function syncMiniPlayStyleToDocument() {
  return syncListenerUiToDocument().miniPlayStyle;
}

/** @param {string} style */
export function isMiniPlayStyle(value) {
  return value === MINI_PLAY_STYLE.ADAPTIVE || value === MINI_PLAY_STYLE.METALLIC;
}
