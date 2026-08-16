import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  pickReusableWebhook,
  classifyWebhookError,
  describeWebhookFailure,
} from '../webhookPick.ts'

const NAME = 'Minecraft Chat'
const BOT = 'bot-user-1'

// The bug these lock down: relayed Minecraft chat stopped showing the player's
// head in Discord. The avatar code was untouched -- what broke was that the
// relay quietly stopped using the webhook at all and fell back to plain text,
// because the channel had filled up with duplicate webhooks nobody reused.

test('reuses a webhook this bot owns', () => {
  const hooks = [
    { name: 'Other thing', token: 't', owner: { id: BOT } },
    { name: NAME, token: 'usable', owner: { id: BOT } },
  ]
  assert.equal(pickReusableWebhook(hooks, NAME, BOT)?.token, 'usable')
})

// The heart of it. `owner` is not always populated, and bot.user is null until
// the client is ready -- so the old `owner?.id === bot.user?.id` check matched
// nothing and minted a NEW webhook each time. Fifteen of those fill the channel.
test('reuses a usable webhook even when owner is missing or the bot id is unknown', () => {
  const noOwner = [{ name: NAME, token: 'usable' }]
  assert.equal(pickReusableWebhook(noOwner, NAME, BOT)?.token, 'usable', 'missing owner must not force a new webhook')
  assert.equal(pickReusableWebhook(noOwner, NAME, undefined)?.token, 'usable', 'unknown bot id must not either')
})

test('prefers our own when several qualify, but still takes one otherwise', () => {
  const many = [
    { name: NAME, token: 'someone-elses', owner: { id: 'other' } },
    { name: NAME, token: 'ours', owner: { id: BOT } },
  ]
  assert.equal(pickReusableWebhook(many, NAME, BOT)?.token, 'ours')
  assert.equal(pickReusableWebhook(many, NAME, undefined)?.token, 'someone-elses')
})

test('skips webhooks we cannot send through', () => {
  // Channel-follower webhooks carry no token; using one would throw on send.
  const unusable = [
    { name: NAME, token: null, owner: { id: BOT } },
    { name: NAME, owner: { id: BOT } },
  ]
  assert.equal(pickReusableWebhook(unusable, NAME, BOT), undefined)
})

test('a differently named webhook is not ours to reuse', () => {
  assert.equal(pickReusableWebhook([{ name: 'Logs', token: 't' }], NAME, BOT), undefined)
})

test('classifies the two failures that need different fixes', () => {
  assert.equal(classifyWebhookError({ code: 50013 }), 'permission')
  assert.equal(classifyWebhookError({ code: 30007 }), 'limit')
  assert.equal(classifyWebhookError(new Error('Maximum number of webhooks reached (15)')), 'limit')
  assert.equal(classifyWebhookError(new Error('Missing Permissions')), 'permission')
  assert.equal(classifyWebhookError(new Error('socket hang up')), 'unknown')
  assert.equal(classifyWebhookError(null), 'unknown')
})

// The old code hardcoded "Missing Manage Webhooks" for every failure, which
// sent whoever read the log to check permissions on a channel whose actual
// problem was that it had run out of webhook slots.
test('the log names the real cause, and always says avatars are gone', () => {
  const limit = describeWebhookFailure('limit', '123', 10)
  assert.match(limit, /15-webhook limit/)
  assert.doesNotMatch(limit, /Manage Webhooks/)

  const perm = describeWebhookFailure('permission', '123', 10)
  assert.match(perm, /Manage Webhooks/)

  for (const kind of ['limit', 'permission', 'unknown'] as const) {
    assert.match(
      describeWebhookFailure(kind, '123', 10),
      /no player avatars/,
      `${kind} must say the visible symptom, so the log matches what someone reports`,
    )
  }
})
