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
import { listPlayers } from './mcManager/players.js';

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

/** Builds the normal (non-fact) rotation text from live server state. Exported for testing. */
export async function buildStatusText(): Promise<string> {
  try {
    const players = await listPlayers();
    const online = players.filter((player) => player.online);
    if (online.length === 0) return '🟢 Servidor online — ninguém jogando agora';
    return `🎮 ${online.length} jogador${online.length === 1 ? '' : 'es'} online`;
  } catch (error) {
    console.error('presence: failed to fetch player list:', error);
    return '🔴 Servidor indisponível no momento';
  }
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
