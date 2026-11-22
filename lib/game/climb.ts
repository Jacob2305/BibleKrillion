/**
 * The reveal climb: the world is a tower of zones, one per answer tier, from the
 * sea (Plankton) up to the cosmos (One in a Million). The camera position is
 * measured in zones: 0 = the sea zone is filling the screen, 5 = the cosmos.
 *
 * Pure module (no DOM), shared by the animation and its tests.
 */
import { ANSWER_TIERS, METERS_PER_POINT, TIER_INFO, type AnswerTier, type ResultTier } from "./scoring.js";

export interface ClimbZone {
  tier: AnswerTier;
  /** Where you are when you land here. */
  place: string;
}

/** Bottom to top. Altitude follows points, so the zones follow ANSWER_TIERS. */
export const CLIMB_ZONES: readonly ClimbZone[] = [
  { tier: "plankton", place: "The Sea" },
  { tier: "too_clever", place: "Creekside" },
  { tier: "schooler", place: "Open Sky" },
  { tier: "rare", place: "Edge of Space" },
  { tier: "deep_cut", place: "Outer Space" },
  { tier: "one_in_a_million", place: "The Cosmos" },
];

/** Where the climb starts: just below the sea zone, with the climber sitting on the waves. */
export const CLIMB_START = -0.12;

export function zoneIndex(tier: AnswerTier): number {
  return ANSWER_TIERS.indexOf(tier);
}

/** Camera position (in zones) where a climb to this result ends. A miss never leaves the water. */
export function climbTarget(tier: ResultTier): number {
  return tier === "miss" ? CLIMB_START : zoneIndex(tier);
}

/** How long the camera takes to climb to `tier` (the higher, the longer, for suspense). */
export function climbDurationMs(tier: ResultTier, scale = 1): number {
  if (tier === "miss") return 0;
  return Math.round((650 + 520 * zoneIndex(tier)) * scale);
}

/** Metres shown on the climb's altimeter at camera position `c`: 0 on the water, each tier's metres at its zone. */
export function metersAtCamera(c: number): number {
  const stops = [CLIMB_START, ...CLIMB_ZONES.map((_, i) => i)];
  const values = [0, ...CLIMB_ZONES.map((z) => TIER_INFO[z.tier].points * METERS_PER_POINT)];
  if (c <= stops[0]!) return 0;
  for (let i = 1; i < stops.length; i++) {
    if (c <= stops[i]!) {
      const t = (c - stops[i - 1]!) / (stops[i]! - stops[i - 1]!);
      return Math.round(values[i - 1]! + (values[i]! - values[i - 1]!) * t);
    }
  }
  return values[values.length - 1]!;
}

/** Ease in and out, so the climb builds speed and then settles onto the tier. */
export function easeClimb(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** The rarest tier any player reached this round (for the projector's room climb), or null if nobody scored. */
export function highestTier(tiers: Iterable<AnswerTier>): AnswerTier | null {
  let best = -1;
  for (const t of tiers) best = Math.max(best, zoneIndex(t));
  return best < 0 ? null : ANSWER_TIERS[best]!;
}
