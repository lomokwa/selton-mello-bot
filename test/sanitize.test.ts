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

  test('leaves valid custom emoji syntax untouched so it still renders', () => {
    assert.equal(sanitizeMessageContent('<:PogU:531255068251521024>'), '<:PogU:531255068251521024>');
    assert.equal(sanitizeMessageContent('poggers <:PogU:531255068251521024> nice'), 'poggers <:PogU:531255068251521024> nice');
  });

  test('leaves valid animated custom emoji syntax untouched', () => {
    assert.equal(sanitizeMessageContent('<a:dance:531255068251521024>'), '<a:dance:531255068251521024>');
  });

  test('still escapes ">" when it is not part of valid custom emoji syntax', () => {
    assert.equal(sanitizeMessageContent('<:tooShortId:1>'), '<:tooShortId:1\\>');
    assert.equal(sanitizeMessageContent('a > b'), 'a \\> b');
    assert.equal(sanitizeMessageContent('<:notAnEmoji>'), '<:notAnEmoji\\>');
  });

  test('escapes multiple custom emoji correctly without leaking placeholders', () => {
    assert.equal(
      sanitizeMessageContent('<:PogU:531255068251521024><:PogU:531255068251521024>'),
      '<:PogU:531255068251521024><:PogU:531255068251521024>',
    );
  });

  test('leaves a resolved user-mention token <@id> untouched so it still renders', () => {
    // app.ts resolves "@name" -> "<@id>" BEFORE calling sanitize; the ">" must not be escaped or the mention
    // would render as literal "<@id\>" text and never ping. (Whether it PINGS is gated separately by an
    // allowedMentions allow-list on send().)
    assert.equal(sanitizeMessageContent('hi <@123456789012345678>'), 'hi <@123456789012345678>');
    assert.equal(sanitizeMessageContent('<@!123456789012345678> yo'), '<@!123456789012345678> yo');
  });

  test('still escapes a bogus "<@notanid>" that is not a real mention token', () => {
    assert.equal(sanitizeMessageContent('<@notanid>'), '<@notanid\\>');
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
