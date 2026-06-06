import {
  getListenerUiPrefs,
  setListenerUiPrefs,
  subscribeListenerUiPrefs,
  syncListenerUiToDocument,
} from '../preferences/listenerUiPrefs';

export const MINI_BAR_VARIANT = Object.freeze({
  FLOATING: 'floating',
  CLASSIC: 'classic',
});

export const MINI_BAR_VARIANT_LABELS = Object.freeze({
  [MINI_BAR_VARIANT.FLOATING]: 'новый',
  [MINI_BAR_VARIANT.CLASSIC]: 'стандарт',
});

function normalizeVariant(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (value === MINI_BAR_VARIANT.CLASSIC || value === 'standard') {
    return MINI_BAR_VARIANT.CLASSIC;
  }
  if (value === MINI_BAR_VARIANT.FLOATING || value === 'new') {
    return MINI_BAR_VARIANT.FLOATING;
  }
  return MINI_BAR_VARIANT.FLOATING;
}

export function getMiniBarVariant() {
  return getListenerUiPrefs().miniBarVariant;
}

export function setMiniBarVariant(next) {
  const value = normalizeVariant(next);
  setListenerUiPrefs({ miniBarVariant: value });
  return value;
}

export function subscribeMiniBarVariant(onStoreChange) {
  return subscribeListenerUiPrefs(onStoreChange);
}

export function syncMiniBarVariantToDocument() {
  return syncListenerUiToDocument().miniBarVariant;
}

/** @param {string} value */
export function isMiniBarVariant(value) {
  return value === MINI_BAR_VARIANT.FLOATING || value === MINI_BAR_VARIANT.CLASSIC;
}
