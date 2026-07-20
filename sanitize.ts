/**
 * Pure text-sanitization helpers used when relaying Minecraft chat into
 * Discord. Split out from app.ts so they can be unit tested without pulling
 * in discord.js client setup / bot.login() side effects.
 */

// Discord's custom emoji syntax: <:name:id> or <a:name:id> for animated ones.
// Matches Discord's own constraints (2-32 word chars for the name, a numeric
// snowflake ID) so players can reference real custom emoji from Minecraft
// chat (e.g. typing "<:PogU:531255068251521024>") and have them render.
const CUSTOM_EMOJI_PATTERN = /<a?:\w{2,32}:\d{17,20}>/g;

// Escapes Discord markdown and mention triggers in untrusted chat message text
// (Minecraft player messages) so players can't format text or ping @everyone/@here.
// Custom emoji tokens are protected from the ">" escaping below so they still
// render as real emoji instead of literal "<:name:id\>" text.
export function sanitizeMessageContent(text: string): string {
  const emojis: string[] = [];
  const withPlaceholders = text.replace(CUSTOM_EMOJI_PATTERN, (match) => {
    emojis.push(match);
    return `\u0000${emojis.length - 1}\u0000`;
  });

  const escaped = withPlaceholders
    .replace(/[\\*_~`|>]/g, '\\$&')
    .replace(/@(everyone|here)/g, '@\u200b$1');

  return escaped.replace(/\u0000(\d+)\u0000/g, (_, index: string) => emojis[Number(index)]);
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
