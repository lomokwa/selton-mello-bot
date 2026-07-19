import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from "./types.js";

const pingCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Replies with pong and the current latency"),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const { resource } = await interaction.reply({ content: "Pinging...", withResponse: true });
    const sent = resource!.message!;
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    await interaction.editReply(`🏓 Pong! Latency: ${latency}ms. API latency: ${Math.round(interaction.client.ws.ping)}ms.`);
  },
};

export default pingCommand;
