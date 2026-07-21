import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
// consoleStream.ts imports client.ts, which requires MC_MANAGER_API_URL/
// USERNAME/PASSWORD to be set at import time — provided via .env.test
// (see the "test" npm script, which loads it with dotenv-cli).
import { isReplayedLine, parseChatLine, parseServerEvent } from '../mcManager/consoleStream.js';

describe('parseChatLine', () => {
  test('extracts username and message from a standard chat log line', () => {
    const line = '[14:32:01] [Server thread/INFO]: <Steve> hello world';
    assert.deepEqual(parseChatLine(line), { username: 'Steve', message: 'hello world' });
  });

  test('handles usernames with underscores and special characters', () => {
    const line = '[14:32:01] [Server thread/INFO]: <Ant_Redstone> hi there';
    assert.deepEqual(parseChatLine(line), { username: 'Ant_Redstone', message: 'hi there' });
  });

  test('returns null for non-chat log lines', () => {
    assert.equal(parseChatLine('[14:32:01] [Server thread/INFO]: Steve joined the game'), null);
    assert.equal(parseChatLine('some unrelated line'), null);
  });

  test('preserves the rest of the message including trailing colons/brackets', () => {
    const line = '[14:32:01] [Server thread/INFO]: <Steve> check this: [item]';
    assert.deepEqual(parseChatLine(line), { username: 'Steve', message: 'check this: [item]' });
  });
});

describe('isReplayedLine', () => {
  test('treats a line stamped before the connection time as replayed', () => {
    // Connected at 12:00:05 UTC; line stamped 12:00:00 UTC is from before we connected.
    const connectedAt = Date.UTC(2024, 0, 1, 12, 0, 5);
    const line = '[12:00:00] [Server thread/INFO]: <Steve> old message';
    assert.equal(isReplayedLine(line, connectedAt), true);
  });

  test('treats a line stamped after the connection time as live', () => {
    const connectedAt = Date.UTC(2024, 0, 1, 12, 0, 0);
    const line = '[12:00:05] [Server thread/INFO]: <Steve> new message';
    assert.equal(isReplayedLine(line, connectedAt), false);
  });

  test('allows a small clock-skew tolerance around the connection time', () => {
    const connectedAt = Date.UTC(2024, 0, 1, 12, 0, 5);
    // 1s before connectedAt is within the 2s clock-skew tolerance -> treated as live.
    const line = '[12:00:04] [Server thread/INFO]: <Steve> just barely live';
    assert.equal(isReplayedLine(line, connectedAt), false);
  });

  test('handles UTC day rollover (line stamped just before midnight is recognized as prior-day replay)', () => {
    // Connecting right after midnight (00:00:05 on day 2) with a replayed
    // line stamped 23:59:58 the prior day — naive same-day comparison would
    // put the line in the future; the rollover correction must recognize
    // it's actually from before we connected, so it's replay.
    const connectedAt = Date.UTC(2024, 0, 2, 0, 0, 5);
    const line = '[23:59:58] [Server thread/INFO]: <Steve> right before rollover';
    assert.equal(isReplayedLine(line, connectedAt), true);
  });

  test('returns false (assumes live) when the line has no parseable timestamp', () => {
    assert.equal(isReplayedLine('no timestamp here', Date.now()), false);
  });
});

describe('parseServerEvent', () => {
  test('detects a join', () => {
    const line = '[14:32:01] [Server thread/INFO]: Steve joined the game';
    assert.deepEqual(parseServerEvent(line), { kind: 'join', username: 'Steve' });
  });

  test('detects a leave', () => {
    const line = '[14:32:01] [Server thread/INFO]: Steve left the game';
    assert.deepEqual(parseServerEvent(line), { kind: 'leave', username: 'Steve' });
  });

  test('detects each advancement frame type (task/goal/challenge)', () => {
    assert.deepEqual(
      parseServerEvent('[14:32:01] [Server thread/INFO]: Steve has made the advancement [Stone Age]'),
      { kind: 'advancement', username: 'Steve', detail: 'Stone Age' },
    );
    assert.deepEqual(
      parseServerEvent('[14:32:01] [Server thread/INFO]: Steve has reached the goal [Sniper Duel]'),
      { kind: 'advancement', username: 'Steve', detail: 'Sniper Duel' },
    );
    assert.deepEqual(
      parseServerEvent('[14:32:01] [Server thread/INFO]: Steve has completed the challenge [How Did We Get Here?]'),
      { kind: 'advancement', username: 'Steve', detail: 'How Did We Get Here?' },
    );
  });

  test('detects common death message shapes', () => {
    assert.deepEqual(
      parseServerEvent('[14:32:01] [Server thread/INFO]: Steve was slain by Zombie'),
      { kind: 'death', username: 'Steve', detail: 'Steve was slain by Zombie' },
    );
    assert.deepEqual(
      parseServerEvent('[14:32:01] [Server thread/INFO]: Steve drowned'),
      { kind: 'death', username: 'Steve', detail: 'Steve drowned' },
    );
    assert.deepEqual(
      parseServerEvent('[14:32:01] [Server thread/INFO]: Steve fell from a high place'),
      { kind: 'death', username: 'Steve', detail: 'Steve fell from a high place' },
    );
    assert.deepEqual(
      parseServerEvent('[14:32:01] [Server thread/INFO]: Steve was blown up by Creeper'),
      { kind: 'death', username: 'Steve', detail: 'Steve was blown up by Creeper' },
    );
  });

  test('detects the server stopping and coming back up', () => {
    assert.deepEqual(
      parseServerEvent('[14:32:01] [Server thread/INFO]: Stopping the server'),
      { kind: 'server_down' },
    );
    assert.deepEqual(
      parseServerEvent('[14:32:01] [Server thread/INFO]: Done (23.456s)! For help, type "help"'),
      { kind: 'server_up' },
    );
  });

  test('returns null for a chat line (chat is handled separately by parseChatLine)', () => {
    assert.equal(parseServerEvent('[14:32:01] [Server thread/INFO]: <Steve> hello world'), null);
  });

  test('returns null for an unrelated log line', () => {
    assert.equal(parseServerEvent('[14:32:01] [Server thread/INFO]: Preparing level "world"'), null);
  });
});
