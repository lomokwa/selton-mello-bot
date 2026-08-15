import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { buildServerInfoMessage, listPlayers } from "../mcManager/players.js";
import { Command } from "./types.js";

const serverInfoCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("serverinfo")
    .setDescription("Shows Minecraft server status and player counts"),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const players = await listPlayers();
      await interaction.reply(buildServerInfoMessage(players));
    } catch (error) {
      console.error("serverinfo command: failed to fetch player list:", error);
      await interaction.reply({
        content: "🔴 Não consegui checar o servidor agora — tenta de novo daqui a pouco.",
        ephemeral: true,
      });
    }
  },
};

export default serverInfoCommand;
