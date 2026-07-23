import 'dotenv/config';
import { Client, GatewayIntentBits, Events, Guild, Webhook, Collection, Message, MessageReferenceType } from 'discord.js';
import { resolveIntroChannelId, getGuildsWithBotChannel, getBotChannelId } from './db/guildSettings.js';
import { commandsByName } from './commands/index.js';
import { startConsoleStream, ChatMessage, ServerEvent, sendCommand } from './mcManager/consoleStream.js';
import { broadcastDiscordMessageToMinecraft, buildReplySnippet, resolveMentions, appendAttachmentUrls, ReplyContext } from './mcManager/discordBroadcast.js';
import { requestLinkFromMinecraft, isValidMinecraftUsername } from './mcManager/accountLinking.js';
import { sanitizeMessageContent, sanitizeWebhookUsername, getPlayerHeadUrl } from './sanitize.js';
import { isPlayerOp, buildOnlineMessage, listPlayers } from './mcManager/players.js';
import { getLinkedMinecraftUsername } from './db/accountLinks.js';
import { parseWhitelistCommand } from './whitelistCommand.js';
import { startPresenceRotation } from './presence.js';

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
  startConsoleStream(broadcastMinecraftChatMessage, broadcastServerEvent);
  startPresenceRotation(readyClient);
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
  // An image/video/file with no caption has empty content -- don't bail out on those, or they relay nothing.
  if (!message.content.trim() && message.attachments.size === 0) return;

  // "!online" — works in any channel, unlike the chat/event bridge below,
  // which is scoped to the guild's configured bot channel.
  if (/^!online\b/i.test(message.content)) {
    try {
      await message.reply(buildOnlineMessage(await listPlayers()));
    } catch (error) {
      console.error('!online: failed to fetch player list:', error);
      await message.reply('Não consegui checar o servidor agora — tenta de novo daqui a pouco.');
    }
    return;
  }

  // "!whitelist <username>" — works in any channel, same "linked + op" gate
  // as the /mc slash command (commands/mc.ts), reusing the exact same check
  // so being able to run server commands and being able to whitelist someone
  // stay governed by one rule instead of drifting apart.
  if (/^!whitelist\b/i.test(message.content)) {
    await handleWhitelistCommand(message);
    return;
  }

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

  const replyTo = await resolveReplyContext(message);
  const withMentions = resolveMentions(message.content, (id) => mentionDisplayName(message, id));
  const content = appendAttachmentUrls(withMentions, [...message.attachments.values()].map((a) => a.url));

  console.log(`Relaying Discord message from ${message.author.tag} to Minecraft: ${content}`);
  try {
    broadcastDiscordMessageToMinecraft(displayName, content, nameColor, isDevMode, replyTo);
  } catch (error) {
    console.error('Failed to relay Discord message to Minecraft:', error);
  }
});

// The mentioned user's server nickname (falling back to their username if they have none, or aren't a member
// of this guild anymore) — used to turn a raw <@id> mention token into readable "@name" text for Minecraft chat.
function mentionDisplayName(message: Message, userId: string): string | undefined {
  return message.mentions.members?.get(userId)?.displayName ?? message.mentions.users.get(userId)?.username;
}

// If `message` is a reply (not a forward — Discord's own "forward a message" feature uses the same
// `reference` mechanism with a different `type`), resolves who it replied to and a short preview of what
// they said, for the in-game reply indicator. Best-effort: a fetch failure (e.g. the original was deleted)
// just means no indicator, never blocks the relay itself.
async function resolveReplyContext(message: Message): Promise<ReplyContext | undefined> {
  if (!message.reference || message.reference.type === MessageReferenceType.Forward) return undefined;
  try {
    const referenced = await message.fetchReference();
    const authorName = referenced.member?.displayName ?? referenced.author.username;
    const content = resolveMentions(referenced.content, (id) => mentionDisplayName(referenced, id));
    return { authorName, snippet: buildReplySnippet(content) };
  } catch (error) {
    console.error('Failed to fetch replied-to message for the reply indicator:', error);
    return undefined;
  }
}

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

// Resolves "@name" tokens in Minecraft chat text into real Discord mentions for the given guild, so players can
// ping someone by typing e.g. "@lomokwa". Uses the REST member-search endpoint (no privileged Members intent
// needed) and only pings on an exact username/nickname match to avoid mis-pinging off a fuzzy prefix match.
// Returns the rewritten text AND the exact user IDs it resolved, so the caller can pin allowedMentions to only
// those — a "<@123>" a player types raw then renders but never pings. MUST run on the RAW message, before
// sanitize escapes "_": MENTION_PATTERN's char class includes "_", so a pre-escaped "@Ant\_Redstone" would
// otherwise truncate to "@Ant" and fail (or ping the wrong person). Underscore usernames are everywhere here.
async function resolveMinecraftMentions(guild: Guild, text: string): Promise<{ text: string; userIds: string[] }> {
  const names = new Set([...text.matchAll(MENTION_PATTERN)].map((match) => match[1]));
  if (names.size === 0) return { text, userIds: [] };

  const mentionsByName = new Map<string, string>();
  const userIds: string[] = [];
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
          userIds.push(member.id);
        }
      } catch (error) {
        console.error(`Failed to resolve Minecraft "@${name}" mention in guild ${guild.id}:`, error);
      }
    }),
  );
  if (mentionsByName.size === 0) return { text, userIds: [] };

  const replaced = text.replace(MENTION_PATTERN, (full, name: string) => mentionsByName.get(name.toLowerCase()) ?? full);
  return { text: replaced, userIds };
}

// Matches ":name:" tokens a player can type in Minecraft chat to reference a
// custom Discord emoji by name (e.g. ":Pepega:"), using Discord's own custom
// emoji name character set (letters, digits, underscores; 2-32 chars). The
// trailing "(?!\d)" makes it NOT match the inner ":name:" of an already-complete
// "<:name:id>" token (whose second colon is followed by the numeric id), so a
// player-pasted emoji isn't double-wrapped into "<<:name:localId>id>".
const EMOJI_NAME_PATTERN = /:([a-zA-Z0-9_]{2,32}):(?!\d)/g;

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

  for (const { guildId, botChannelId } of getGuildsWithBotChannel()) {
    try {
      const guild = await bot.guilds.fetch(guildId);
      const channel = await guild.channels.fetch(botChannelId);
      if (!channel || !channel.isTextBased() || !('send' in channel)) continue;

      const webhook = await getOrCreateChatWebhook(channel);
      // Resolve @mentions and :emoji: on the RAW message FIRST (so underscore usernames survive), then escape
      // markdown -- sanitizeMessageContent protects the resolved <@id>/<:name:id> tokens. Pin allowedMentions to
      // exactly the users we resolved: a deliberate "@name" pings, but no @everyone/@here/role and no raw
      // "<@id>" a player typed can. (guild-specific, so it's recomputed per guild.)
      const { text: mentioned, userIds } = await resolveMinecraftMentions(guild, chat.message);
      const relayedContent = sanitizeMessageContent(await resolveMinecraftEmojiNames(guild, mentioned));
      const allowedMentions = { users: userIds, parse: [] as never[] };
      let relayedMessage;
      if (webhook) {
        relayedMessage = await webhook.send({
          content: relayedContent,
          username,
          avatarURL: getPlayerHeadUrl(chat.username),
          allowedMentions,
        });
      } else {
        // Fallback if the bot lacks Manage Webhooks permission in this channel.
        // Unlike the webhook path, this is a regular message where markdown renders,
        // so the username needs escaping here too.
        relayedMessage = await channel.send({
          content: `**${sanitizeMessageContent(username)}**: ${relayedContent}`,
          allowedMentions,
        });
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

function formatServerEvent(event: ServerEvent): string {
  switch (event.kind) {
    case 'join':
      return `🟢 **${event.username}** entrou no servidor.`;
    case 'leave':
      return `🔴 **${event.username}** saiu do servidor.`;
    case 'advancement':
      return `🏆 **${event.username}** completou o objetivo: *${event.detail}*`;
    case 'death':
      return `💀 ${event.detail}`;
    case 'server_down':
      return '🔴 O servidor de Minecraft parou.';
    case 'server_up':
      return '🟢 O servidor de Minecraft voltou ao ar.';
  }
}

// Bridges joins/leaves/advancements/deaths/server up-down into every guild's
// configured bot channel. Unlike chat (broadcastMinecraftChatMessage), these
// are plain bot messages rather than per-player webhook posts — there's no
// single "author" to attribute an avatar to for a server-lifecycle event.
async function broadcastServerEvent(event: ServerEvent): Promise<void> {
  const content = formatServerEvent(event);

  for (const { guildId, botChannelId } of getGuildsWithBotChannel()) {
    try {
      const guild = await bot.guilds.fetch(guildId);
      const channel = await guild.channels.fetch(botChannelId);
      if (!channel || !channel.isTextBased() || !('send' in channel)) continue;
      // Event text (esp. a death's detail) can contain player-controlled content — a mob/item renamed to
      // "@everyone", "<@id>", or "<@&roleId>" in an anvil shows up verbatim in the death line. This path does
      // NO sanitization, so pin allowedMentions to nothing: an event may never ping anyone.
      await channel.send({ content, allowedMentions: { parse: [] } });
    } catch (error) {
      console.error(`Failed to forward server event (${event.kind}) to guild ${guildId}:`, error);
    }
  }
}

async function handleWhitelistCommand(message: Message): Promise<void> {
  const targetUsername = parseWhitelistCommand(message.content);
  if (!targetUsername) {
    await message.reply('Uso: `!whitelist <usuario>`');
    return;
  }
  if (!isValidMinecraftUsername(targetUsername)) {
    await message.reply(`"${targetUsername}" não parece um nome de usuário válido do Minecraft.`);
    return;
  }

  const minecraftUsername = getLinkedMinecraftUsername(message.author.id);
  if (!minecraftUsername) {
    await message.reply('Você precisa vincular uma conta Minecraft primeiro — use `/link start <usuario>`.');
    return;
  }

  let isOp: boolean | null;
  try {
    isOp = await isPlayerOp(minecraftUsername);
  } catch (error) {
    console.error('!whitelist: failed to check op status:', error);
    await message.reply('Não consegui checar o servidor agora — tenta de novo daqui a pouco.');
    return;
  }

  if (!isOp) {
    await message.reply(
      `Sua conta vinculada (**${minecraftUsername}**) não é operadora do servidor, então você não pode usar esse comando.`,
    );
    return;
  }

  const sent = sendCommand(`whitelist add ${targetUsername}`);
  console.log(`!whitelist: ${message.author.tag} (linked to ${minecraftUsername}, op) whitelisted "${targetUsername}"`);
  await message.reply(
    sent
      ? `✅ **${targetUsername}** adicionado à whitelist por **${minecraftUsername}**.`
      : 'Não consegui enviar o comando — a conexão com o servidor não está ativa agora.',
  );
}

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});
