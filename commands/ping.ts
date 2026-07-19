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
    const apiLatency = Math.round(interaction.client.ws.ping);
    console.log(`Ping from ${interaction.user.tag}: round-trip ${latency}ms, API ${apiLatency}ms`);
    await interaction.editReply(`🏓 Pong! Latency: ${latency}ms. API latency: ${apiLatency}ms.`);
  },
};

export default pingCommand;
