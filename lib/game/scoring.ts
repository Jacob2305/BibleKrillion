/**
 * Bible Dive scoring: fixed rarity tiers, no live math.
 *
 * Every answer in the bank carries a pre-assigned tier. How many players gave an
 * answer is shown at reveal for fun but NEVER changes the points.
 *
 * Pure module: safe to import from the browser and from server functions.
 */

export const PROMPTS_PER_DIVE = 7;
export const DEFAULT_PROMPT_SECONDS = 25;
/** 1 point = 10 metres of depth. */
export const METERS_PER_POINT = 10;

/** Tiers an answer in the bank can have. */
export const ANSWER_TIERS = [
  "plankton",
  "too_clever",
  "schooler",
  "rare",
  "deep_cut",
  "one_in_a_million",
] as const;
export type AnswerTier = (typeof ANSWER_TIERS)[number];

/** Outcome of one prompt for one player: an answer tier, or a miss. */
export type ResultTier = AnswerTier | "miss";

export interface TierInfo {
  label: string;
  points: number;
  /** Used in the spoiler-free share card. */
  emoji: string;
  blurb: string;
}

export const TIER_INFO: Record<ResultTier, TierInfo> = {
  plankton: { label: "Plankton", points: 10, emoji: "🦐", blurb: "The answer everyone blurts out." },
  too_clever: { label: "Too Clever", points: 15, emoji: "🤓", blurb: "The 'obscure' pick everyone actually reaches for." },
  schooler: { label: "Schooler", points: 30, emoji: "🐟", blurb: "Familiar, one step off the main path." },
  rare: { label: "Rare", points: 60, emoji: "🐙", blurb: "Genuinely uncommon." },
  deep_cut: { label: "Deep Cut", points: 85, emoji: "🦑", blurb: "True obscurity." },
  one_in_a_million: { label: "One in a Million", points: 100, emoji: "💎", blurb: "Obscure and interesting: a gem." },
  miss: { label: "Miss", points: 0, emoji: "⬛", blurb: "No accepted answer before time ran out." },
};

/** Display order, shallowest to deepest, then miss. */
export const TIER_ORDER: readonly ResultTier[] = [...ANSWER_TIERS, "miss"];

export function isAnswerTier(value: unknown): value is AnswerTier {
  return typeof value === "string" && (ANSWER_TIERS as readonly string[]).includes(value);
}

export function isResultTier(value: unknown): value is ResultTier {
  return value === "miss" || isAnswerTier(value);
}

export function pointsForTier(tier: ResultTier): number {
  const info = TIER_INFO[tier];
  if (!info) throw new Error(`Unknown tier: ${String(tier)}`);
  return info.points;
}

/** Highest possible score for a dive with `promptCount` prompts (700 for a standard dive). */
export function maxDivePoints(promptCount: number = PROMPTS_PER_DIVE): number {
  return promptCount * TIER_INFO.one_in_a_million.points;
}

export function totalPoints(results: readonly ResultTier[]): number {
  return results.reduce((sum, tier) => sum + pointsForTier(tier), 0);
}

export function depthMeters(points: number): number {
  return Math.max(0, points) * METERS_PER_POINT;
}

/** Final dive rating bands. */
export type DiveRating = "plankton" | "schooler" | "rare" | "deep_cut" | "one_in_a_million";

export const DIVE_RATING_BANDS: readonly { rating: DiveRating; min: number; max: number }[] = [
  { rating: "plankton", min: 0, max: 150 },
  { rating: "schooler", min: 151, max: 250 },
  { rating: "rare", min: 251, max: 350 },
  { rating: "deep_cut", min: 351, max: 449 },
  { rating: "one_in_a_million", min: 450, max: Number.POSITIVE_INFINITY },
];

export function diveRating(total: number): DiveRating {
  if (!Number.isFinite(total) || total < 0) return "plankton";
  // Totals are always multiples of 5, but floor defensively so a fractional value can't fall between bands.
  const t = Math.floor(total);
  for (const band of DIVE_RATING_BANDS) {
    if (t >= band.min && t <= band.max) return band.rating;
  }
  return "plankton";
}

export function diveRatingLabel(total: number): string {
  return TIER_INFO[diveRating(total)].label;
}
