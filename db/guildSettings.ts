import { ChannelType, Guild } from 'discord.js';
import { db } from './database.js';

interface GuildSettingsRow {
  guildId: string;
  botChannelId: string | null;
  statusMessageId: string | null;
}

const getStmt = db.prepare<[string], GuildSettingsRow>(
  'SELECT guildId, botChannelId, statusMessageId FROM guild_settings WHERE guildId = ?'
);
const upsertBotChannelStmt = db.prepare<[string, string]>(
  `INSERT INTO guild_settings (guildId, botChannelId) VALUES (?, ?)
   ON CONFLICT(guildId) DO UPDATE SET botChannelId = excluded.botChannelId`
);
const upsertStatusMessageStmt = db.prepare<[string, string]>(
  `INSERT INTO guild_settings (guildId, statusMessageId) VALUES (?, ?)
   ON CONFLICT(guildId) DO UPDATE SET statusMessageId = excluded.statusMessageId`
);
const listBotChannelsStmt = db.prepare<[], Pick<GuildSettingsRow, 'guildId' | 'botChannelId'>>(
  'SELECT guildId, botChannelId FROM guild_settings WHERE botChannelId IS NOT NULL'
);

/**
 * Returns the guild's configured bot channel (used for join/leave messages and
 * Minecraft chat streaming), or null if an admin hasn't set one yet via
 * /setbotchannel. Unlike the intro channel, this is never auto-picked, so the
 * bot doesn't spam a channel the admin didn't choose.
 */
export function getBotChannelId(guildId: string): string | null {
  const row = getStmt.get(guildId);
  return row?.botChannelId ?? null;
}

export function setBotChannelId(guildId: string, channelId: string): void {
  upsertBotChannelStmt.run(guildId, channelId);
}

/** Returns every guild that has a bot channel configured, for broadcasting updates. */
export function getGuildsWithBotChannel(): Array<{ guildId: string; botChannelId: string }> {
  return listBotChannelsStmt
    .all()
    .filter((row): row is { guildId: string; botChannelId: string } => row.botChannelId !== null);
}

export function getStatusMessageId(guildId: string): string | null {
  const row = getStmt.get(guildId);
  return row?.statusMessageId ?? null;
}

export function setStatusMessageId(guildId: string, messageId: string): void {
  upsertStatusMessageStmt.run(guildId, messageId);
}


/**
 * Picks a sensible channel for the one-time intro message posted when the bot
 * joins a new server: the guild's configured system channel if the bot can
 * post there, otherwise the first text channel the bot has permission to send
 * messages in. This is not persisted — it's just where the intro gets posted.
 */
export async function resolveIntroChannelId(guild: Guild): Promise<string | null> {
  const me = guild.members.me ?? (await guild.members.fetchMe());

  const systemChannel = guild.systemChannel;
  if (systemChannel && systemChannel.permissionsFor(me).has('SendMessages')) {
    return systemChannel.id;
  }

  const channels = await guild.channels.fetch();
  const fallbackChannel = channels.find(
    (channel) =>
      channel !== null &&
      channel.type === ChannelType.GuildText &&
      channel.permissionsFor(me).has('SendMessages')
  );

  return fallbackChannel?.id ?? null;
}
