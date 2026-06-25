/**
 * @module tests/sessionStateMachine.test
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  SESSION_STATE,
  buildClientActions,
  buildSessionStateDto,
} = require('../services/sessionStateMachine');

describe('sessionStateMachine', () => {
  it('buildClientActions reflects backend refresh signal', () => {
    const on = buildClientActions({ shouldRefresh: true, skipBurstMode: true });
    assert.strictEqual(on.refreshRecommended, true);
    assert.strictEqual(on.skipBurstMode, true);

    const off = buildClientActions({ shouldRefresh: false, skipBurstMode: false });
    assert.strictEqual(off.refreshRecommended, false);
    assert.strictEqual(off.skipBurstMode, false);
  });

  it('buildSessionStateDto normalizes skip burst state', () => {
    const dto = buildSessionStateDto({
      state: SESSION_STATE.SKIP_BURST,
      skipBurstCount: 4,
      skipBurstMode: true,
      sessionValid: true,
    });
    assert.strictEqual(dto.state, 'skip_burst');
    assert.strictEqual(dto.skipBurstCount, 4);
    assert.strictEqual(dto.skipBurstMode, true);
    assert.strictEqual(dto.sessionValid, true);
  });
});
