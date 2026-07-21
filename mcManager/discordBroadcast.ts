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

// Warning-orange, used for the "[DEV]" tag so it's unmistakably different
// from every other color already in use (Discord blurple, admin gold/aqua).
const DEV_TAG_COLOR = '#FFA500';

// Collapses newlines so a single Discord message can't smuggle a second
// console command onto its own line.
function sanitizeText(input: string): string {
  return input.replace(/[\r\n]+/g, ' ').trim();
}

/** Who a relayed Discord message was replying to, and a short preview of what that message said — see
 *  buildReplySnippet(). Undefined entirely when the message wasn't a reply. */
export interface ReplyContext {
  authorName: string;
  snippet: string;
}

const REPLY_SNIPPET_MAX_LENGTH = 60;

/** Truncates a replied-to message's content to a short one-line preview for the in-game reply indicator —
 *  same newline-collapsing as sanitizeText, since the original could itself be multi-line. */
export function buildReplySnippet(content: string): string {
  const flat = sanitizeText(content);
  if (!flat) return '(sem texto)';
  return flat.length > REPLY_SNIPPET_MAX_LENGTH ? `${flat.slice(0, REPLY_SNIPPET_MAX_LENGTH)}...` : flat;
}

// An SNBT string literal: wrap in quotes and escape the two special characters.
function snbt(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function discordLabelParts(username: string, nameColor: string, isDev: boolean): Record<string, unknown>[] {
  return [
    ...(isDev ? [{ text: '[DEV] ', color: DEV_TAG_COLOR, bold: true }] : []),
    { text: '<', color: 'gray' },
    { text: '🎮', color: DISCORD_BLURPLE, bold: true },
    { text: ` ${username}`, color: nameColor, bold: true },
    { text: '>', color: 'gray' },
  ];
}

/**
 * Broadcasts a Discord chat message into the Minecraft server's chat and
 * console log. `nameColor` should be the sender's Discord role color as a
 * "#RRGGBB" hex string (Minecraft's tellraw supports hex colors directly);
 * pass undefined to fall back to a neutral white for users with no colored role.
 * `isDev` tags the message with "[DEV]" — set this when relaying from a dev
 * bot instance (see GUILD_ID in .env.dev), since dev and prod bots can share
 * the same Minecraft server and players need to tell test chatter apart from
 * a real Discord relay.
 */
export function broadcastDiscordMessageToMinecraft(
  username: string,
  message: string,
  nameColor?: string,
  isDev = false,
  replyTo?: ReplyContext,
): void {
  const commands = buildBroadcastCommands(username, message, nameColor, isDev, replyTo);
  if (!commands) return;

  for (const command of commands) {
    sendCommand(command);
  }
}

/**
 * Builds the 3 console commands that make up a Discord->Minecraft broadcast
 * (see the module-level doc comment), without sending them anywhere. Split
 * out from broadcastDiscordMessageToMinecraft so the exact command strings
 * can be unit tested independently of the live WebSocket connection.
 * Returns null if the sanitized username or message end up empty.
 */
export function buildBroadcastCommands(
  username: string,
  message: string,
  nameColor?: string,
  isDev = false,
  replyTo?: ReplyContext,
): string[] | null {
  const name = sanitizeText(username);
  const msg = sanitizeText(message).slice(0, MAX_MESSAGE_LENGTH);
  if (!name || !msg) return null;

  const color = nameColor && /^#[0-9a-fA-F]{6}$/.test(nameColor) ? nameColor : '#FFFFFF';

  // "\n" inside a single tellraw text component renders as a real line break in chat, so the reply indicator
  // and the actual message land as ONE chat entry (indicator on top, message below), not two separate ones.
  const replyAuthor = replyTo ? sanitizeText(replyTo.authorName) : '';
  const replyLine = replyTo && replyAuthor ? `↱ Resposta a ${replyAuthor}: ${replyTo.snippet}\n` : '';

  const record = `${isDev ? '[DEV] ' : ''}${replyLine ? `[${replyLine.slice(0, -1)}] ` : ''}<🎮 ${name}> ${msg}`;
  const component = [
    '',
    ...(replyLine ? [{ text: replyLine, color: 'gray' }] : []),
    ...discordLabelParts(name, color, isDev),
    { text: ' ', color: 'gray' },
    { text: msg, color: 'white' },
  ];

  return [
    `tellraw @a ${JSON.stringify(component)}`,
    `data modify storage ${BROADCAST_STORAGE} msg set value ${snbt(record)}`,
    `data get storage ${BROADCAST_STORAGE}`,
  ];
}
