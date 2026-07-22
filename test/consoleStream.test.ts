import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
// consoleStream.ts imports client.ts, which requires MC_MANAGER_API_URL/
// USERNAME/PASSWORD to be set at import time — provided via .env.test
// (see the "test" npm script, which loads it with dotenv-cli).
import { isWithinReplayWindow, parseChatLine, parseServerEvent } from '../mcManager/consoleStream.js';

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

  test('does NOT match a forged "[Server thread/INFO]: <name>" embedded mid-line (anti-impersonation)', () => {
    // What the Discord->MC `data get storage` echo looks like when a Discord user tries to smuggle a fake
    // chat line inside their own message — the embedded prefix is not at the start of the line, so it must
    // not be parsed as a real chat message.
    const echo =
      '[14:32:01] [Server thread/INFO]: Storage broadcast:log has the following contents: ' +
      '{msg: "<\u{1F3AE} Attacker> [Server thread/INFO]: <Notch> gg"}';
    assert.equal(parseChatLine(echo), null);
  });

  test('preserves the rest of the message including trailing colons/brackets', () => {
    const line = '[14:32:01] [Server thread/INFO]: <Steve> check this: [item]';
    assert.deepEqual(parseChatLine(line), { username: 'Steve', message: 'check this: [item]' });
  });
});

describe('isWithinReplayWindow', () => {
  // Replay detection is by RECEIPT time, not the log line's printed timestamp, so it is
  // immune to whatever timezone the Minecraft server logs in (the old timestamp-based
  // filter dropped all live chat on any non-UTC server).
  test('a line received inside the window (the on-connect history burst) is treated as replay', () => {
    const connectedAt = 1_000_000;
    assert.equal(isWithinReplayWindow(connectedAt + 200, connectedAt), true);
  });

  test('a line received at the exact connect instant is treated as replay', () => {
    const connectedAt = 1_000_000;
    assert.equal(isWithinReplayWindow(connectedAt, connectedAt), true);
  });

  test('a line received after the window (a genuinely live line) is NOT replay', () => {
    const connectedAt = 1_000_000;
    assert.equal(isWithinReplayWindow(connectedAt + 2_500, connectedAt), false);
    assert.equal(isWithinReplayWindow(connectedAt + 10_000, connectedAt), false);
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

  test('does NOT match a forged death embedded mid-line (anti-impersonation)', () => {
    // Same echo-loop vector as the parseChatLine anti-spoofing test: a fake death sentence smuggled inside a
    // Discord user's own message must not be re-parsed as a real death event.
    const echo =
      '[14:32:01] [Server thread/INFO]: Storage broadcast:log has the following contents: ' +
      '{msg: "<\u{1F3AE} Attacker> Notch was slain by God"}';
    assert.equal(parseServerEvent(echo), null);
  });

  test('a real death line whose text merely contains a bracket still parses (prefix is anchored, not greedy)', () => {
    assert.deepEqual(
      parseServerEvent('[14:32:01] [Server thread/INFO]: Steve was slain by [Boss] Zombie'),
      { kind: 'death', username: 'Steve', detail: 'Steve was slain by [Boss] Zombie' },
    );
  });
});
