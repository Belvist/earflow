'use strict';

const SCHEMA_VERSION = 1;

const DEFAULT_LISTENER_UI = Object.freeze({
  v: SCHEMA_VERSION,
  miniBarVariant: 'floating',
  miniPlayStyle: 'adaptive',
  updatedAt: 0,
});

const VALID_BAR = new Set(['floating', 'classic']);
const VALID_PLAY = new Set(['adaptive', 'metallic']);

function toMillis(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/**
 * @param {unknown} raw
 * @returns {typeof DEFAULT_LISTENER_UI}
 */
function normalizeListenerUi(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  let miniBarVariant = String(src.miniBarVariant || '').trim().toLowerCase();
  if (miniBarVariant !== 'classic') miniBarVariant = 'floating';

  let miniPlayStyle = String(src.miniPlayStyle || '').trim().toLowerCase();
  if (miniPlayStyle === 'ios5s') miniPlayStyle = 'metallic';
  else if (miniPlayStyle === 'ring') miniPlayStyle = 'adaptive';
  if (!VALID_PLAY.has(miniPlayStyle)) miniPlayStyle = 'adaptive';

  return {
    v: SCHEMA_VERSION,
    miniBarVariant: VALID_BAR.has(miniBarVariant) ? miniBarVariant : 'floating',
    miniPlayStyle,
    updatedAt: toMillis(src.updatedAt),
  };
}

/**
 * @param {unknown} current
 * @param {unknown} patch
 * @param {{ bumpUpdatedAt?: boolean }} [opts]
 */
function mergeListenerUi(current, patch, opts = {}) {
  const base = normalizeListenerUi(current);
  const nextPatch = patch && typeof patch === 'object' ? patch : {};
  const merged = normalizeListenerUi({ ...base, ...nextPatch });
  if (opts.bumpUpdatedAt !== false) {
    merged.updatedAt = Date.now();
  }
  return merged;
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_LISTENER_UI,
  normalizeListenerUi,
  mergeListenerUi,
};
