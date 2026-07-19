import 'dotenv/config';
import { INVITE_PERMISSIONS } from './commands/invite.js';

const clientId = process.env.CLIENT_ID;

if (!clientId) {
  throw new Error('CLIENT_ID environment variable is required');
}

const url = `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${INVITE_PERMISSIONS}&integration_type=0&scope=bot+applications.commands`;

console.log(url);
