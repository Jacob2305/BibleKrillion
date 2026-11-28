/**
 * Practice mode: random prompts, unlimited plays, nothing saved.
 *
 * Stateless flow (works on serverless with no database):
 *   start  → signed dive token listing 7 random prompt ids (prompt text NOT sent yet)
 *   begin  → reveals prompt #i's text and a signed prompt token with the deadline
 *   answer → matches server-side; accepted answers return the full reveal
 *   reveal → full answer list, but only once the prompt's deadline has passed
 *
 * The answer list for a prompt is only ever sent after the player has locked an
 * answer or the timer ran out.
 */
import type { AnswerResponse, DiveStartResponse, PromptBeginResponse, RevealResponse } from "../lib/game/api-types.js";
import { PROMPTS_PER_DIVE } from "../lib/game/scoring.js";
import { createHash } from "node:crypto";
import { getPrompt, matchPrompt, pickRandomPromptIds, publicPrompt, revealAnswer, revealFor, withTiers } from "./bank.js";
import { MAX_ANSWER_LENGTH, SUBMIT_GRACE_MS, promptSeconds } from "./config.js";
import { HttpError, json, readJsonBody, withErrors } from "./http.js";
import { aiRevealAnswer, defaultJudgeDeps, judgeRejectionMessage, judgeUnlisted, type JudgeDeps } from "./judge.js";
import { logRejectedAnswer } from "./rejections.js";
import { getTierStore, type TierStore } from "./tier-store.js";
import { signToken, verifyToken } from "./tokens.js";

export interface Deps {
  now: () => number;
  random: () => number;
  judge?: JudgeDeps;
  /** The host's permanent tier changes (defaults to the shared store). */
  tiers?: () => TierStore;
}

const DIVE_TTL_MS = 6 * 60 * 60 * 1000;

interface DiveToken {
  k: "practice-dive";
  ids: string[];
  iat: number;
  s: number;
}

interface PromptToken {
  k: "practice-prompt";
  pid: string;
  i: number;
  dl: number;
}

export const MESSAGES = {
  rejected: "Not in the bank — try again.",
  ambiguous: "Be more specific — that could be more than one answer.",
  empty: "Type an answer first.",
} as const;

function readDive(token: unknown, now: number): DiveToken {
  const dive = verifyToken<DiveToken>(token);
  if (!dive || dive.k !== "practice-dive" || !Array.isArray(dive.ids)) throw new HttpError(400, "Invalid dive.", "bad_token");
  if (now - dive.iat > DIVE_TTL_MS) throw new HttpError(410, "This ascent expired. Start a new one.", "expired");
  return dive;
}

async function readPrompt(token: unknown, deps: Deps) {
  const pt = verifyToken<PromptToken>(token);
  const prompt = pt && pt.k === "practice-prompt" ? getPrompt(pt.pid) : undefined;
  if (!pt || !prompt || typeof pt.dl !== "number") throw new HttpError(400, "Invalid prompt.", "bad_token");
  return { pt, prompt: withTiers(prompt, await (deps.tiers ?? getTierStore)().all()) };
}

export function start(deps: Deps): DiveStartResponse {
  const seconds = promptSeconds();
  const ids = pickRandomPromptIds(PROMPTS_PER_DIVE, deps.random);
  const token: DiveToken = { k: "practice-dive", ids, iat: deps.now(), s: seconds };
  return { dive: signToken(token), count: ids.length, seconds };
}

export function begin(body: Record<string, unknown>, deps: Deps): PromptBeginResponse {
  const now = deps.now();
  const dive = readDive(body.dive, now);
  const index = body.index;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= dive.ids.length) {
    throw new HttpError(400, "Invalid prompt index.");
  }
  const prompt = getPrompt(dive.ids[index]);
  if (!prompt) throw new HttpError(410, "That prompt no longer exists. Start a new ascent.", "stale");
  const deadline = now + dive.s * 1000;
  const token: PromptToken = { k: "practice-prompt", pid: prompt.id, i: index, dl: deadline };
  return {
    index,
    prompt: publicPrompt(prompt),
    promptToken: signToken(token),
    deadline,
    serverNow: now,
    seconds: dive.s,
  };
}

export async function answer(body: Record<string, unknown>, deps: Deps): Promise<AnswerResponse> {
  const { pt, prompt } = await readPrompt(body.promptToken, deps);
  if (deps.now() > pt.dl + SUBMIT_GRACE_MS) return { status: "too_late", reveal: revealFor(prompt) };

  const raw = typeof body.text === "string" ? body.text.slice(0, MAX_ANSWER_LENGTH) : "";
  const result = matchPrompt(prompt, raw);
  switch (result.kind) {
    case "fuzzy":
      // A corrected spelling: ask "Did you mean …?" first; the player confirms (or edits).
      if (body.confirm !== true) return { status: "confirm", suggestion: result.answer.canonical };
      return { status: "accepted", answer: revealAnswer(result.answer), reveal: revealFor(prompt) };
    case "exact":
      return { status: "accepted", answer: revealAnswer(result.answer), reveal: revealFor(prompt) };
    case "ambiguous":
      await logRejectedAnswer({ promptId: prompt.id, raw, reason: "ambiguous", mode: "practice" });
      return { status: "ambiguous", message: MESSAGES.ambiguous };
    case "empty":
      return { status: "empty", message: MESSAGES.empty };
    case "no_match": {
      // Each prompt attempt has its own token, so it doubles as the rate-limit key.
      const callerKey = `practice:${createHash("sha256").update(String(body.promptToken)).digest("hex").slice(0, 24)}`;
      const verdict = await judgeUnlisted({ prompt, raw, callerKey }, deps.judge ?? defaultJudgeDeps);
      if (verdict.kind === "bank") return { status: "accepted", answer: revealAnswer(verdict.answer), reveal: revealFor(prompt) };
      if (verdict.kind === "accepted") {
        return { status: "accepted", answer: aiRevealAnswer(verdict.canonical, verdict.reference), reveal: revealFor(prompt) };
      }
      await logRejectedAnswer({ promptId: prompt.id, raw, reason: "not_in_bank", mode: "practice" });
      return { status: "rejected", message: judgeRejectionMessage(verdict.reason, MESSAGES.rejected) };
    }
  }
}

export async function reveal(body: Record<string, unknown>, deps: Deps): Promise<RevealResponse> {
  const { pt, prompt } = await readPrompt(body.promptToken, deps);
  if (deps.now() < pt.dl) throw new HttpError(403, "This prompt is still running.", "too_early");
  return { reveal: revealFor(prompt) };
}

export function createPracticeHandler(deps: Deps = { now: Date.now, random: Math.random }) {
  return withErrors(async (request) => {
    const body = await readJsonBody(request);
    switch (body.action) {
      case "start":
        return json(start(deps));
      case "begin":
        return json(begin(body, deps));
      case "answer":
        return json(await answer(body, deps));
      case "reveal":
        return json(await reveal(body, deps));
      default:
        throw new HttpError(400, 'Unknown action. Use "start", "begin", "answer", or "reveal".');
    }
  });
}
