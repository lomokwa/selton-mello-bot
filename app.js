import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';

const token = process.env.DISCORD_TOKEN;
const bot = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences],
});

const triggerWords = {
  'selton mello': 'Selton Mello',
  'selton': 'Mello',
  'mello': 'Selton',
  'salve o selton mello': 'https://youtu.be/fvbLmahQZ-s?t=21'
};

bot.once(Events.ClientReady, (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

// Checks for trigger word in message and replies with the corresponding value
bot.on("messageCreate", (message) => {
  if (message.author.bot) return;

  const contentLowercase = message.content.toLowerCase();
  for(const word of Object.keys(triggerWords)) {
    if(contentLowercase.includes(word.toLowerCase())) {
      if (contentLowercase.includes('salve o selton mello')) {
      
      }
      message.reply(triggerWords[word]);
      break;
    }
  }  
});


//362414375652294657
// Sends a message when a new member joins the server
bot.on("guildMemberAdd", member => {
  member.guild.channels.get("531250909582327830").send(`${member.user.username}, SMT!`)
  console.log(`${member.user.username} joined the server`)
})

// Sends a message when a member leaves the server
bot.on("guildMemberRemove", member => {
  member.guild.channels.get("531250909582327830").send(`${member.user.username} SEU BOSTA SEU PORRA SEU CARALHO DE MERDA SEU FDP DO KRL`)
  console.log(`${member.user.username} left the server`)
})

bot.login(token);
