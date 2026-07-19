import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { getLinkedMinecraftUsername } from "../db/accountLinks.js";
import { isPlayerOp } from "../mcManager/players.js";
import { sendCommand } from "../mcManager/consoleStream.js";
import { Command } from "./types.js";

// Strips a leading slash (people habitually type "/gamemode ..." even though
// this isn't a Minecraft chat box) and collapses newlines so a single option
// value can't smuggle a second command onto its own line via the console's
// stdin (same concern as discordBroadcast.ts's sanitizeText).
export function normalizeMinecraftCommand(input: string): string {
  return input
    .replace(/[\r\n]+/g, " ")
    .trim()
    .replace(/^\//, "");
}

const mcCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("mc")
    .setDescription("Runs a Minecraft server command — requires a linked Minecraft account that's a server op")
    .addStringOption((option) =>
      option.setName("command").setDescription("The command to run, without the leading slash").setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const minecraftUsername = getLinkedMinecraftUsername(interaction.user.id);
    if (!minecraftUsername) {
      await interaction.reply({
        content: "You don't have a linked Minecraft account yet — link one first with `/link start <username>`.",
        ephemeral: true,
      });
      return;
    }

    let isOp: boolean | null;
    try {
      isOp = await isPlayerOp(minecraftUsername);
    } catch (error) {
      console.error("mc command: failed to check op status:", error);
      await interaction.reply({
        content: "Couldn't reach the Minecraft server to check op status — try again in a moment.",
        ephemeral: true,
      });
      return;
    }

    if (!isOp) {
      await interaction.reply({
        content: `Your linked Minecraft account (**${minecraftUsername}**) isn't a server operator, so you can't run server commands.`,
        ephemeral: true,
      });
      return;
    }

    const command = normalizeMinecraftCommand(interaction.options.getString("command", true));
    if (!command) {
      await interaction.reply({ content: "That command is empty.", ephemeral: true });
      return;
    }

    const sent = sendCommand(command);
    console.log(`mc command: ${interaction.user.tag} (linked to ${minecraftUsername}, op) ran "/${command}"`);

    await interaction.reply({
      content: sent
        ? `✅ Ran \`/${command}\` on the server as op **${minecraftUsername}**. Check in-game or the server console for any output.`
        : "Couldn't send the command — the console stream isn't connected right now.",
      ephemeral: true,
    });
  },
};

export default mcCommand;
