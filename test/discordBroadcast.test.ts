import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildBroadcastCommands, buildReplySnippet } from '../mcManager/discordBroadcast.js';

describe('buildBroadcastCommands', () => {
  test('builds the tellraw + data modify + data get command sequence', () => {
    const commands = buildBroadcastCommands('lomokwa', 'hello there', '#FF0000');
    assert.equal(commands?.length, 3);
    assert.match(commands![0], /^tellraw @a /);
    assert.match(commands![1], /^data modify storage broadcast:log msg set value /);
    assert.equal(commands![2], 'data get storage broadcast:log');
  });

  test('includes the 🎮 tag, username, colors, and message in the tellraw JSON', () => {
    const commands = buildBroadcastCommands('lomokwa', 'hello there', '#FF0000');
    const json = commands![0].slice('tellraw @a '.length);
    const component = JSON.parse(json);
    const asText = JSON.stringify(component);
    assert.ok(asText.includes('🎮'));
    assert.ok(asText.includes('#5865F2')); // fixed Discord-brand color for the tag
    assert.ok(asText.includes('lomokwa'));
    assert.ok(asText.includes('#FF0000')); // sender's role color
    assert.ok(asText.includes('hello there'));
  });

  test('falls back to white when no nameColor is given', () => {
    const commands = buildBroadcastCommands('lomokwa', 'hi', undefined);
    const component = JSON.parse(commands![0].slice('tellraw @a '.length));
    assert.match(JSON.stringify(component), /"#FFFFFF"/);
  });

  test('falls back to white when nameColor is not a valid "#RRGGBB" hex string', () => {
    const commands = buildBroadcastCommands('lomokwa', 'hi', 'red');
    const component = JSON.parse(commands![0].slice('tellraw @a '.length));
    assert.match(JSON.stringify(component), /"#FFFFFF"/);
  });

  test('the data-modify record matches "<🎮 name> <message>"', () => {
    const commands = buildBroadcastCommands('lomokwa', 'hello there');
    assert.equal(commands![1], 'data modify storage broadcast:log msg set value "<🎮 lomokwa> hello there"');
  });

  test('escapes quotes and backslashes in the SNBT string literal', () => {
    const commands = buildBroadcastCommands('lomokwa', 'she said "hi" \\o/');
    assert.equal(
      commands![1],
      'data modify storage broadcast:log msg set value "<🎮 lomokwa> she said \\"hi\\" \\\\o/"',
    );
  });

  test('collapses newlines so a message cannot inject extra console commands', () => {
    const commands = buildBroadcastCommands('lomokwa', 'line one\nline two\r\nline three');
    assert.equal(commands![1], 'data modify storage broadcast:log msg set value "<🎮 lomokwa> line one line two line three"');
  });

  test('truncates messages to 256 characters', () => {
    const commands = buildBroadcastCommands('lomokwa', 'x'.repeat(300));
    const match = /value "<🎮 lomokwa> (x+)"/.exec(commands![1]);
    assert.equal(match?.[1]?.length, 256);
  });

  test('returns null when the username sanitizes to empty', () => {
    assert.equal(buildBroadcastCommands('   ', 'hi'), null);
  });

  test('returns null when the message sanitizes to empty', () => {
    assert.equal(buildBroadcastCommands('lomokwa', '   '), null);
  });

  test('adds a "[DEV] " prefix to the tellraw tag and log record when isDev is true', () => {
    const commands = buildBroadcastCommands('lomokwa', 'hello there', '#FF0000', true);
    const component = JSON.parse(commands![0].slice('tellraw @a '.length));
    assert.ok(JSON.stringify(component).includes('[DEV] '));
    assert.equal(commands![1], 'data modify storage broadcast:log msg set value "[DEV] <🎮 lomokwa> hello there"');
  });

  test('omits the "[DEV]" tag by default (isDev defaults to false)', () => {
    const commands = buildBroadcastCommands('lomokwa', 'hello there', '#FF0000');
    const component = JSON.parse(commands![0].slice('tellraw @a '.length));
    assert.ok(!JSON.stringify(component).includes('DEV'));
    assert.equal(commands![1], 'data modify storage broadcast:log msg set value "<🎮 lomokwa> hello there"');
  });

  test('adds a gray reply-indicator line before the message when replyTo is given', () => {
    const commands = buildBroadcastCommands('lomokwa', 'sure thing', undefined, false, {
      authorName: 'Ant_Redstone',
      snippet: 'anyone up for building tonight?',
    });
    const component = JSON.parse(commands![0].slice('tellraw @a '.length));
    const asText = JSON.stringify(component);
    assert.ok(asText.includes('↱ Resposta a Ant_Redstone: anyone up for building tonight?'));
    assert.ok(asText.includes('"color":"gray"'));
    // the reply line and the actual message must be ONE tellraw component (via an embedded "\n"), not two
    // separate broadcasts -- otherwise they could land as separate chat entries with something else between.
    assert.equal(commands?.length, 3);
  });

  test('omits the reply-indicator line entirely when replyTo is not given', () => {
    const commands = buildBroadcastCommands('lomokwa', 'hello there');
    const component = JSON.parse(commands![0].slice('tellraw @a '.length));
    assert.ok(!JSON.stringify(component).includes('Resposta a'));
  });

  test('includes a bracketed reply summary in the data-modify record too', () => {
    const commands = buildBroadcastCommands('lomokwa', 'sure thing', undefined, false, {
      authorName: 'Ant_Redstone',
      snippet: 'anyone up for building tonight?',
    });
    assert.equal(
      commands![1],
      'data modify storage broadcast:log msg set value "[↱ Resposta a Ant_Redstone: anyone up for building tonight?] <🎮 lomokwa> sure thing"',
    );
  });
});

describe('buildReplySnippet', () => {
  test('returns short text unchanged', () => {
    assert.equal(buildReplySnippet('hi there'), 'hi there');
  });

  test('truncates long text and adds an ellipsis', () => {
    const snippet = buildReplySnippet('x'.repeat(100));
    assert.equal(snippet, `${'x'.repeat(60)}...`);
  });

  test('collapses newlines, same as sanitizeText', () => {
    assert.equal(buildReplySnippet('line one\nline two'), 'line one line two');
  });

  test('falls back to a placeholder for empty/whitespace-only content (e.g. an image-only message)', () => {
    assert.equal(buildReplySnippet(''), '(sem texto)');
    assert.equal(buildReplySnippet('   '), '(sem texto)');
  });
});
