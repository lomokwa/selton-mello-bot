/**
 * Pure text-sanitization helpers used when relaying Minecraft chat into
 * Discord. Split out from app.ts so they can be unit tested without pulling
 * in discord.js client setup / bot.login() side effects.
 */

// Escapes Discord markdown and mention triggers in untrusted chat message text
// (Minecraft player messages) so players can't format text or ping @everyone/@here.
export function sanitizeMessageContent(text: string): string {
  return text
    .replace(/[\\*_~`|>]/g, '\\$&')
    .replace(/@(everyone|here)/g, '@\u200b$1');
}

// Webhook usernames aren't markdown-rendered, so no escaping is needed there —
// just enforce Discord's constraints (1-80 chars, no "discord" substring, no
// leading/trailing whitespace) so mc-manager can't send an invalid username.
export function sanitizeWebhookUsername(username: string): string {
  const cleaned = username.replace(/discord/gi, 'disc\u200bord').trim();
  return cleaned.slice(0, 80) || 'Unknown Player';
}

// Returns a rendered player-head avatar for the given Minecraft username.
export function getPlayerHeadUrl(username: string): string {
  return `https://mc-heads.net/avatar/${encodeURIComponent(username)}/100`;
}
