import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAlreadyLinkedWhisperCommand,
  buildLinkWhisperCommand,
  generateLinkCode,
  isValidMinecraftUsername,
} from '../mcManager/accountLinking.js';

describe('isValidMinecraftUsername', () => {
  test('accepts valid usernames (letters, digits, underscores, 3-16 chars)', () => {
    assert.equal(isValidMinecraftUsername('Steve'), true);
    assert.equal(isValidMinecraftUsername('Ant_Redstone'), true);
    assert.equal(isValidMinecraftUsername('a1_'), true);
    assert.equal(isValidMinecraftUsername('x'.repeat(16)), true);
  });

  test('rejects usernames shorter than 3 or longer than 16 characters', () => {
    assert.equal(isValidMinecraftUsername('ab'), false);
    assert.equal(isValidMinecraftUsername('x'.repeat(17)), false);
  });

  test('rejects usernames with disallowed characters', () => {
    assert.equal(isValidMinecraftUsername('bad name'), false);
    assert.equal(isValidMinecraftUsername('bad-name'), false);
    assert.equal(isValidMinecraftUsername('bad@name'), false);
    assert.equal(isValidMinecraftUsername(''), false);
  });
});

describe('generateLinkCode', () => {
  test('generates a zero-padded 6-digit numeric code', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateLinkCode();
      assert.match(code, /^\d{6}$/);
    }
  });
});

describe('buildLinkWhisperCommand', () => {
  test('builds a tellraw command targeted at just that player (never a /tell, which would log to console)', () => {
    const command = buildLinkWhisperCommand('Steve', '123456');
    assert.match(command, /^tellraw Steve /);
    assert.ok(!command.startsWith('tell '));
  });

  test('includes the code and the confirm instructions in the tellraw JSON', () => {
    const command = buildLinkWhisperCommand('Steve', '123456');
    const json = command.slice('tellraw Steve '.length);
    const component = JSON.parse(json);
    const asText = JSON.stringify(component);
    assert.ok(asText.includes('123456'));
    assert.ok(asText.includes('/link confirm code:123456'));
  });

  test('makes the confirm command clickable via a copy_to_clipboard click_event', () => {
    const command = buildLinkWhisperCommand('Steve', '123456');
    const component = JSON.parse(command.slice('tellraw Steve '.length));
    const clickablePart = component.find((part: { click_event?: unknown }) => part.click_event);

    assert.ok(clickablePart, 'expected a component part with a click_event');
    assert.deepEqual(clickablePart.click_event, { action: 'copy_to_clipboard', value: '/link confirm code:123456' });
  });

  test('uses the current snake_case hover_event format with a "value" field', () => {
    const command = buildLinkWhisperCommand('Steve', '123456');
    const component = JSON.parse(command.slice('tellraw Steve '.length));
    const clickablePart = component.find((part: { hover_event?: { value?: unknown } }) => part.hover_event);

    assert.ok(clickablePart, 'expected a component part with a hover_event');
    assert.equal(clickablePart.hover_event.action, 'show_text');
    assert.equal(typeof clickablePart.hover_event.value, 'string');
  });
});

describe('buildAlreadyLinkedWhisperCommand', () => {
  test('builds a tellraw command targeted at just that player', () => {
    const command = buildAlreadyLinkedWhisperCommand('Steve');
    assert.match(command, /^tellraw Steve /);
  });

  test('tells the player to unlink in Discord first', () => {
    const command = buildAlreadyLinkedWhisperCommand('Steve');
    const json = command.slice('tellraw Steve '.length);
    const component = JSON.parse(json);
    assert.ok(JSON.stringify(component).includes('/link unlink'));
  });
});
