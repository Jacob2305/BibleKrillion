/**
 * Which 7 prompts are "today's" Daily Dive.
 *
 * Deterministic from the date (America/New_York, resets at local midnight), so
 * every player gets the same prompts. Uses a least-recently-used rotation from a
 * fixed epoch: each day takes the prompts that have gone longest without being
 * used (ties broken by a date-seeded shuffle), never one used in the previous
 * NO_REPEAT_DAYS - 1 days, preferring one per category, ordered easy → hard.
 *
 * Editing the bank can change future (and today's) picks; attempts already in
 * progress keep the prompt ids they started with.
 */
import type { BankPrompt } from "../lib/game/bank.js";
import { PROMPTS_PER_DIVE } from "../lib/game/scoring.js";
import { allPrompts } from "./bank.js";

export { DAILY_TIME_ZONE, dayKey } from "../lib/game/daily.js";
/** First day of the rotation. Days before it fall back to a plain seeded pick. */
export const SCHEDULE_EPOCH = "2026-11-01";

export function isDayKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function dayNumber(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
}

function dayFromNumber(n: number): string {
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

/** Small, fast, seedable PRNG (mulberry32) seeded from a string via FNV-1a. */
export function seededRandom(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIFFICULTY_ORDER = { easy: 0, medium: 1, hard: 2 } as const;

/** A prompt used on day d isn't eligible again until day d + NO_REPEAT_DAYS. */
export const NO_REPEAT_DAYS = 4;

function pickForDay(day: string, bank: readonly BankPrompt[], lastUsed: Map<string, number>): BankPrompt[] {
  const random = seededRandom(`bible-dive:${day}`);
  const today = dayNumber(day);
  const keyed = bank.map((p) => ({ p, last: lastUsed.get(p.id) ?? Number.NEGATIVE_INFINITY, r: random() }));
  keyed.sort((a, b) => a.last - b.last || a.r - b.r);
  const rested = keyed.filter((k) => today - k.last >= NO_REPEAT_DAYS);

  const picked: BankPrompt[] = [];
  const categories = new Set<string>();
  // 1) rested prompts, one per category  2) any rested prompt  3) (tiny banks only) least recently used
  for (const { p } of rested) {
    if (picked.length >= PROMPTS_PER_DIVE) break;
    if (!categories.has(p.category)) {
      picked.push(p);
      categories.add(p.category);
    }
  }
  for (const pool of [rested, keyed]) {
    for (const { p } of pool) {
      if (picked.length >= PROMPTS_PER_DIVE) break;
      if (!picked.includes(p)) picked.push(p);
    }
  }
  return picked
    .map((p, i) => ({ p, i }))
    .sort((a, b) => DIFFICULTY_ORDER[a.p.difficulty ?? "medium"] - DIFFICULTY_ORDER[b.p.difficulty ?? "medium"] || a.i - b.i)
    .map(({ p }) => p);
}

const cache = new WeakMap<readonly BankPrompt[], { through: number; lastUsed: Map<string, number>; days: Map<string, string[]> }>();

/** Today's prompt ids for a "YYYY-MM-DD" day. */
export function dailyPromptIds(day: string, bank: readonly BankPrompt[] = allPrompts()): string[] {
  if (!isDayKey(day)) throw new Error(`Bad day key: ${day}`);
  const epoch = dayNumber(SCHEDULE_EPOCH);
  const target = dayNumber(day);
  if (target < epoch) return pickForDay(day, bank, new Map()).map((p) => p.id);

  let state = cache.get(bank);
  if (!state) cache.set(bank, (state = { through: epoch - 1, lastUsed: new Map(), days: new Map() }));
  for (let d = state.through + 1; d <= target; d++) {
    const key = dayFromNumber(d);
    const picks = pickForDay(key, bank, state.lastUsed);
    for (const p of picks) state.lastUsed.set(p.id, d);
    state.days.set(key, picks.map((p) => p.id));
    state.through = d;
  }
  return [...state.days.get(day)!];
}
