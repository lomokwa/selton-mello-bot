/**
 * Choosing which existing webhook to relay Minecraft chat through, and saying
 * out loud why we couldn't.
 *
 * Split out of app.ts so it's unit-testable without a live Discord client (the
 * same reason whitelistCommand.ts and mcManager/players.ts's buildOnlineMessage
 * live outside app.ts).
 */

/** The parts of a discord.js Webhook this module actually reasons about. */
export interface PickableWebhook {
  name: string
  /** Present only for webhooks we can send through. Channel-follower webhooks have none. */
  token?: string | null
  owner?: { id: string } | null
}

/**
 * Picks a webhook to reuse, preferring one this bot created.
 *
 * The old rule was `name === WEBHOOK_NAME && owner?.id === bot.user?.id`, which
 * looks careful and is actually the bug: `owner` is not always populated, and
 * `bot.user` is null until the client is ready, so `owner?.id === undefined`
 * quietly matched nothing and a BRAND NEW webhook was created instead. Discord
 * caps a channel at 15, so enough restarts fill the channel, createWebhook
 * starts failing, and every relayed message silently drops to the plain-text
 * fallback -- which is what "the player's face stopped showing up" looks like
 * from Discord.
 *
 * What actually matters for reuse is whether we can SEND through it: the name
 * marks it as ours, and a token is what makes it usable. Ownership is only a
 * tiebreak when several qualify.
 */
export function pickReusableWebhook<T extends PickableWebhook>(
  webhooks: readonly T[],
  wantedName: string,
  botUserId: string | undefined,
): T | undefined {
  const usable = webhooks.filter((w) => w.name === wantedName && !!w.token)
  if (usable.length === 0) return undefined
  if (botUserId) {
    const own = usable.find((w) => w.owner?.id === botUserId)
    if (own) return own
  }
  return usable[0]
}

/** Why webhook setup failed, so the log can name the real cause. */
export type WebhookFailure = 'permission' | 'limit' | 'unknown'

/**
 * Discord API error codes we care about here.
 * 50013 Missing Permissions · 30007 Maximum number of webhooks reached
 */
export function classifyWebhookError(error: unknown): WebhookFailure {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 50013 || code === '50013') return 'permission'
  if (code === 30007 || code === '30007') return 'limit'

  // Some paths surface the message without a numeric code.
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase()
  if (message.includes('maximum number of webhooks')) return 'limit'
  if (message.includes('missing permissions') || message.includes('missing access')) return 'permission'
  return 'unknown'
}

/**
 * The log line for a failure. Blaming permissions for everything is what made
 * the real cause invisible; each of these points somewhere different.
 */
export function describeWebhookFailure(kind: WebhookFailure, channelId: string, cooldownMinutes: number): string {
  const tail = `falling back to plain messages (no player avatars) for ${cooldownMinutes} min`
  switch (kind) {
    case 'permission':
      return `Missing "Manage Webhooks" in channel ${channelId} — ${tail}`
    case 'limit':
      return (
        `Channel ${channelId} has hit Discord's 15-webhook limit and none of the existing ones are reusable — ` +
        `delete the unused "Minecraft Chat" webhooks in that channel's settings. ${tail}`
      )
    default:
      return `Could not set up the chat webhook in channel ${channelId} — ${tail}`
  }
}
