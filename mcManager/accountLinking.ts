/**
 * Discord <-> Minecraft account linking.
 *
 * Linking can be started from either side (see commands/link.ts for the
 * Discord-facing slash command and app.ts's chat-line handling for the
 * in-game trigger):
 *  - From Discord: `/link start <username>` validates the username, checks
 *    it isn't already claimed by a different Discord account, then whispers
 *    a one-time numeric code to that player in-game via `tellraw`.
 *  - From Minecraft: typing `!link` in chat whispers a one-time code back to
 *    that player the same way (see requestLinkFromMinecraft).
 * Either way, the player then runs `/link confirm <code>` in Discord with
 * the code they saw in their private Minecraft chat. If it matches a
 * pending request and hasn't expired, the accounts are linked.
 *
 * The code is only ever delivered in-game and is never echoed back to
 * whichever side requested it — that's what proves the Discord user
 * actually controls the Minecraft account (they had to read the whisper).
 *
 * The whisper is sent with `tellraw <player> <json>` rather than `/tell` or
 * `/msg`: those produce a "You whisper to <player>: ..." feedback line that
 * the server logs to console (and mc-manager-server's console hub relays to
 * every subscriber), which would leak the code to anyone watching the
 * console. `tellraw` prints nothing to the console/log (see the doc comment
 * in discordBroadcast.ts, which relies on that same fact — and has to work
 * around it with a data-storage round trip to get chat lines *into* the log,
 * which is the opposite of what we want here).
 */
import { randomInt } from 'node:crypto';
import { sendCommand } from './consoleStream.js';
import { getDiscordUserIdForMinecraftUsername, linkAccount } from '../db/accountLinks.js';

const CODE_LENGTH = 6;
const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Vanilla/Fabric Minecraft username rules: 3-16 letters, digits, or underscores.
const MINECRAFT_USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;

export function isValidMinecraftUsername(username: string): boolean {
  return MINECRAFT_USERNAME_PATTERN.test(username);
}

/** Generates a zero-padded numeric one-time code, e.g. "042817". */
export function generateLinkCode(): string {
  return randomInt(0, 10 ** CODE_LENGTH).toString().padStart(CODE_LENGTH, '0');
}

/**
 * Builds the in-game whisper command that delivers a link code to a player,
 * as a `tellraw` targeted at just that player (so it's never printed to the
 * server console/log — see the module doc comment). Split out from
 * startAccountLink so the exact command string can be unit tested without a
 * live console-stream connection.
 *
 * The confirm command is a clickable text component using the
 * "copy_to_clipboard" click event, so the player can click it in their chat
 * and paste the ready-made `/link confirm code:<code>` straight into
 * Discord instead of retyping the code. The `code:` prefix matches Discord's
 * slash-command option syntax (the confirm subcommand's option is named
 * "code" — see commands/link.ts), so pasting it into the Discord message box
 * populates the `/link confirm` command with the code already filled in.
 * Uses the current (post text-component-rework) snake_case
 * `click_event`/`hover_event` keys — the older camelCase
 * `clickEvent`/`hoverEvent` keys are legacy and silently ignored by the
 * client on the version this server runs, which made the text render as
 * plain, non-interactive text.
 */
export function buildLinkWhisperCommand(minecraftUsername: string, code: string): string {
  const confirmCommand = `/link confirm code:${code}`;
  const component = [
    { text: '[Discord] ', color: '#5865F2', bold: true },
    { text: 'Your account-linking code: ', color: 'white' },
    { text: code, color: 'yellow', bold: true },
    { text: '. Click to copy the confirm command: ', color: 'white' },
    {
      text: confirmCommand,
      color: 'aqua',
      underlined: true,
      click_event: { action: 'copy_to_clipboard', value: confirmCommand },
      hover_event: { action: 'show_text', value: `Copy "${confirmCommand}" to your clipboard` },
    },
    { text: ' — paste it in Discord (expires in 5 minutes).', color: 'white' },
  ];
  return `tellraw ${minecraftUsername} ${JSON.stringify(component)}`;
}

/** Builds the in-game whisper telling a player their account is already linked. */
export function buildAlreadyLinkedWhisperCommand(minecraftUsername: string): string {
  const component = [
    { text: '[Discord] ', color: '#5865F2', bold: true },
    {
      text: 'This account is already linked to a Discord account. Run /link unlink in Discord first if you want to relink.',
      color: 'white',
    },
  ];
  return `tellraw ${minecraftUsername} ${JSON.stringify(component)}`;
}

interface PendingLink {
  minecraftUsername: string;
  expiresAt: number;
}

// code -> pending link request awaiting confirmation, from either
// `/link start` (Discord-initiated) or `!link` typed in-game
// (Minecraft-initiated). Keyed by code rather than by Discord user ID, since
// the Minecraft-initiated flow doesn't know the Discord user's ID until they
// run `/link confirm` — the code itself (only ever seen in the private
// in-game whisper) is what proves ownership either way. Kept in-memory (like
// app.ts's chatWebhooks cache) since codes are short-lived — losing pending
// requests on a bot restart just means the player starts over.
const pendingLinks = new Map<string, PendingLink>();

export type StartLinkResult =
  | { ok: true }
  | { ok: false; reason: 'invalid-username' | 'already-linked-elsewhere' | 'whisper-failed' };

/**
 * Kicks off account linking from Discord (`/link start <username>`):
 * validates the username, checks it isn't already claimed by a different
 * Discord account, then whispers a one-time code to the player in-game.
 */
export function startAccountLink(discordUserId: string, minecraftUsername: string): StartLinkResult {
  if (!isValidMinecraftUsername(minecraftUsername)) {
    return { ok: false, reason: 'invalid-username' };
  }

  const existingOwner = getDiscordUserIdForMinecraftUsername(minecraftUsername);
  if (existingOwner && existingOwner !== discordUserId) {
    return { ok: false, reason: 'already-linked-elsewhere' };
  }

  const code = generateLinkCode();
  const sent = sendCommand(buildLinkWhisperCommand(minecraftUsername, code));
  if (!sent) {
    return { ok: false, reason: 'whisper-failed' };
  }

  pendingLinks.set(code, { minecraftUsername, expiresAt: Date.now() + CODE_TTL_MS });
  return { ok: true };
}

export type RequestLinkFromMinecraftResult =
  | { ok: true }
  | { ok: false; reason: 'already-linked' | 'whisper-failed' };

/**
 * Kicks off account linking from Minecraft (player types `!link` in chat —
 * see the chat-line handling in app.ts): whispers a one-time code back to
 * them, to be confirmed with `/link confirm <code>` in Discord. Unlike
 * startAccountLink, there's no Discord user ID yet to check ownership
 * against, so an already-linked account is rejected outright rather than
 * allowed to "relink" — the player has no way to specify a different Discord
 * account from in-game, so they're pointed at `/link unlink` instead.
 */
export function requestLinkFromMinecraft(minecraftUsername: string): RequestLinkFromMinecraftResult {
  const existingOwner = getDiscordUserIdForMinecraftUsername(minecraftUsername);
  if (existingOwner) {
    sendCommand(buildAlreadyLinkedWhisperCommand(minecraftUsername));
    return { ok: false, reason: 'already-linked' };
  }

  const code = generateLinkCode();
  const sent = sendCommand(buildLinkWhisperCommand(minecraftUsername, code));
  if (!sent) {
    return { ok: false, reason: 'whisper-failed' };
  }

  pendingLinks.set(code, { minecraftUsername, expiresAt: Date.now() + CODE_TTL_MS });
  return { ok: true };
}

export type ConfirmLinkResult =
  | { ok: true; minecraftUsername: string }
  | { ok: false; reason: 'invalid-code' | 'expired' | 'already-linked-elsewhere' };

/** Confirms a pending link request if the code matches and hasn't expired. */
export function confirmAccountLink(discordUserId: string, code: string): ConfirmLinkResult {
  const trimmedCode = code.trim();
  const pending = pendingLinks.get(trimmedCode);
  if (!pending) {
    return { ok: false, reason: 'invalid-code' };
  }

  if (Date.now() > pending.expiresAt) {
    pendingLinks.delete(trimmedCode);
    return { ok: false, reason: 'expired' };
  }

  // Re-check in case someone else claimed the username while this request was pending.
  const existingOwner = getDiscordUserIdForMinecraftUsername(pending.minecraftUsername);
  if (existingOwner && existingOwner !== discordUserId) {
    pendingLinks.delete(trimmedCode);
    return { ok: false, reason: 'already-linked-elsewhere' };
  }

  linkAccount(discordUserId, pending.minecraftUsername);
  pendingLinks.delete(trimmedCode);
  return { ok: true, minecraftUsername: pending.minecraftUsername };
}
