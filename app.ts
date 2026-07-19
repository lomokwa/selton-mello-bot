import 'dotenv/config';
import { Client, GatewayIntentBits, Events, Guild, Webhook, Collection, Message } from 'discord.js';
import { resolveIntroChannelId, getGuildsWithBotChannel, getBotChannelId } from './db/guildSettings.js';
import { commandsByName } from './commands/index.js';
import { startConsoleStream, ChatMessage } from './mcManager/consoleStream.js';
import { broadcastDiscordMessageToMinecraft } from './mcManager/discordBroadcast.js';
import { sanitizeMessageContent, sanitizeWebhookUsername, getPlayerHeadUrl } from './sanitize.js';

const token = process.env.DISCORD_TOKEN;

if (!token) {
  throw new Error('DISCORD_TOKEN environment variable is required');
}

export const bot = new Client({
  // MessageContent is a privileged intent — enable it for this bot in the
  // Discord Developer Portal (Bot > Privileged Gateway Intents) or message
  // text will always arrive empty.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

bot.once(Events.ClientReady, (readyClient: Client<true>) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
  startConsoleStream(broadcastMinecraftChatMessage);
});

const introMessage =
  `Salve o Selton Mello \n\n Use "/help para ver todos os comandos disponiveis`;

// Posts a one-time intro message explaining the bot when it joins a new server
bot.on(Events.GuildCreate, async (guild: Guild) => {
  console.log(`Joined new guild: ${guild.name} (${guild.id})`);

  try {
    const introChannelId = await resolveIntroChannelId(guild);
    if (!introChannelId) {
      console.error(`Could not find a channel to post the intro message in for guild ${guild.name} (${guild.id})`);
      return;
    }

    const channel = await guild.channels.fetch(introChannelId);
    if (channel && channel.isTextBased() && 'send' in channel) {
      await channel.send(introMessage);
      console.log(`Posted intro message in channel ${introChannelId} for guild ${guild.name} (${guild.id})`);
    }
  } catch (error) {
    console.error(`Failed to post intro message for guild ${guild.name} (${guild.id}):`, error);
  }
});

// Handles slash command interactions
bot.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const guildLabel = interaction.guild ? `${interaction.guild.name} (${interaction.guildId})` : 'DM';
  console.log(`/${interaction.commandName} invoked by ${interaction.user.tag} in ${guildLabel}`);

  const command = commandsByName.get(interaction.commandName);
  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  const startTime = Date.now();
  try {
    await command.execute(interaction);
    console.log(`/${interaction.commandName} completed in ${Date.now() - startTime}ms`);
  } catch (error) {
    console.error(`Error executing command ${interaction.commandName}:`, error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: 'There was an error executing this command.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'There was an error executing this command.', ephemeral: true });
    }
  }
});

// Relays chat messages sent in a guild's configured bot channel into the
// Minecraft server (the reverse direction of broadcastMinecraftChatMessage).
bot.on(Events.MessageCreate, async (message: Message) => {
  if (!message.guildId || !message.inGuild()) return;
  // Ignore bots and webhooks — critically, this also ignores our own
  // "Minecraft Chat" webhook, so relayed Minecraft chat can't loop back.
  if (message.author.bot || message.webhookId) return;
  if (!message.content.trim()) return;

  const botChannelId = getBotChannelId(message.guildId);
  if (message.channelId !== botChannelId) return;

  const member = message.member;
  const displayName = member?.displayName ?? message.author.username;
  // displayColor is 0 when the member has no colored role (or only @everyone) —
  // treat that as "no color" so the broadcast falls back to a neutral white
  // instead of literally coloring the name black.
  const nameColor = member && member.displayColor !== 0 ? member.displayHexColor : undefined;

  console.log(`Relaying Discord message from ${message.author.tag} to Minecraft: ${message.content}`);
  try {
    broadcastDiscordMessageToMinecraft(displayName, message.content, nameColor);
  } catch (error) {
    console.error('Failed to relay Discord message to Minecraft:', error);
  }
});

bot.login(token).catch((error) => {
  console.error('Failed to log in to Discord:', error);
  process.exitCode = 1;
});

const WEBHOOK_NAME = 'Minecraft Chat';

// Caches one webhook per channel so we don't re-create/re-fetch it for every chat message.
const chatWebhooks = new Map<string, Webhook>();

// Remembers channels where webhook access recently failed (e.g. missing permissions),
// so we fall back to plain messages instead of retrying + logging on every chat line.
const webhookRetryAfter = new Map<string, number>();
const WEBHOOK_RETRY_COOLDOWN_MS = 5 * 60 * 1000;

// Finds (or creates) the webhook used to post Minecraft chat messages with a
// per-player display name and avatar, rather than a generic bot message.
async function getOrCreateChatWebhook(channel: unknown): Promise<Webhook | null> {
  if (!channel || typeof channel !== 'object' || !('id' in channel)) return null;
  const channelId = (channel as { id: string }).id;

  const cached = chatWebhooks.get(channelId);
  if (cached) return cached;

  const retryAfter = webhookRetryAfter.get(channelId);
  if (retryAfter && Date.now() < retryAfter) return null;

  if (!('fetchWebhooks' in channel) || !('createWebhook' in channel)) {
    console.error(`Channel ${channelId} does not support webhooks`);
    webhookRetryAfter.set(channelId, Date.now() + WEBHOOK_RETRY_COOLDOWN_MS);
    return null;
  }

  const webhookChannel = channel as {
    fetchWebhooks: () => Promise<Collection<string, Webhook>>;
    createWebhook: (options: { name: string; reason?: string }) => Promise<Webhook>;
  };

  try {
    const existingWebhooks = await webhookChannel.fetchWebhooks();
    const existing = existingWebhooks.find(
      (webhook) => webhook.name === WEBHOOK_NAME && webhook.owner?.id === bot.user?.id,
    );

    const webhook =
      existing ??
      (await webhookChannel.createWebhook({
        name: WEBHOOK_NAME,
        reason: 'Used to relay Minecraft chat messages with per-player avatars',
      }));

    chatWebhooks.set(channelId, webhook);
    webhookRetryAfter.delete(channelId);
    return webhook;
  } catch (error) {
    console.error(
      `Missing "Manage Webhooks" permission in channel ${channelId} — falling back to plain messages for ${Math.round(WEBHOOK_RETRY_COOLDOWN_MS / 60000)} min:`,
      error instanceof Error ? error.message : error,
    );
    webhookRetryAfter.set(channelId, Date.now() + WEBHOOK_RETRY_COOLDOWN_MS);
    return null;
  }
}

async function broadcastMinecraftChatMessage(chat: ChatMessage): Promise<void> {
  const username = sanitizeWebhookUsername(chat.username);
  const content = sanitizeMessageContent(chat.message);

  for (const { guildId, botChannelId } of getGuildsWithBotChannel()) {
    try {
      const guild = await bot.guilds.fetch(guildId);
      const channel = await guild.channels.fetch(botChannelId);
      if (!channel || !channel.isTextBased() || !('send' in channel)) continue;

      const webhook = await getOrCreateChatWebhook(channel);
      if (webhook) {
        await webhook.send({
          content,
          username,
          avatarURL: getPlayerHeadUrl(chat.username),
        });
      } else {
        // Fallback if the bot lacks Manage Webhooks permission in this channel.
        // Unlike the webhook path, this is a regular message where markdown renders,
        // so the username needs escaping here too.
        await channel.send(`**${sanitizeMessageContent(username)}**: ${content}`);
      }
    } catch (error) {
      console.error(`Failed to forward Minecraft chat message to guild ${guildId}:`, error);
    }
  }
}

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});
