import 'dotenv/config';
import { Client, GatewayIntentBits, Events, Guild } from 'discord.js';
import { resolveIntroChannelId } from './db/guildSettings.js';
import { commandsByName } from './commands/index.js';

const token = process.env.DISCORD_TOKEN;

if (!token) {
  throw new Error('DISCORD_TOKEN environment variable is required');
}

export const bot = new Client({
  intents: [GatewayIntentBits.Guilds],
});

bot.once(Events.ClientReady, (readyClient: Client<true>) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

const introMessage =
  "👋 Thanks for adding me! Use `/setbotchannel` to pick a channel for join/leave messages and Minecraft chat streaming.";

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

bot.login(token).catch((error) => {
  console.error('Failed to log in to Discord:', error);
  process.exitCode = 1;
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});
