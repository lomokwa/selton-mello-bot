import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
// consoleStream.ts imports client.ts, which requires MC_MANAGER_API_URL/
// USERNAME/PASSWORD to be set at import time — provided via .env.test
// (see the "test" npm script, which loads it with dotenv-cli).
import { isReplayedLine, parseChatLine } from '../mcManager/consoleStream.js';

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
