/**
 * Connects to mc-manager-server's /api/console WebSocket and streams parsed
 * Minecraft chat messages out via a callback, so app.ts can forward them to
 * every guild's configured bot channel.
 *
 * Reconnects automatically with backoff, and forces a fresh JWT (via
 * getToken/invalidateToken) whenever the connection is rejected or drops.
 */
import WebSocket from 'ws';
import { getToken, getWebSocketUrl, invalidateToken } from './client.js';

export interface ChatMessage {
  username: string;
  message: string;
}

export type ChatMessageHandler = (chat: ChatMessage) => void;

/**
 * A non-chat server event bridged to Discord: a player joining/leaving, an
 * advancement/goal/challenge completed, a death, or the Minecraft server
 * process itself stopping/coming back up. `username` is set for every kind
 * except server_down/server_up. `detail` is the advancement name (kind:
 * 'advancement') or the full raw death line, English and untranslated same
 * as the server log (kind: 'death') — Discord-side formatting is app.ts's job.
 */
export interface ServerEvent {
  kind: 'join' | 'leave' | 'advancement' | 'death' | 'server_down' | 'server_up';
  username?: string;
  detail?: string;
}

export type ServerEventHandler = (event: ServerEvent) => void;

// Standard vanilla/Fabric server log format for chat messages:
// "[HH:MM:SS] [Server thread/INFO]: <username> message text"
const CHAT_LINE_PATTERN = /\[Server thread\/INFO\]: <([^>]+)> (.*)$/;
const LOG_TIMESTAMP_PATTERN = /^\[(\d{2}):(\d{2}):(\d{2})\]/;

// Standard vanilla join/leave lines: "PlayerName joined/left the game" (no
// angle brackets — those are chat-only). ".+" rather than a strict username
// charset for the same reason CHAT_LINE_PATTERN is permissive: a display name
// oddity shouldn't silently swallow the event.
const JOIN_LINE_PATTERN = /\[Server thread\/INFO\]: (.+) joined the game$/;
const LEAVE_LINE_PATTERN = /\[Server thread\/INFO\]: (.+) left the game$/;

// Advancements have three message shapes depending on the advancement's frame
// type (task/goal/challenge) — same underlying event, different vanilla verb.
const ADVANCEMENT_LINE_PATTERN =
  /\[Server thread\/INFO\]: (.+) has (?:made the advancement|reached the goal|completed the challenge) \[(.+)\]$/;

// Common vanilla death-message verb phrases. Minecraft has ~80 death message
// variants across every possible cause; this covers the common ones (PvP/mob
// kills, fall, drown, fire/lava, explosion, void, starve, suffocate, magic,
// lightning, cactus/thorns, freeze) rather than an exhaustive per-version
// list — an unmatched rare death simply isn't bridged, it's never mis-bridged.
const DEATH_VERB_FRAGMENTS = [
  'was slain by', 'was shot by', 'was fireballed by', 'was killed by', 'was pummeled by',
  'was impaled by', 'was stung to death', 'was poked to death', 'was killed trying to hurt',
  'drowned', 'starved to death', 'suffocated in a wall', 'was squished too much',
  'was squashed by a falling anvil', 'was squashed by a falling block', 'was crushed by',
  'fell from a high place', 'fell off', 'fell out of the world', 'was doomed to fall',
  'hit the ground too hard', 'left the confines of this world', 'fell while climbing',
  'went up in flames', 'walked into a fire', 'burned to death', 'was burnt to a crisp',
  'tried to swim in lava', 'discovered the floor was lava', 'walked into danger zone',
  'was struck by lightning', 'went off with a bang', 'was blown up by', 'blew up',
  'was killed by magic', 'withered away', 'was pricked to death', 'walked into a cactus',
  'froze to death', 'was frozen to death', 'experienced kinetic energy',
  'was impaled on a stalagmite', 'was skewered by a falling stalactite',
];
const DEATH_LINE_PATTERN = new RegExp(
  String.raw`\[Server thread\/INFO\]: (\w{1,16}) (?:${DEATH_VERB_FRAGMENTS.join('|')}).*$`,
);

// The Minecraft server process's own lifecycle lines (not mc-manager-server's
// WebSocket connection state, which can drop/reconnect for unrelated reasons
// — these are the real signal for "is the game itself up").
const SERVER_DOWN_LINE_PATTERN = /\[Server thread\/INFO\]: Stopping the server$/;
const SERVER_UP_LINE_PATTERN = /\[Server thread\/INFO\]: Done \([0-9.]+s\)! For help, type "help"/;

/** Tries every non-chat event pattern against a raw console line, in order. Returns null for chat or unrelated lines. */
export function parseServerEvent(line: string): ServerEvent | null {
  let match = JOIN_LINE_PATTERN.exec(line);
  if (match) return { kind: 'join', username: match[1] };

  match = LEAVE_LINE_PATTERN.exec(line);
  if (match) return { kind: 'leave', username: match[1] };

  match = ADVANCEMENT_LINE_PATTERN.exec(line);
  if (match) return { kind: 'advancement', username: match[1], detail: match[2] };

  if (SERVER_DOWN_LINE_PATTERN.test(line)) return { kind: 'server_down' };
  if (SERVER_UP_LINE_PATTERN.test(line)) return { kind: 'server_up' };

  match = DEATH_LINE_PATTERN.exec(line);
  if (match) return { kind: 'death', username: match[1], detail: line.replace(/^.*\[Server thread\/INFO\]: /, '') };

  return null;
}

// mc-manager-server's console hub replays its ~200-line history buffer to
// every new WebSocket subscriber, so on (re)connect we'd otherwise re-post old
// chat as if it just happened. Replayed lines keep their original timestamp,
// which will always be at/before the moment we opened this connection — live
// lines are always produced after that point. A small clock-skew allowance
// covers minor drift between the bot's clock and the Minecraft server's clock.
//
// The Minecraft server logs timestamps in its own local time (commonly UTC on
// headless/homelab setups), not the bot's local timezone, so we parse them as
// UTC rather than using Date's local-time constructor.
const CLOCK_SKEW_TOLERANCE_MS = 2_000;

export function isReplayedLine(line: string, connectedAt: number): boolean {
  const match = LOG_TIMESTAMP_PATTERN.exec(line);
  if (!match) return false; // no timestamp to compare against — assume it's live

  const [, hours, minutes, seconds] = match;
  const connectedAtDate = new Date(connectedAt);
  let lineTimeMs = Date.UTC(
    connectedAtDate.getUTCFullYear(),
    connectedAtDate.getUTCMonth(),
    connectedAtDate.getUTCDate(),
    Number(hours),
    Number(minutes),
    Number(seconds),
  );

  // If the line's time-of-day appears to be more than 12h ahead of the
  // connection time, it's almost certainly from just before a UTC day
  // rollover (e.g. connected at 00:01 UTC, line stamped 23:59 the prior day).
  if (lineTimeMs - connectedAt > 12 * 60 * 60 * 1000) {
    lineTimeMs -= 24 * 60 * 60 * 1000;
  }

  return lineTimeMs <= connectedAt - CLOCK_SKEW_TOLERANCE_MS;
}

export function parseChatLine(line: string): ChatMessage | null {
  const match = CHAT_LINE_PATTERN.exec(line);
  if (!match) {
    return null;
  }
  return { username: match[1], message: match[2] };
}

const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_DELAY_MS = 60000;

let reconnectAttempt = 0;
let currentSocket: WebSocket | null = null;
let stopped = false;

async function connect(onChatMessage: ChatMessageHandler, onServerEvent?: ServerEventHandler): Promise<void> {
  if (stopped) return;

  let token: string;
  try {
    token = await getToken();
  } catch (error) {
    console.error('mc-manager: failed to obtain token, retrying:', error);
    scheduleReconnect(onChatMessage, onServerEvent);
    return;
  }

  const url = getWebSocketUrl(`/api/console?token=${encodeURIComponent(token)}`);
  const socket = new WebSocket(url);
  currentSocket = socket;

  let connectedAt = Date.now();

  socket.on('open', () => {
    reconnectAttempt = 0;
    connectedAt = Date.now();
    console.log('mc-manager: connected to console stream');
  });

  socket.on('unexpected-response', (_req, res) => {
    console.error(`mc-manager: console stream rejected with HTTP ${res.statusCode}`);
    if (res.statusCode === 401) {
      invalidateToken();
    }
    // Don't call scheduleReconnect here: terminate() on a still-CONNECTING
    // socket (which this always is at this point) runs ws's abortHandshake
    // path, which emits 'close' — and that handler already schedules a
    // reconnect. Scheduling one here too would open two concurrent sockets,
    // both relaying every chat line into Discord (i.e. duplicate messages).
    socket.terminate();
  });

  socket.on('message', (data) => {
    const line = data.toString();
    if (isReplayedLine(line, connectedAt)) return;

    const chat = parseChatLine(line);
    if (chat) {
      onChatMessage(chat);
      return; // a chat line never also matches a server-event pattern
    }
    const event = parseServerEvent(line);
    if (event) {
      onServerEvent?.(event);
    }
  });

  socket.on('close', (code) => {
    console.log(`mc-manager: console stream closed (code ${code}), reconnecting...`);
    scheduleReconnect(onChatMessage, onServerEvent);
  });

  socket.on('error', (error) => {
    console.error('mc-manager: console stream error:', error);
  });
}

function scheduleReconnect(onChatMessage: ChatMessageHandler, onServerEvent?: ServerEventHandler): void {
  if (stopped) return;
  const delay = Math.min(RECONNECT_DELAY_MS * 2 ** reconnectAttempt, MAX_RECONNECT_DELAY_MS);
  reconnectAttempt += 1;
  setTimeout(() => connect(onChatMessage, onServerEvent), delay);
}

/**
 * Starts streaming Minecraft chat messages, reconnecting automatically on
 * failure. `onServerEvent` is optional (joins/leaves/advancements/deaths/
 * server up-down) — passing it enables the richer Discord bridge in app.ts;
 * omitting it keeps the original chat-only behavior for any other caller.
 */
export function startConsoleStream(onChatMessage: ChatMessageHandler, onServerEvent?: ServerEventHandler): void {
  stopped = false;
  connect(onChatMessage, onServerEvent);
}

/** Stops streaming and closes the current connection, if any. */
export function stopConsoleStream(): void {
  stopped = true;
  currentSocket?.close();
  currentSocket = null;
}

/**
 * Sends a raw console command over the same WebSocket used for the log
 * stream — mc-manager-server relays any text a client sends straight to the
 * Minecraft server's stdin. Returns false (and logs a warning) if there's no
 * live connection to send over; commands are best-effort, not queued.
 */
export function sendCommand(command: string): boolean {
  if (!currentSocket || currentSocket.readyState !== WebSocket.OPEN) {
    console.warn('mc-manager: cannot send command, console stream is not connected:', command);
    return false;
  }
  currentSocket.send(command);
  return true;
}
