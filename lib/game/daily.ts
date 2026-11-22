/** Daily Ascent helpers shared by client and server (pure, no bank data). */
import { APP_NAME } from "./brand.js";
import { METERS_PER_POINT, TIER_INFO, diveRatingLabel, type ResultTier } from "./scoring.js";

export const DAILY_TIME_ZONE = "America/New_York";

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: DAILY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "YYYY-MM-DD" for the given instant in New York time (the Daily Dive resets at NY midnight). */
export function dayKey(nowMs: number): string {
  return dayFormatter.format(new Date(nowMs));
}

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: DAILY_TIME_ZONE,
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hourCycle: "h23",
});

/** Milliseconds until the next New York midnight (approximate on DST-change days). */
export function msUntilNextDay(nowMs: number): number {
  const parts = Object.fromEntries(timeFormatter.formatToParts(new Date(nowMs)).map((p) => [p.type, p.value]));
  const elapsed = (Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000 + (nowMs % 1000);
  return Math.max(0, 86_400_000 - elapsed);
}

/** "Fri, Nov 20" for "2026-11-20". */
export function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Spoiler-free share text: one emoji per prompt (by tier) and the total depth.
 * Never includes the prompts or answers.
 */
export function shareText(opts: { day: string; tiers: readonly ResultTier[]; total: number; url: string }): string {
  const emojis = opts.tiers.map((t) => TIER_INFO[t].emoji).join("");
  const depth = (opts.total * METERS_PER_POINT).toLocaleString("en-US");
  return `${APP_NAME} · ${dayLabel(opts.day)}\n${emojis}\n🕊️ ${depth} m · ${diveRatingLabel(opts.total)}\n${opts.url}`;
}
