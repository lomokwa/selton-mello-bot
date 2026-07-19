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

// Standard vanilla/Fabric server log format for chat messages:
// "[HH:MM:SS] [Server thread/INFO]: <username> message text"
const CHAT_LINE_PATTERN = /\[Server thread\/INFO\]: <([^>]+)> (.*)$/;
const LOG_TIMESTAMP_PATTERN = /^\[(\d{2}):(\d{2}):(\d{2})\]/;

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

async function connect(onChatMessage: ChatMessageHandler): Promise<void> {
  if (stopped) return;

  let token: string;
  try {
    token = await getToken();
  } catch (error) {
    console.error('mc-manager: failed to obtain token, retrying:', error);
    scheduleReconnect(onChatMessage);
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
    socket.terminate();
    scheduleReconnect(onChatMessage);
  });

  socket.on('message', (data) => {
    const line = data.toString();
    if (isReplayedLine(line, connectedAt)) return;

    const chat = parseChatLine(line);
    if (chat) {
      onChatMessage(chat);
    }
  });

  socket.on('close', (code) => {
    console.log(`mc-manager: console stream closed (code ${code}), reconnecting...`);
    scheduleReconnect(onChatMessage);
  });

  socket.on('error', (error) => {
    console.error('mc-manager: console stream error:', error);
  });
}

function scheduleReconnect(onChatMessage: ChatMessageHandler): void {
  if (stopped) return;
  const delay = Math.min(RECONNECT_DELAY_MS * 2 ** reconnectAttempt, MAX_RECONNECT_DELAY_MS);
  reconnectAttempt += 1;
  setTimeout(() => connect(onChatMessage), delay);
}

/** Starts streaming Minecraft chat messages, reconnecting automatically on failure. */
export function startConsoleStream(onChatMessage: ChatMessageHandler): void {
  stopped = false;
  connect(onChatMessage);
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
