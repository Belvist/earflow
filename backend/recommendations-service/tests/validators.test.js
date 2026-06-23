/**
 * Unit Tests for Validators
 * @module tests/validators.test
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  ValidationError,
  toPositiveInt,
  toString,
  toArray,
  validateAction,
  validateDurationMs,
  validateProgress,
  validateFeedbackPayload,
  validateBatchFeedbackPayload,
  sanitizeUserId,
  sanitizeSessionId,
} = require('../lib/validators');

describe('Validators', () => {
  describe('toPositiveInt', () => {
    it('should parse valid integer', () => {
      assert.strictEqual(toPositiveInt(42, 'test'), 42);
      assert.strictEqual(toPositiveInt('42', 'test'), 42);
      assert.strictEqual(toPositiveInt(1, 'test'), 1);
    });

    it('should return null for undefined/null when not required', () => {
      assert.strictEqual(toPositiveInt(undefined, 'test'), null);
      assert.strictEqual(toPositiveInt(null, 'test'), null);
      assert.strictEqual(toPositiveInt('', 'test'), null);
    });

    it('should throw for undefined/null when required', () => {
      assert.throws(
        () => toPositiveInt(undefined, 'test', { required: true }),
        ValidationError
      );
    });

    it('should throw for invalid values', () => {
      assert.throws(() => toPositiveInt('abc', 'test'), ValidationError);
      assert.throws(() => toPositiveInt(-1, 'test'), ValidationError);
      assert.throws(() => toPositiveInt(0, 'test'), ValidationError);
    });

    it('should respect min/max bounds', () => {
      assert.strictEqual(toPositiveInt(5, 'test', { min: 1, max: 10 }), 5);
      assert.throws(() => toPositiveInt(0, 'test', { min: 1 }), ValidationError);
      assert.throws(() => toPositiveInt(100, 'test', { max: 10 }), ValidationError);
    });
  });

  describe('toString', () => {
    it('should return trimmed string', () => {
      assert.strictEqual(toString('  hello  ', 'test'), 'hello');
      assert.strictEqual(toString('test', 'test'), 'test');
    });

    it('should return null for empty when not required', () => {
      assert.strictEqual(toString(undefined, 'test'), null);
      assert.strictEqual(toString('', 'test'), null);
    });

    it('should throw for non-string', () => {
      assert.throws(() => toString(123, 'test'), ValidationError);
      assert.throws(() => toString({}, 'test'), ValidationError);
    });

    it('should respect length limits', () => {
      assert.strictEqual(toString('abc', 'test', { minLength: 1, maxLength: 5 }), 'abc');
      assert.throws(
        () => toString('a', 'test', { minLength: 2 }),
        ValidationError
      );
      assert.throws(
        () => toString('abcdef', 'test', { maxLength: 5 }),
        ValidationError
      );
    });

    it('should validate pattern', () => {
      assert.strictEqual(
        toString('abc123', 'test', { pattern: /^[a-z0-9]+$/ }),
        'abc123'
      );
      assert.throws(
        () => toString('abc!', 'test', { pattern: /^[a-z0-9]+$/ }),
        ValidationError
      );
    });
  });

  describe('toArray', () => {
    it('should return array', () => {
      assert.deepStrictEqual(toArray([1, 2, 3], 'test'), [1, 2, 3]);
      assert.deepStrictEqual(toArray([], 'test'), []);
    });

    it('should return null for undefined when not required', () => {
      assert.strictEqual(toArray(undefined, 'test'), null);
    });

    it('should throw for non-array', () => {
      assert.throws(() => toArray('not array', 'test'), ValidationError);
      assert.throws(() => toArray({}, 'test'), ValidationError);
    });

    it('should respect maxLength', () => {
      assert.throws(
        () => toArray([1, 2, 3, 4, 5], 'test', { maxLength: 3 }),
        ValidationError
      );
    });
  });

  describe('validateAction', () => {
    it('should normalize valid actions', () => {
      assert.strictEqual(validateAction('play'), 'play');
      assert.strictEqual(validateAction('PLAY'), 'play');
      assert.strictEqual(validateAction(' Play '), 'play');
      assert.strictEqual(validateAction('skip'), 'skip');
      assert.strictEqual(validateAction('like'), 'like');
      assert.strictEqual(validateAction('dislike'), 'dislike');
    });

    it('should throw for invalid actions', () => {
      assert.throws(() => validateAction('invalid'), ValidationError);
      assert.throws(() => validateAction(''), ValidationError);
      assert.throws(() => validateAction(null), ValidationError);
    });
  });

  describe('validateDurationMs', () => {
    it('should return valid duration', () => {
      assert.strictEqual(validateDurationMs(1000), 1000);
      assert.strictEqual(validateDurationMs('5000'), 5000);
    });

    it('should return 0 for invalid/missing', () => {
      assert.strictEqual(validateDurationMs(undefined), 0);
      assert.strictEqual(validateDurationMs(null), 0);
      assert.strictEqual(validateDurationMs(-100), 0);
      assert.strictEqual(validateDurationMs('abc'), 0);
    });

    it('should cap at max duration', () => {
      const result = validateDurationMs(999999999999);
      assert.ok(result <= 86400000); // Max 24 hours
    });
  });

  describe('validateProgress', () => {
    it('should return valid progress', () => {
      assert.strictEqual(validateProgress(0), 0);
      assert.strictEqual(validateProgress(0.5), 0.5);
      assert.strictEqual(validateProgress(1), 1);
      assert.strictEqual(validateProgress('0.75'), 0.75);
    });

    it('should return null for invalid', () => {
      assert.strictEqual(validateProgress(undefined), null);
      assert.strictEqual(validateProgress(-0.1), null);
      assert.strictEqual(validateProgress(1.5), null);
      assert.strictEqual(validateProgress('abc'), null);
    });

    it('should round to 3 decimal places', () => {
      assert.strictEqual(validateProgress(0.12345), 0.123);
    });
  });

  describe('sanitizeUserId', () => {
    it('should return valid userId', () => {
      assert.strictEqual(sanitizeUserId(123), 123);
      assert.strictEqual(sanitizeUserId('456'), 456);
    });

    it('should throw for invalid userId', () => {
      assert.throws(() => sanitizeUserId(0), ValidationError);
      assert.throws(() => sanitizeUserId(-1), ValidationError);
      assert.throws(() => sanitizeUserId('abc'), ValidationError);
      assert.throws(() => sanitizeUserId(null), ValidationError);
    });
  });

  describe('sanitizeSessionId', () => {
    it('should return valid sessionId', () => {
      assert.strictEqual(sanitizeSessionId('sess_123'), 'sess_123');
      assert.strictEqual(sanitizeSessionId('abc-def:123'), 'abc-def:123');
    });

    it('should strip invalid characters', () => {
      assert.strictEqual(sanitizeSessionId('sess_123$%^'), 'sess_123');
    });

    it('should throw for empty/invalid', () => {
      assert.throws(() => sanitizeSessionId(''), ValidationError);
      assert.throws(() => sanitizeSessionId(null), ValidationError);
      assert.throws(() => sanitizeSessionId('$%^&'), ValidationError);
    });
  });

  describe('validateFeedbackPayload', () => {
    it('should validate correct payload', () => {
      const payload = validateFeedbackPayload(1, {
        trackId: 42,
        action: 'play',
        duration: 1000,
        progress: 0.5,
      });

      assert.strictEqual(payload.userId, 1);
      assert.strictEqual(payload.trackId, 42);
      assert.strictEqual(payload.action, 'play');
      assert.strictEqual(payload.duration, 1000);
      assert.strictEqual(payload.progress, 0.5);
    });

    it('should throw for missing trackId', () => {
      assert.throws(
        () => validateFeedbackPayload(1, { action: 'play' }),
        ValidationError
      );
    });

    it('should throw for invalid action', () => {
      assert.throws(
        () => validateFeedbackPayload(1, { trackId: 1, action: 'invalid' }),
        ValidationError
      );
    });

    it('should throw for userId mismatch', () => {
      assert.throws(
        () => validateFeedbackPayload(1, { userId: 2, trackId: 1, action: 'play' }),
        ValidationError
      );
    });
  });

  describe('validateBatchFeedbackPayload', () => {
    it('should validate correct batch payload', () => {
      const payload = validateBatchFeedbackPayload(1, {
        interactions: [
          { trackId: 1, action: 'play' },
          { trackId: 2, action: 'skip' },
        ],
      });

      assert.strictEqual(payload.userId, 1);
      assert.strictEqual(payload.interactions.length, 2);
    });

    it('should throw for empty interactions', () => {
      assert.throws(
        () => validateBatchFeedbackPayload(1, { interactions: [] }),
        ValidationError
      );
    });

    it('should throw for invalid interaction', () => {
      assert.throws(
        () => validateBatchFeedbackPayload(1, {
          interactions: [{ trackId: 1, action: 'invalid' }],
        }),
        ValidationError
      );
    });
  });
});
