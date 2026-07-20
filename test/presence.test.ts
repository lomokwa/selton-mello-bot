import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SELTON_MELLO_FACTS } from '../presence.js';

describe('SELTON_MELLO_FACTS', () => {
  test('has exactly 15 facts, as requested', () => {
    assert.equal(SELTON_MELLO_FACTS.length, 15);
  });

  test('every fact is a non-empty string with no leading/trailing whitespace', () => {
    for (const fact of SELTON_MELLO_FACTS) {
      assert.equal(typeof fact, 'string');
      assert.ok(fact.length > 0);
      assert.equal(fact, fact.trim());
    }
  });

  test('has no duplicate facts', () => {
    assert.equal(new Set(SELTON_MELLO_FACTS).size, SELTON_MELLO_FACTS.length);
  });

  test('every fact is short enough to read comfortably as a status line', () => {
    for (const fact of SELTON_MELLO_FACTS) {
      assert.ok(fact.length <= 100, `too long (${fact.length} chars): ${fact}`);
    }
  });
});
