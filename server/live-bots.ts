/**
 * Test bots for hosted rooms, so a host can rehearse alone: two bot players
 * join every room and the server answers for them when each prompt opens.
 *
 * Serverless (no timers): a bot's answer is stored the moment the host opens the
 * prompt, with an answer time (`ms`) somewhere inside the window. Screens only
 * count it as "locked in" once that moment has passed (see `visibleSubs`).
 */
import type { BankAnswer, BankPrompt } from "../lib/game/bank.js";
import { nameKey } from "../lib/game/live.js";
import { ANSWER_TIERS, pointsForTier } from "../lib/game/scoring.js";
import type { LivePlayer, LiveRoom, LiveStore, LiveSubmission } from "./live-store.js";

export const BOT_NAMES = ["Bot Gabriel", "Bot Deborah"] as const;

/** How often a bot misses a prompt (gives no accepted answer). */
export const BOT_MISS_RATE = 0.15;

/** Adds the bots to a new room. */
/** In team rooms the bots play as one team, so the team board has something on it while testing. */
export const BOT_TEAM = "Bots";

export async function addBots(store: LiveStore, roomId: string, now: number, count: number = BOT_NAMES.length, team: string | null = null): Promise<void> {
  for (const nickname of BOT_NAMES.slice(0, count)) {
    await store.addPlayer({ roomId, nickname, nameKey: nameKey(nickname), team, now, bot: true });
  }
}

/**
 * A bot's pick: usually a right answer from a random tier (so reveals show many
 * tiers, not just the long tail), sometimes nothing (a miss).
 */
export function botPick(prompt: BankPrompt, random: () => number): BankAnswer | null {
  if (random() < BOT_MISS_RATE) return null;
  const tiers = ANSWER_TIERS.filter((t) => prompt.answers.some((a) => a.tier === t));
  const tier = tiers[Math.floor(random() * tiers.length)];
  const pool = prompt.answers.filter((a) => a.tier === tier);
  return pool[Math.floor(random() * pool.length)] ?? null;
}

/** When a prompt opens: each active bot locks a random answer straight away. */
export async function botsAnswer(
  store: LiveStore,
  room: LiveRoom,
  players: readonly LivePlayer[],
  prompt: BankPrompt,
  random: () => number,
): Promise<void> {
  for (const bot of players.filter((p) => p.bot && !p.kicked)) {
    const pick = botPick(prompt, random);
    if (!pick) continue;
    await store.addSubmission({
      roomId: room.id,
      roundIndex: room.roundIndex,
      playerId: bot.id,
      raw: pick.canonical,
      canonical: pick.canonical,
      tier: pick.tier,
      points: pointsForTier(pick.tier),
      ms: 0,
      ai: false,
      reference: null,
    });
  }
}

/**
 * Submissions a screen may know about right now: during an open prompt, a bot's
 * answer only shows once its answer time has passed.
 */
export function visibleSubs(
  subs: readonly LiveSubmission[],
  players: readonly LivePlayer[],
  room: Pick<LiveRoom, "phase" | "roundIndex" | "openedAt">,
  now: number,
): LiveSubmission[] {
  if (room.phase !== "question" || room.openedAt === null) return [...subs];
  const bots = new Set(players.filter((p) => p.bot).map((p) => p.id));
  const elapsed = now - room.openedAt;
  return subs.filter((s) => s.roundIndex !== room.roundIndex || !bots.has(s.playerId) || s.ms <= elapsed);
}
