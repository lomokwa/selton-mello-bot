import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from "./types.js";

const helpCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Lists all available commands"),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    // Imported lazily to avoid a circular import with index.ts at module load time.
    const { commands } = await import("./index.js");

    const commandList = commands
      .map((command) => `\`/${command.data.name}\` — ${command.data.description}`)
      .join("\n");

    await interaction.reply({ content: `**Available commands:**\n${commandList}`, ephemeral: true });
  },
};

export default helpCommand;
