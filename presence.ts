/**
 * Rotates the bot's Discord presence (the status line shown under its name in
 * the member list) between useful at-a-glance server info — player count,
 * reachability — and, once an hour for a short window, a random Selton Mello
 * "fact": a lighthearted nod to the bot's own running joke (see app.ts's
 * "Selton Mello" easter egg). This is presence/activity text, not a per-guild
 * message, so it can only reflect overall bot/server health, not per-guild
 * configuration (e.g. whether a given guild has run /setbotchannel).
 */
import { ActivityType, Client } from 'discord.js';
import { listPlayers, isMinecraftRunning } from './mcManager/players.js';
import { McManagerError } from './mcManager/client.js';

const ROTATION_INTERVAL_MS = 30_000;
const FACT_INTERVAL_MS = 60 * 60 * 1000;
const FACT_DURATION_MS = 15_000;

// Deliberately larger-than-life, "living legend" style exaggerations (same
// spirit as Chuck Norris facts) — never meant to read as a real claim about
// the actor, just a silly nod to why this bot has his name.
export const SELTON_MELLO_FACTS: readonly string[] = [
  'Selton Mello já venceu uma corrida contra o tempo. O relógio desistiu no meio.',
  'Quando Selton Mello conta uma piada, o Brasil inteiro ri em uníssono — até quem não ouviu.',
  'Selton Mello não decora falas. As falas se organizam sozinhas pra combinar com ele.',
  'Existe um Oscar guardado numa gaveta em algum lugar só esperando o dia certo de entregar.',
  'Selton Mello já dirigiu e atuou no mesmo filme, em cenas diferentes, ao mesmo tempo.',
  'Dizem que "Cine Holliúdy" foi filmado numa tomada só. Ninguém errou uma cena.',
  'Selton Mello consegue fazer a plateia rir e chorar na mesma cena, no mesmo segundo.',
  'Quando Selton Mello improvisa, os roteiristas anotam pra usar depois.',
  'Ele já emprestou a voz a um personagem, e o personagem ficou mais engraçado que o roteiro.',
  'Selton Mello não ensaia. Ele chega e já é a cena.',
  'Diz a lenda que ele decorou um roteiro inteiro só de olhar a capa.',
  'Selton Mello já fez tanto sucesso num papel que tiveram que escrever cenas novas de última hora.',
  'Perguntaram pra ele qual era o segredo. Ele só respondeu "Selton Mello" e todo mundo entendeu.',
  'Selton Mello improvisa um final melhor que o roteiro — e o final dele é sempre o escolhido.',
  'Não existe holofote de estúdio que não fique com inveja da luz natural do Selton Mello.',
];

function randomFact(): string {
  return SELTON_MELLO_FACTS[Math.floor(Math.random() * SELTON_MELLO_FACTS.length)];
}

/**
 * What the status line is actually reporting. These are three different facts
 * that the old code collapsed into two, and got both wrong at the edges: it
 * asked only "did the player list come back?", so a STOPPED Minecraft server
 * still read as "🟢 Servidor online" (the panel answered, after all), and any
 * failure at all — a panel restart, one bad token, a Cloudflare hiccup — read
 * as the same opaque "indisponível" with no way to tell which.
 */
export type ServerSnapshot =
  | { kind: 'players'; online: number }
  | { kind: 'stopped' }
  | { kind: 'forbidden' }
  | { kind: 'unreachable' };

/** Renders a snapshot as status text. Pure, so the wording is testable without touching the network. */
export function buildStatusTextFrom(snapshot: ServerSnapshot): string {
  switch (snapshot.kind) {
    case 'players':
      if (snapshot.online === 0) return '🟢 Servidor online — ninguém jogando agora';
      return `🎮 ${snapshot.online} jogador${snapshot.online === 1 ? '' : 'es'} online`;
    case 'stopped':
      return '🟡 Servidor de Minecraft parado';
    case 'forbidden':
      return '🔴 Bot sem permissão no painel';
    case 'unreachable':
      return '🔴 Painel fora do ar';
  }
}

/** Reads live server state. Asks whether the SERVER is up first, then who's on it. */
export async function readSnapshot(): Promise<ServerSnapshot> {
  try {
    if (!(await isMinecraftRunning())) return { kind: 'stopped' };
    const players = await listPlayers();
    return { kind: 'players', online: players.filter((player) => player.online).length };
  } catch (error) {
    // A 403 is the panel working correctly and refusing US -- the bot's own
    // account has no role, or one without the permission this route needs.
    // It cost a real outage to work that out from a status line that just
    // said "indisponível", so it gets its own wording now.
    if (error instanceof McManagerError && error.status === 403) {
      console.error('presence: mc-manager refused the bot (403) -- its account needs a role:', error);
      return { kind: 'forbidden' };
    }
    // Logged in full: the status line has room for four words, and when this
    // fires the actual HTTP status is the only thing worth knowing.
    console.error('presence: could not read server state:', error);
    return { kind: 'unreachable' };
  }
}

/** Builds the normal (non-fact) rotation text from live server state. Exported for testing. */
export async function buildStatusText(): Promise<string> {
  return buildStatusTextFrom(await readSnapshot());
}

let rotationTimer: ReturnType<typeof setInterval> | null = null;
let factTimer: ReturnType<typeof setInterval> | null = null;
let showingFact = false;

function setCustomStatus(bot: Client<true>, text: string): void {
  // Custom-status text is rendered from `state`, not `name` — but `name` is
  // still required by the activity payload shape, so both carry the same text.
  bot.user.setActivity(text, { type: ActivityType.Custom, state: text });
}

async function applyRotation(bot: Client<true>): Promise<void> {
  if (showingFact) return; // an hourly fact window is active — don't fight it
  setCustomStatus(bot, await buildStatusText());
}

function showFact(bot: Client<true>): void {
  showingFact = true;
  setCustomStatus(bot, randomFact());
  setTimeout(() => {
    showingFact = false;
    void applyRotation(bot);
  }, FACT_DURATION_MS);
}

/** Starts the presence rotation. Call once, after the bot has logged in (Events.ClientReady). */
export function startPresenceRotation(bot: Client<true>): void {
  void applyRotation(bot);
  rotationTimer = setInterval(() => void applyRotation(bot), ROTATION_INTERVAL_MS);
  factTimer = setInterval(() => showFact(bot), FACT_INTERVAL_MS);
}

/** Stops the rotation and clears its timers (tests / clean shutdown). */
export function stopPresenceRotation(): void {
  if (rotationTimer) clearInterval(rotationTimer);
  if (factTimer) clearInterval(factTimer);
  rotationTimer = null;
  factTimer = null;
  showingFact = false;
}
