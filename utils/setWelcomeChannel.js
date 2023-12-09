import { SlashCommandBuilder } from "discord.js";

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setWelcomeChannel")
    .setDescription("Sets channel to send welcome / goodbye messages"),
}




