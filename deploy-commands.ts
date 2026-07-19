import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commands } from './commands/index.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token) {
  throw new Error('DISCORD_TOKEN environment variable is required');
}
if (!clientId) {
  throw new Error('CLIENT_ID environment variable is required');
}

const rest = new REST().setToken(token);
const body = commands.map((command) => command.data.toJSON());

// If GUILD_ID is set, register commands to that single guild for instant
// updates (seconds) while developing. Otherwise register globally, which can
// take up to ~1 hour to propagate to all servers.
const route = guildId ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId);

try {
  console.log(`Registering ${body.length} slash command(s) ${guildId ? `to guild ${guildId}` : 'globally'}...`);
  await rest.put(route, { body });
  console.log('Slash commands registered successfully.');
} catch (error) {
  console.error('Failed to register slash commands:', error);
  process.exitCode = 1;
}
