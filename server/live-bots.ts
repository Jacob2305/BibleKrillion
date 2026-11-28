/**
 * Test bots for hosted rooms, so a host can rehearse alone with a crowd: every
 * name in BOT_NAMES joins each room and the server answers for them when each
 * prompt opens, picking like a real room would (mostly common answers).
 *
 * Serverless (no timers): a bot's answer is stored the moment the host opens the
 * prompt, with an answer time (`ms`) somewhere inside the window. Screens only
 * count it as "locked in" once that moment has passed (see `visibleSubs`).
 */
import type { BankAnswer, BankPrompt } from "../lib/game/bank.js";
import { nameKey } from "../lib/game/live.js";
import { ANSWER_TIERS, pointsForTier, type AnswerTier } from "../lib/game/scoring.js";
import type { LivePlayer, LiveRoom, LiveStore, LiveSubmission } from "./live-store.js";

/** A crowd of 27, about the size of the group this is built for. */
export const BOT_NAMES = [
  "Bot Gabriel", "Bot Deborah", "Bot Ruth", "Bot Silas", "Bot Miriam", "Bot Barnabas", "Bot Lydia",
  "Bot Caleb", "Bot Hannah", "Bot Timothy", "Bot Priscilla", "Bot Aquila", "Bot Esther", "Bot Gideon",
  "Bot Naomi", "Bot Boaz", "Bot Phoebe", "Bot Jonah", "Bot Tabitha", "Bot Elijah", "Bot Rhoda",
  "Bot Nathan", "Bot Martha", "Bot Stephen", "Bot Abigail", "Bot Joshua", "Bot Dorcas",
] as const;

/** How often a bot misses a prompt (gives no accepted answer). */
export const BOT_MISS_RATE = 0.12;

/**
 * How a real room spreads its answers over the tiers: mostly the familiar ones,
 * a handful of rare and deep answers, the odd gem. Renormalised over the tiers a
 * prompt actually has.
 */
export const BOT_TIER_WEIGHTS: Record<AnswerTier, number> = {
  plankton: 34,
  too_clever: 14,
  schooler: 26,
  rare: 13,
  deep_cut: 9,
  one_in_a_million: 4,
};

/** Bot teams in team rooms. The first is BOT_TEAM, so a couple of bots still form one team. */
export const BOT_TEAM = "Bots";
export const BOT_TEAMS = [BOT_TEAM, "Shepherds", "Fishers", "Tentmakers"] as const;

/**
 * Adds the bots to a new room. In team rooms (`team` given) they're split into
 * BOT_TEAMS in blocks, so a small bot count stays on one team.
 */
export async function addBots(store: LiveStore, roomId: string, now: number, count: number = BOT_NAMES.length, team: string | null = null): Promise<void> {
  const perTeam = Math.ceil(BOT_NAMES.length / BOT_TEAMS.length);
  // In parallel: one database round trip per bot would add seconds to creating a room.
  await Promise.all(
    BOT_NAMES.slice(0, count).map((nickname, i) => {
      const botTeam = team === null ? null : BOT_TEAMS[Math.floor(i / perTeam)] ?? BOT_TEAM;
      return store.addPlayer({ roomId, nickname, nameKey: nameKey(nickname), team: botTeam, now, bot: true });
    }),
  );
}

/** Index from weights: 0..weights.length-1. */
function weighted(weights: readonly number[], random: () => number): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = random() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i]!;
    if (roll < 0) return i;
  }
  return weights.length - 1;
}

/**
 * A bot's pick, like a person in a real room: usually a familiar tier, now and
 * then a rare or deep one, sometimes nothing (a miss). Within a tier, answers
 * listed first are likelier, so popular answers stack up (×3, ×5…).
 */
export function botPick(prompt: BankPrompt, random: () => number): BankAnswer | null {
  if (random() < BOT_MISS_RATE) return null;
  const tiers = ANSWER_TIERS.filter((t) => prompt.answers.some((a) => a.tier === t));
  if (tiers.length === 0) return null;
  const tier = tiers[weighted(tiers.map((t) => BOT_TIER_WEIGHTS[t]), random)]!;
  const pool = prompt.answers.filter((a) => a.tier === tier);
  return pool[weighted(pool.map((_, i) => 1 / (i + 1)), random)] ?? null;
}

/** When a prompt opens: each active bot locks a random answer straight away. */
export async function botsAnswer(
  store: LiveStore,
  room: LiveRoom,
  players: readonly LivePlayer[],
  prompt: BankPrompt,
  random: () => number,
): Promise<void> {
  // Picks are drawn in order (repeatable with a seeded random); the saves run in parallel
  // so opening a prompt doesn't wait on one database round trip per bot.
  const saves: Promise<unknown>[] = [];
  for (const bot of players.filter((p) => p.bot && !p.kicked)) {
    const pick = botPick(prompt, random);
    if (!pick) continue;
    saves.push(store.addSubmission({
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
    }));
  }
  await Promise.all(saves);
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
