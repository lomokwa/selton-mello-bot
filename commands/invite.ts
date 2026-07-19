import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from "./types.js";

// Matches the permission set chosen in Discord's OAuth2 URL Generator (View
// Channels, Manage Webhooks, Send Messages, Embed Links, Read Message
// History, Use Slash Commands) — keep this in sync if that selection changes.
export const INVITE_PERMISSIONS = "5067641039865856";

const inviteCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("invite")
    .setDescription("Gets an invite link to add this bot to another server"),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    // Uses the client's own ID rather than a hardcoded one, so the prod bot
    // and any dev bot instance (different Discord application, per .env.dev)
    // each generate their own correct invite link automatically.
    const clientId = interaction.client.user.id;
    const url = `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${INVITE_PERMISSIONS}&integration_type=0&scope=bot+applications.commands`;

    await interaction.reply(`Invite me to your server: ${url}`);
  },
};

export default inviteCommand;
