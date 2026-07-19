/**
 * Sends a Discord chat message into the Minecraft server, mirroring the
 * mc-manager-client's admin broadcast flow (see mc-manager-client's
 * lib/playerCommands.ts: broadcastCommands / adminLabelParts):
 *
 *  1. `tellraw @a <json>`   — the pretty, colored message every player sees.
 *  2. `data modify storage broadcast:log msg set value "..."` — stores a
 *     plain-text record. Its own echo is folded by the web console's quiet
 *     rules, but the record persists for the next command to read back.
 *  3. `data get storage broadcast:log` — reads the record back; since
 *     tellraw itself prints nothing to the console/log, this is what
 *     actually carries the message into the console output and log file
 *     (and, incidentally, into mc-manager-server's log hub — but it's
 *     filtered out on our side since it doesn't match the "<name> message"
 *     chat pattern we listen for, so it can't loop back into Discord).
 */
import { sendCommand } from './consoleStream.js';

const BROADCAST_STORAGE = 'broadcast:log';
const MAX_MESSAGE_LENGTH = 256;

// Discord's brand color, used to visually distinguish these messages from
// player chat and from the site's "[Admin]" broadcasts (gold/aqua).
const DISCORD_BLURPLE = '#5865F2';

// Collapses newlines so a single Discord message can't smuggle a second
// console command onto its own line.
function sanitizeText(input: string): string {
  return input.replace(/[\r\n]+/g, ' ').trim();
}

// An SNBT string literal: wrap in quotes and escape the two special characters.
function snbt(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function discordLabelParts(username: string, nameColor: string): Record<string, unknown>[] {
  return [
    { text: '[', color: 'gray' },
    { text: 'Discord', color: DISCORD_BLURPLE, bold: true },
    { text: ']', color: 'gray' },
    { text: ` ${username}`, color: nameColor, bold: true },
  ];
}

/**
 * Broadcasts a Discord chat message into the Minecraft server's chat and
 * console log. `nameColor` should be the sender's Discord role color as a
 * "#RRGGBB" hex string (Minecraft's tellraw supports hex colors directly);
 * pass undefined to fall back to a neutral white for users with no colored role.
 */
export function broadcastDiscordMessageToMinecraft(username: string, message: string, nameColor?: string): void {
  const name = sanitizeText(username);
  const msg = sanitizeText(message).slice(0, MAX_MESSAGE_LENGTH);
  if (!name || !msg) return;

  const color = nameColor && /^#[0-9a-fA-F]{6}$/.test(nameColor) ? nameColor : '#FFFFFF';

  const record = `[Discord] ${name}: ${msg}`;
  const component = [
    '',
    ...discordLabelParts(name, color),
    { text: ': ', color: 'gray' },
    { text: msg, color: 'white' },
  ];

  sendCommand(`tellraw @a ${JSON.stringify(component)}`);
  sendCommand(`data modify storage ${BROADCAST_STORAGE} msg set value ${snbt(record)}`);
  sendCommand(`data get storage ${BROADCAST_STORAGE}`);
}
