import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commands } from './commands/index.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token) {
  throw new Error('DISCORD_TOKEN environment variable is required');
}
if (!clientId) {
  throw new Error('CLIENT_ID environment variable is required');
}

const rest = new REST().setToken(token);
const body = commands.map((command) => command.data.toJSON());

try {
  console.log(`Registering ${body.length} slash command(s)...`);
  await rest.put(Routes.applicationCommands(clientId), { body });
  console.log('Slash commands registered successfully.');
} catch (error) {
  console.error('Failed to register slash commands:', error);
  process.exitCode = 1;
}
