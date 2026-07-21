import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
// players.ts imports client.ts, which requires MC_MANAGER_API_URL/USERNAME/
// PASSWORD at import time — provided via .env.test (see consoleStream.test.ts).
import { buildOnlineMessage, Player } from '../mcManager/players.js';

function player(name: string, online: boolean): Player {
  return { uuid: `uuid-${name}`, name, online, is_op: false, is_banned: false, is_whitelisted: true };
}

describe('buildOnlineMessage', () => {
  test('reports nobody online when the list is empty', () => {
    assert.equal(buildOnlineMessage([]), 'Ninguém online no servidor agora.');
  });

  test('reports nobody online when every known player is offline', () => {
    assert.equal(buildOnlineMessage([player('Steve', false), player('Alex', false)]), 'Ninguém online no servidor agora.');
  });

  test('uses singular "jogador" for exactly one online player', () => {
    assert.equal(buildOnlineMessage([player('Steve', true)]), '**1** jogador online: Steve');
  });

  test('uses plural "jogadores" and lists names alphabetically for multiple online players', () => {
    const message = buildOnlineMessage([player('Zeca', true), player('Ant_Redstone', true), player('Steve', true)]);
    assert.equal(message, '**3** jogadores online: Ant_Redstone, Steve, Zeca');
  });

  test('excludes offline players from both the count and the name list', () => {
    const message = buildOnlineMessage([player('Steve', true), player('Alex', false)]);
    assert.equal(message, '**1** jogador online: Steve');
  });
});
