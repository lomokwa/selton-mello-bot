import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { confirmAccountLink, startAccountLink } from "../mcManager/accountLinking.js";
import { unlinkAccount } from "../db/accountLinks.js";
import { Command } from "./types.js";

const startFailureMessages: Record<Extract<ReturnType<typeof startAccountLink>, { ok: false }>["reason"], string> = {
  "invalid-username": "That doesn't look like a valid Minecraft username (3-16 letters, numbers, or underscores).",
  "already-linked": "You're already linked to a Minecraft account — run `/link unlink` first if you want to link a different one.",
  "already-linked-elsewhere": "That Minecraft account is already linked to a different Discord account.",
  "whisper-failed":
    "Could not reach the Minecraft server right now — make sure the player is online and try again in a moment.",
};

const confirmFailureMessages: Record<
  Extract<ReturnType<typeof confirmAccountLink>, { ok: false }>["reason"],
  string
> = {
  "invalid-code":
    "That code doesn't match any pending request — start one with `/link start <username>` in Discord, or type `!link` in Minecraft chat.",
  expired: "That code has expired — start a new link request with `/link start` or by typing `!link` in Minecraft chat.",
  "already-linked-elsewhere": "That Minecraft account was linked to a different Discord account in the meantime.",
};

const linkCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("link")
    .setDescription("Link your Discord account to your Minecraft account")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("start")
        .setDescription("Start linking by receiving a one-time code in-game")
        .addStringOption((option) =>
          option.setName("username").setDescription("Your Minecraft username").setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("confirm")
        .setDescription("Confirm linking with the code you received in-game")
        .addStringOption((option) =>
          option.setName("code").setDescription("The code you received in Minecraft").setRequired(true)
        )
    )
    .addSubcommand((subcommand) => subcommand.setName("unlink").setDescription("Unlink your Minecraft account")),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "start") {
      const username = interaction.options.getString("username", true).trim();
      const result = startAccountLink(interaction.user.id, username);

      if (result.ok) {
        await interaction.reply({
          content: `I've whispered a one-time code to **${username}** in-game — check your Minecraft chat, then confirm here with \`/link confirm\` within 5 minutes.`,
          ephemeral: true,
        });
      } else {
        await interaction.reply({ content: startFailureMessages[result.reason], ephemeral: true });
      }
      return;
    }

    if (subcommand === "confirm") {
      const code = interaction.options.getString("code", true).trim();
      const result = confirmAccountLink(interaction.user.id, code);

      if (result.ok) {
        await interaction.reply({
          content: `✅ Linked your Discord account to Minecraft account **${result.minecraftUsername}**.`,
          ephemeral: true,
        });
      } else {
        await interaction.reply({ content: confirmFailureMessages[result.reason], ephemeral: true });
      }
      return;
    }

    // unlink
    const wasLinked = unlinkAccount(interaction.user.id);
    await interaction.reply({
      content: wasLinked ? "Your Minecraft account has been unlinked." : "You don't have a linked Minecraft account.",
      ephemeral: true,
    });
  },
};

export default linkCommand;
