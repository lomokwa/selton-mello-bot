import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';

const token = process.env.DISCORD_TOKEN;
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

const triggerWords = {
  'selton mello': 'Selton Mello',
  'selton': 'Mello',
  'mello': 'Selton',
};

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

client.on("messageCreate", (message) => {
  if (message.author.bot) return;

  const contentLowercase = message.content.toLowerCase();
  for(const word of Object.keys(triggerWords)) {
    if(contentLowercase.includes(word.toLowerCase())) {
      message.reply(triggerWords[word]);
      break;
    }
  }  
});

client.on("guildMemberAdd", (member) => {
  client.message.send("")
})

client.login(token);
