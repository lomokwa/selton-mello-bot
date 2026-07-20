import 'dotenv/config';
import { Client, GatewayIntentBits, Events, Guild, Webhook, Collection, Message } from 'discord.js';
import { resolveIntroChannelId, getGuildsWithBotChannel, getBotChannelId } from './db/guildSettings.js';
import { commandsByName } from './commands/index.js';
import { startConsoleStream, ChatMessage } from './mcManager/consoleStream.js';
import { broadcastDiscordMessageToMinecraft } from './mcManager/discordBroadcast.js';
import { requestLinkFromMinecraft } from './mcManager/accountLinking.js';
import { sanitizeMessageContent, sanitizeWebhookUsername, getPlayerHeadUrl } from './sanitize.js';

const token = process.env.DISCORD_TOKEN;

if (!token) {
  throw new Error('DISCORD_TOKEN environment variable is required');
}

// Same "GUILD_ID is set" signal deploy-commands.ts uses to distinguish a dev
// bot (guild-scoped commands) from prod (global commands) — see .env.dev.
// Dev and prod bots can share the same Minecraft server (mc-manager-server
// supports multiple simultaneous subscribers), so Minecraft-bound messages
// get a "[DEV]" tag to keep test chatter distinguishable from a real relay.
const isDevMode = Boolean(process.env.GUILD_ID);

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

  const member = message.member;
  const displayName = member?.displayName ?? message.author.username;
  // displayColor is 0 when the member has no colored role (or only @everyone) —
  // treat that as "no color" so the broadcast falls back to a neutral white
  // instead of literally coloring the name black.
  const nameColor = member && member.displayColor !== 0 ? member.displayHexColor : undefined;

  // Easter egg: reply "Selton Mello" whenever the phrase appears in a message,
  // regardless of case or surrounding text, and relay it into Minecraft too.
  if (message.content.toLowerCase().includes('selton mello')) {
    try {
      await message.reply('Selton Mello');
    } catch (error) {
      console.error('Failed to reply with "Selton Mello":', error);
    }
    try {
      // Attribute this to the bot itself, not the triggering user.
      broadcastDiscordMessageToMinecraft('Selton Mello', 'Selton Mello', undefined, isDevMode);
    } catch (error) {
      console.error('Failed to relay "Selton Mello" reply to Minecraft:', error);
    }
  }

  const botChannelId = getBotChannelId(message.guildId);
  if (message.channelId !== botChannelId) return;

  console.log(`Relaying Discord message from ${message.author.tag} to Minecraft: ${message.content}`);
  try {
    broadcastDiscordMessageToMinecraft(displayName, message.content, nameColor, isDevMode);
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

// In-game trigger for account linking (see mcManager/accountLinking.ts):
// typing this in Minecraft chat whispers a one-time code back to the player,
// which they confirm with /link confirm <code> in Discord.
const LINK_TRIGGER = '!link';

// Matches "@name" tokens a player can type in Minecraft chat to ping a Discord
// user, using Discord's own username character set (lowercase letters,
// digits, underscores, periods; 2-32 chars).
const MENTION_PATTERN = /@([a-z0-9_.]{2,32})/gi;

// Resolves "@name" tokens in Minecraft chat text into real Discord mentions
// for the given guild, so players can ping someone by typing e.g. "@lomokwa".
// Uses the REST member-search endpoint (no privileged Members intent needed)
// and only pings on an exact username/nickname match to avoid mis-pinging the
// wrong person off a fuzzy prefix match.
async function resolveMinecraftMentions(guild: Guild, text: string): Promise<string> {
  const names = new Set([...text.matchAll(MENTION_PATTERN)].map((match) => match[1]));
  if (names.size === 0) return text;

  const mentionsByName = new Map<string, string>();
  await Promise.all(
    [...names].map(async (name) => {
      try {
        const results = await guild.members.search({ query: name, limit: 1 });
        const member = results.first();
        if (
          member &&
          (member.user.username.toLowerCase() === name.toLowerCase() ||
            member.displayName.toLowerCase() === name.toLowerCase())
        ) {
          mentionsByName.set(name.toLowerCase(), `<@${member.id}>`);
        }
      } catch (error) {
        console.error(`Failed to resolve Minecraft "@${name}" mention in guild ${guild.id}:`, error);
      }
    }),
  );
  if (mentionsByName.size === 0) return text;

  return text.replace(MENTION_PATTERN, (full, name: string) => mentionsByName.get(name.toLowerCase()) ?? full);
}

// Matches ":name:" tokens a player can type in Minecraft chat to reference a
// custom Discord emoji by name (e.g. ":Pepega:"), using Discord's own custom
// emoji name character set (letters, digits, underscores; 2-32 chars).
const EMOJI_NAME_PATTERN = /:([a-zA-Z0-9_]{2,32}):/g;

// Resolves ":name:" tokens into real "<:name:id>" (or "<a:name:id>" for
// animated) custom emoji syntax for the given guild, so players don't need to
// know/type the emoji's numeric ID. Uses the REST emoji-list endpoint, which
// (like member search above) doesn't require a privileged gateway intent.
async function resolveMinecraftEmojiNames(guild: Guild, text: string): Promise<string> {
  const names = new Set([...text.matchAll(EMOJI_NAME_PATTERN)].map((match) => match[1]));
  if (names.size === 0) return text;

  let emojis;
  try {
    emojis = await guild.emojis.fetch();
  } catch (error) {
    console.error(`Failed to fetch custom emoji for guild ${guild.id}:`, error);
    return text;
  }

  const emojiByName = new Map<string, string>();
  for (const name of names) {
    const emoji = emojis.find((candidate) => candidate.name?.toLowerCase() === name.toLowerCase());
    if (emoji) {
      emojiByName.set(name.toLowerCase(), `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`);
    }
  }
  if (emojiByName.size === 0) return text;

  return text.replace(EMOJI_NAME_PATTERN, (full, name: string) => emojiByName.get(name.toLowerCase()) ?? full);
}

async function broadcastMinecraftChatMessage(chat: ChatMessage): Promise<void> {
  if (chat.message.trim().toLowerCase() === LINK_TRIGGER) {
    requestLinkFromMinecraft(chat.username);
    return; // don't relay the "!link" trigger itself into Discord chat
  }

  const isSeltonMello = chat.message.toLowerCase().includes('selton mello');

  // Easter egg: reply "Selton Mello" whenever a player types the phrase in
  // Minecraft chat, regardless of case or surrounding text.
  if (isSeltonMello) {
    try {
      broadcastDiscordMessageToMinecraft('Selton Mello', 'Selton Mello', undefined, isDevMode);
    } catch (error) {
      console.error('Failed to reply "Selton Mello" in Minecraft:', error);
    }
  }

  const username = sanitizeWebhookUsername(chat.username);
  const content = sanitizeMessageContent(chat.message);

  for (const { guildId, botChannelId } of getGuildsWithBotChannel()) {
    try {
      const guild = await bot.guilds.fetch(guildId);
      const channel = await guild.channels.fetch(botChannelId);
      if (!channel || !channel.isTextBased() || !('send' in channel)) continue;

      const webhook = await getOrCreateChatWebhook(channel);
      const relayedContent = await resolveMinecraftEmojiNames(guild, await resolveMinecraftMentions(guild, content));
      let relayedMessage;
      if (webhook) {
        relayedMessage = await webhook.send({
          content: relayedContent,
          username,
          avatarURL: getPlayerHeadUrl(chat.username),
        });
      } else {
        // Fallback if the bot lacks Manage Webhooks permission in this channel.
        // Unlike the webhook path, this is a regular message where markdown renders,
        // so the username needs escaping here too.
        relayedMessage = await channel.send(`**${sanitizeMessageContent(username)}**: ${relayedContent}`);
      }

      // Reply to the just-relayed player message so the "Selton Mello" reply
      // shows up after it in the channel, rather than racing ahead of it.
      if (isSeltonMello) {
        await channel.send({ content: 'Selton Mello', reply: { messageReference: relayedMessage.id } });
      }
    } catch (error) {
      console.error(`Failed to forward Minecraft chat message to guild ${guildId}:`, error);
    }
  }
}

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});
