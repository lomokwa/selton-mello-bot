import Database from 'better-sqlite3';
import path from 'path';

// Stored relative to the working directory the bot is started from (project root),
// so it persists across rebuilds regardless of running from source or dist/.
const dbPath = path.join(process.cwd(), 'bot.sqlite3');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS guild_settings (
    guildId TEXT PRIMARY KEY,
    botChannelId TEXT,
    statusMessageId TEXT
  )
`);

// Lightweight migration for databases created before statusMessageId existed.
const existingColumns = db.prepare<[], { name: string }>('PRAGMA table_info(guild_settings)').all();
if (!existingColumns.some((column) => column.name === 'statusMessageId')) {
  db.exec('ALTER TABLE guild_settings ADD COLUMN statusMessageId TEXT');
}
