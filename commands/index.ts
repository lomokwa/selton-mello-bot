import { Collection } from "discord.js";
import help from "./help.js";
import invite from "./invite.js";
import link from "./link.js";
import mc from "./mc.js";
import ping from "./ping.js";
import setBotChannel from "./setBotChannel.js";
import { Command } from "./types.js";

export const commands: Command[] = [help, invite, link, mc, ping, setBotChannel];

export const commandsByName = new Collection<string, Command>(
  commands.map((command) => [command.data.name, command])
);
