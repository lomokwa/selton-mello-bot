import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMinecraftCommand } from '../commands/mc.js';

describe('normalizeMinecraftCommand', () => {
  test('strips a leading slash', () => {
    assert.equal(normalizeMinecraftCommand('/gamemode creative Steve'), 'gamemode creative Steve');
  });

  test('leaves commands without a leading slash unchanged', () => {
    assert.equal(normalizeMinecraftCommand('gamemode creative Steve'), 'gamemode creative Steve');
  });

  test('trims surrounding whitespace', () => {
    assert.equal(normalizeMinecraftCommand('  /say hi  '), 'say hi');
  });

  test('collapses embedded newlines so a second command cannot be smuggled in', () => {
    assert.equal(normalizeMinecraftCommand('say hi\nstop'), 'say hi stop');
    assert.equal(normalizeMinecraftCommand('say hi\r\nstop'), 'say hi stop');
  });

  test('returns an empty string for whitespace-only input', () => {
    assert.equal(normalizeMinecraftCommand('   '), '');
  });
});
