/**
 * Thin client for mc-manager-server's `GET /api/players` endpoint, which
 * already reports each known player's op/whitelist/ban/online status parsed
 * from the server's ops.json/whitelist.json/banned-players.json/usercache.json
 * (see mc-manager-server's services/minecraft.go ListPlayers) — so op status
 * can be checked without needing a new endpoint or any console-command trick.
 */
import { apiGet } from './client.js';

export interface Player {
  uuid: string;
  name: string;
  online: boolean;
  is_op: boolean;
  is_banned: boolean;
  is_whitelisted: boolean;
}

// Every caller of listPlayers() (the presence rotation every 30s, "!online", "/mc"'s op check, "!whitelist"'s
// op check) used to hit mc-manager-server fresh every time -- and on that side, GetOnlinePlayers doesn't just
// read a file: it runs a REAL "list" command against the Minecraft server console and parses the reply (see
// mc-manager's services/minecraft.go). A 30s presence poll alone was ~2,880 of those a day for a status line
// nobody's watching that closely. A short cache shared across every caller here cuts that by roughly the same
// factor these call sites overlap, with no visible staleness cost (audit finding G1/B4 -- this is the bot-side
// half; the server-side cache is mc-manager's own fix).
const CACHE_TTL_MS = 10 * 1000;
let cachedPlayers: Player[] | null = null;
let cachedAt = 0;

/** Fetches the full player list (everyone who's ever joined) from mc-manager-server, cached for a few seconds
 *  so a burst of calls (presence + a chat command landing close together) only pays for one real fetch. */
export async function listPlayers(): Promise<Player[]> {
  const now = Date.now();
  if (cachedPlayers !== null && now - cachedAt < CACHE_TTL_MS) {
    return cachedPlayers;
  }

  const players = await apiGet<Player[]>('/api/players');
  cachedPlayers = players;
  cachedAt = now;
  return players;
}

/** True when the Minecraft server itself is up — which is a different question from
 *  "is the panel reachable", and the one the status line actually wants to answer. */
export async function isMinecraftRunning(): Promise<boolean> {
  const status = await apiGet<{ running: boolean }>('/api/status');
  return status.running;
}

/**
 * Returns whether the given Minecraft username is currently a server
 * operator, or null if that username isn't known to mc-manager-server at
 * all (never joined, so it has no usercache.json entry to match against).
 * Matches case-insensitively, since Minecraft usernames are unique ignoring case.
 */
export async function isPlayerOp(minecraftUsername: string): Promise<boolean | null> {
  const players = await listPlayers();
  const player = players.find((p) => p.name.toLowerCase() === minecraftUsername.toLowerCase());
  return player ? player.is_op : null;
}

/** Builds the "!online" reply text from a player list — pure, so it's testable without mocking the API call. */
export function buildOnlineMessage(players: Player[]): string {
  const online = players.filter((player) => player.online);
  if (online.length === 0) {
    return 'Ninguém online no servidor agora.';
  }
  const names = online
    .map((player) => player.name)
    .sort((a, b) => a.localeCompare(b))
    .join(', ');
  return `**${online.length}** jogador${online.length === 1 ? '' : 'es'} online: ${names}`;
}

/** Builds the "/serverinfo" reply text from a player list — pure, so it's testable without mocking the API call. */
export function buildServerInfoMessage(players: Player[]): string {
  const whitelistedCount = players.filter((player) => player.is_whitelisted).length;
  const opCount = players.filter((player) => player.is_op).length;
  const bannedCount = players.filter((player) => player.is_banned).length;

  return [
    '🟢 Servidor online',
    buildOnlineMessage(players),
    `📋 **${players.length}** jogador${players.length === 1 ? '' : 'es'} conhecido${players.length === 1 ? '' : 's'} — ` +
      `${whitelistedCount} na whitelist, ${opCount} op${opCount === 1 ? '' : 's'}, ${bannedCount} banido${bannedCount === 1 ? '' : 's'}`,
  ].join('\n');
}
