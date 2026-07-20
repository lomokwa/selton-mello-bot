/** Extracts the target username from a "!whitelist <username>" message, or null if the syntax doesn't match. */
export function parseWhitelistCommand(content: string): string | null {
  const match = /^!whitelist\s+(\S+)/i.exec(content.trim());
  return match ? match[1] : null;
}
