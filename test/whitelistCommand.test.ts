import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseWhitelistCommand } from '../whitelistCommand.js';

describe('parseWhitelistCommand', () => {
  test('extracts the username after "!whitelist "', () => {
    assert.equal(parseWhitelistCommand('!whitelist Steve'), 'Steve');
  });

  test('is case-insensitive on the command itself', () => {
    assert.equal(parseWhitelistCommand('!Whitelist Steve'), 'Steve');
    assert.equal(parseWhitelistCommand('!WHITELIST Steve'), 'Steve');
  });

  test('tolerates extra leading/trailing whitespace and multiple spaces before the username', () => {
    assert.equal(parseWhitelistCommand('  !whitelist   Steve  '), 'Steve');
  });

  test('returns null when no username is given', () => {
    assert.equal(parseWhitelistCommand('!whitelist'), null);
    assert.equal(parseWhitelistCommand('!whitelist   '), null);
  });

  test('returns null for unrelated messages', () => {
    assert.equal(parseWhitelistCommand('hello world'), null);
    assert.equal(parseWhitelistCommand('!online'), null);
  });

  test('only takes the first whitespace-separated token as the username', () => {
    assert.equal(parseWhitelistCommand('!whitelist Steve please'), 'Steve');
  });
});
