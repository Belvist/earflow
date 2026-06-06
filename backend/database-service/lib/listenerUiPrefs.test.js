'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeListenerUi, mergeListenerUi } = require('./listenerUiPrefs');

test('normalizeListenerUi defaults', () => {
  const ui = normalizeListenerUi({});
  assert.equal(ui.miniBarVariant, 'floating');
  assert.equal(ui.miniPlayStyle, 'adaptive');
  assert.equal(ui.v, 1);
});

test('normalizeListenerUi migrates ios5s', () => {
  const ui = normalizeListenerUi({ miniPlayStyle: 'ios5s' });
  assert.equal(ui.miniPlayStyle, 'metallic');
});

test('mergeListenerUi bumps updatedAt', () => {
  const merged = mergeListenerUi({ miniPlayStyle: 'adaptive', updatedAt: 1 }, { miniPlayStyle: 'metallic' });
  assert.equal(merged.miniPlayStyle, 'metallic');
  assert.ok(merged.updatedAt > 1);
});
