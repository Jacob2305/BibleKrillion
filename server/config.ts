/** Server-side settings read from environment variables. */
import { DEFAULT_PROMPT_SECONDS } from "../lib/game/scoring.js";

/** Seconds per prompt (env PROMPT_SECONDS, clamped 5–120). */
export function promptSeconds(): number {
  const raw = Number(process.env.PROMPT_SECONDS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_PROMPT_SECONDS;
  return Math.min(120, Math.max(5, Math.round(raw)));
}

/**
 * A submission that reaches the server up to this long after the deadline still
 * counts: it was sent before time ran out but spent a moment on the network.
 */
export const SUBMIT_GRACE_MS = 1500;

/** Longest answer text we will look at. */
export const MAX_ANSWER_LENGTH = 100;

/** True when running as a real (shared, multi-instance) Vercel deployment. */
export function isDeployed(): boolean {
  return process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview";
}
