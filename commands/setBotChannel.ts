import { ChannelType, ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { setBotChannelId } from "../db/guildSettings.js";
import { Command } from "./types.js";

const setBotChannelCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("setbotchannel")
    .setDescription("Sets the channel for Minecraft chat streaming")
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("The text channel to use for bot messages")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
      return;
    }

    const channel = interaction.options.getChannel("channel", true);
    setBotChannelId(interaction.guildId, channel.id);
    console.log(`Bot channel set to #${channel.name} (${channel.id}) for guild ${interaction.guildId} by ${interaction.user.tag}`);

    await interaction.reply({ content: `Bot messages (join/leave, Minecraft chat) will now be sent in <#${channel.id}>.` });
  },
};

export default setBotChannelCommand;
