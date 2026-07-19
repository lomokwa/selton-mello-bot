import { db } from './database.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS account_links (
    discordUserId TEXT PRIMARY KEY,
    minecraftUsername TEXT NOT NULL,
    linkedAt TEXT NOT NULL
  )
`);

// Minecraft usernames are unique ignoring case (Mojang doesn't allow "Steve"
// and "steve" as separate accounts), so enforce that here too — otherwise
// two Discord accounts could both claim to own the same player.
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_account_links_username
  ON account_links (minecraftUsername COLLATE NOCASE)
`);

const getByDiscordUserStmt = db.prepare<[string], { minecraftUsername: string }>(
  'SELECT minecraftUsername FROM account_links WHERE discordUserId = ?',
);
const getByUsernameStmt = db.prepare<[string], { discordUserId: string }>(
  'SELECT discordUserId FROM account_links WHERE minecraftUsername = ? COLLATE NOCASE',
);
const upsertStmt = db.prepare<[string, string, string]>(
  `INSERT INTO account_links (discordUserId, minecraftUsername, linkedAt) VALUES (?, ?, ?)
   ON CONFLICT(discordUserId) DO UPDATE SET minecraftUsername = excluded.minecraftUsername, linkedAt = excluded.linkedAt`,
);
const deleteStmt = db.prepare<[string]>('DELETE FROM account_links WHERE discordUserId = ?');

/** Returns the Minecraft username linked to a Discord user, or null if unlinked. */
export function getLinkedMinecraftUsername(discordUserId: string): string | null {
  return getByDiscordUserStmt.get(discordUserId)?.minecraftUsername ?? null;
}

/** Returns the Discord user ID a Minecraft username is linked to (case-insensitive), or null. */
export function getDiscordUserIdForMinecraftUsername(minecraftUsername: string): string | null {
  return getByUsernameStmt.get(minecraftUsername)?.discordUserId ?? null;
}

/** Links (or re-links) a Discord account to a Minecraft username. */
export function linkAccount(discordUserId: string, minecraftUsername: string): void {
  upsertStmt.run(discordUserId, minecraftUsername, new Date().toISOString());
}

/** Removes a Discord account's link, if any. Returns whether a link existed. */
export function unlinkAccount(discordUserId: string): boolean {
  return deleteStmt.run(discordUserId).changes > 0;
}
