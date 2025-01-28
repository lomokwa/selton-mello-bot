import 'dotenv/config';
import { Client, GatewayIntentBits, Events, ActivityType } from 'discord.js';
import { updateBotStatusMessage } from './utils/getRemainingTIme.js';

const token = process.env.DISCORD_TOKEN;
const channelId = process.env.CHANNEL_ID;

export const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent, 
    GatewayIntentBits.GuildMembers, 
    GatewayIntentBits.GuildPresences
  ],
  partials: ["GuildMember"],
});

const triggerWords = {
  'selton mello': 'Selton Mello',
  'selton': 'Mello',
  'mello': 'Selton',
  'salve o selton mello': 'https://youtu.be/fvbLmahQZ-s?t=21'
};

bot.once(Events.ClientReady, (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);

  // Update the bot status message immediately and then every 30 minutes
  updateBotStatusMessage(channelId);
  setInterval(() => updateBotStatusMessage(channelId), 1000);
});

// Checks for trigger word in message and replies with the corresponding value
bot.on("messageCreate", (message) => {
  if (message.author.bot) return;

  const contentLowercase = message.content.toLowerCase();
  for(const word of Object.keys(triggerWords)) {
    if(contentLowercase.includes(word.toLowerCase())) {
      message.reply(triggerWords[word]);
      break;
    }
  }  
});

//362414375652294657
// Sends a message when a new member joins the server
bot.on("guildMemberAdd", member => {
  member.guild.channels.fetch(`${channelId}`).then(channel => {
    if (channel) {
      console.log(`${member.user.username} joined the server`)
      channel.send(`SMT <@${member.user.id}>!`);
    } else {
      console.error(`Channel with id ${channelId} does not exist`);
    }
  })
})

// Sends a message when a member leaves the server
bot.on("guildMemberRemove", member => {
  member.guild.channels.fetch(`${channelId}`).then(channel => {
    if (channel) {
      console.log(`${member.user.username} left the server`)
      channel.send(`<@${member.user.id}> tchau`)
    } else {
      console.error(`Channel with id ${channelId} does not exist`);
    }
  })
})

// Update April Transcription Status


bot.login(token);
