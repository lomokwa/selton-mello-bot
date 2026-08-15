import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SELTON_MELLO_FACTS, buildStatusTextFrom } from '../presence.js';

describe('buildStatusTextFrom', () => {
  test('counts online players, plural', () => {
    assert.equal(buildStatusTextFrom({ kind: 'players', online: 3 }), '🎮 3 jogadores online');
  });

  test('counts online players, singular', () => {
    assert.equal(buildStatusTextFrom({ kind: 'players', online: 1 }), '🎮 1 jogador online');
  });

  test('an empty but running server reads as online, not as a problem', () => {
    assert.equal(buildStatusTextFrom({ kind: 'players', online: 0 }), '🟢 Servidor online — ninguém jogando agora');
  });

  // The bug this replaces: a stopped Minecraft server still answered the player
  // list through the panel, so the status line claimed the server was ONLINE.
  test('a stopped Minecraft server does not claim to be online', () => {
    const text = buildStatusTextFrom({ kind: 'stopped' });
    assert.equal(text, '🟡 Servidor de Minecraft parado');
    assert.ok(!text.includes('online'), 'a stopped server must never render as online');
  });

  // ...and the other half: "indisponível" used to cover a stopped server too, so
  // a red status told you nothing about which of the two had actually happened.
  test('an unreachable panel is reported as the panel, not as the game server', () => {
    assert.equal(buildStatusTextFrom({ kind: 'unreachable' }), '🔴 Painel fora do ar');
  });

  // The outage that prompted all of this: mc-manager's RBAC went live, the bot's
  // own account had no role, every call came back 403 -- and the status line said
  // "servidor indisponível", pointing at the Minecraft server instead of at the
  // one thing that was actually wrong.
  test('a 403 blames the bot account, not the server', () => {
    const text = buildStatusTextFrom({ kind: 'forbidden' });
    assert.equal(text, '🔴 Bot sem permissão no painel');
    assert.notEqual(text, buildStatusTextFrom({ kind: 'unreachable' }));
  });

  test('every state renders a distinct, non-empty line', () => {
    const texts = [
      buildStatusTextFrom({ kind: 'players', online: 0 }),
      buildStatusTextFrom({ kind: 'players', online: 2 }),
      buildStatusTextFrom({ kind: 'stopped' }),
      buildStatusTextFrom({ kind: 'forbidden' }),
      buildStatusTextFrom({ kind: 'unreachable' }),
    ];
    assert.equal(new Set(texts).size, texts.length);
    for (const t of texts) assert.ok(t.trim().length > 0);
  });
});

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
