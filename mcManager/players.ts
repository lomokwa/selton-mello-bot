/**
 * Thin client for mc-manager-server's `GET /api/players` endpoint, which
 * already reports each known player's op/whitelist/ban/online status parsed
 * from the server's ops.json/whitelist.json/banned-players.json/usercache.json
 * (see mc-manager-server's services/minecraft.go ListPlayers) — so op status
 * can be checked without needing a new endpoint or any console-command trick.
 */
import { getApiUrl, getToken } from './client.js';

export interface Player {
  uuid: string;
  name: string;
  online: boolean;
  is_op: boolean;
  is_banned: boolean;
  is_whitelisted: boolean;
}

interface PlayersResponse {
  success: boolean;
  data?: Player[];
  error?: string;
}

/** Fetches the full player list (everyone who's ever joined) from mc-manager-server. */
export async function listPlayers(): Promise<Player[]> {
  const token = await getToken();
  const response = await fetch(`${getApiUrl()}/api/players`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const body = (await response.json()) as PlayersResponse;
  if (!response.ok || !body.success || !body.data) {
    throw new Error(`mc-manager: failed to list players: ${body.error ?? response.statusText}`);
  }

  return body.data;
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
