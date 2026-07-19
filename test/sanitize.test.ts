import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeMessageContent, sanitizeWebhookUsername, getPlayerHeadUrl } from '../sanitize.js';

describe('sanitizeMessageContent', () => {
  test('escapes markdown special characters', () => {
    assert.equal(sanitizeMessageContent('*bold* _italic_ ~strike~ `code` |spoiler| >quote'), '\\*bold\\* \\_italic\\_ \\~strike\\~ \\`code\\` \\|spoiler\\| \\>quote');
  });

  test('escapes backslashes themselves', () => {
    assert.equal(sanitizeMessageContent('C:\\path'), 'C:\\\\path');
  });

  test('neutralizes @everyone and @here mentions with a zero-width space', () => {
    assert.equal(sanitizeMessageContent('@everyone hi'), '@\u200beveryone hi');
    assert.equal(sanitizeMessageContent('@here hi'), '@\u200bhere hi');
  });

  test('leaves plain text untouched', () => {
    assert.equal(sanitizeMessageContent('hello world'), 'hello world');
  });
});

describe('sanitizeWebhookUsername', () => {
  test('does not escape markdown characters (webhook names are not markdown-rendered)', () => {
    assert.equal(sanitizeWebhookUsername('Ant_Redstone'), 'Ant_Redstone');
  });

  test('trims surrounding whitespace', () => {
    assert.equal(sanitizeWebhookUsername('  Steve  '), 'Steve');
  });

  test('breaks up "discord" substring to satisfy Discord webhook name constraints', () => {
    assert.equal(sanitizeWebhookUsername('discordmod'), 'disc\u200bordmod');
    assert.equal(sanitizeWebhookUsername('DISCORD'), 'disc\u200bord');
  });

  test('truncates to 80 characters', () => {
    const long = 'x'.repeat(100);
    assert.equal(sanitizeWebhookUsername(long).length, 80);
  });

  test('falls back to "Unknown Player" for empty/whitespace-only usernames', () => {
    assert.equal(sanitizeWebhookUsername(''), 'Unknown Player');
    assert.equal(sanitizeWebhookUsername('   '), 'Unknown Player');
  });
});

describe('getPlayerHeadUrl', () => {
  test('builds an mc-heads.net avatar URL', () => {
    assert.equal(getPlayerHeadUrl('Steve'), 'https://mc-heads.net/avatar/Steve/100');
  });

  test('URL-encodes special characters in the username', () => {
    assert.equal(getPlayerHeadUrl('Ant Redstone'), 'https://mc-heads.net/avatar/Ant%20Redstone/100');
  });
});
