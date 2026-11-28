/**
 * Daily Dive: the same 7 prompts for everyone today (America/New_York), one
 * official attempt per device per day, results saved for the day's distribution.
 *
 * Unlike Practice, attempts are tracked server-side so a prompt can only be
 * started once: refreshing or replaying a request resumes the same deadline
 * instead of restarting the clock after you've seen the answers.
 *
 *   start  { deviceId, nickname } → dive token (+ completed rounds when resuming)
 *   begin  { dive, index }        → prompt text + prompt token (prompts in order, once each)
 *   answer { promptToken, text }  → server-side match; first accepted answer locks the round
 *   reveal { promptToken }        → after the deadline: answer list, round recorded as a miss
 *   finish { dive }               → total, standing, and today's answer distribution
 */
import type {
  AnswerResponse,
  CompletedRound,
  DailyFinishResponse,
  DistributionAnswer,
  DiveStartResponse,
  PromptBeginResponse,
  PromptDistribution,
  RevealResponse,
} from "../lib/game/api-types.js";
import type { BankPrompt } from "../lib/game/bank.js";
import type { RevealAnswer } from "../lib/game/api-types.js";
import { diveRating, pointsForTier } from "../lib/game/scoring.js";
import { getPrompt, matchPrompt, publicPrompt, revealAnswer, revealFor, withTiers } from "./bank.js";
import { MAX_ANSWER_LENGTH, SUBMIT_GRACE_MS, promptSeconds } from "./config.js";
import { dailyPromptIds, dayKey } from "./daily-schedule.js";
import { getDailyStore, type DailyAttempt, type DailyRound, type DailyStore } from "./daily-store.js";
import { HttpError, json, readJsonBody, withErrors } from "./http.js";
import { aiRevealAnswer, defaultJudgeDeps, judgeRejectionMessage, judgeSuggestion, judgeUnlisted, type JudgeDeps } from "./judge.js";
import { cleanNickname } from "./names.js";
import { logRejectedAnswer } from "./rejections.js";
import { getTierStore, type TierStore } from "./tier-store.js";
import { signToken, verifyToken } from "./tokens.js";

export interface DailyDeps {
  now: () => number;
  store: () => DailyStore;
  judge?: JudgeDeps;
  /** The host's permanent tier changes (defaults to the shared store). */
  tiers?: () => TierStore;
}

interface DiveToken {
  k: "daily-dive";
  aid: string;
  s: number;
}

interface PromptToken {
  k: "daily-prompt";
  aid: string;
  i: number;
  pid: string;
  dl: number;
}

export const DAILY_MESSAGES = {
  rejected: "Not in the bank — try again.",
  ambiguous: "Be more specific — that could be more than one answer.",
  empty: "Type an answer first.",
} as const;

const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;

export { cleanNickname };

/** The answer a finished round locked: from the bank, or one the AI judge accepted. */
function roundAnswer(prompt: BankPrompt, round: DailyRound): RevealAnswer | null {
  if (!round.canonical) return null;
  const bank = prompt.answers.find((a) => a.canonical === round.canonical);
  if (bank) return revealAnswer(bank);
  return round.ai && round.reference ? aiRevealAnswer(round.canonical, round.reference) : null;
}

function completedRounds(attempt: DailyAttempt): CompletedRound[] {
  const out: CompletedRound[] = [];
  for (const r of attempt.rounds) {
    const prompt = getPrompt(r.promptId);
    if (!r.tier || !prompt) break;
    out.push({ prompt: publicPrompt(prompt), tier: r.tier, answer: roundAnswer(prompt, r) });
  }
  return out;
}

async function loadAttempt(store: DailyStore, aid: string): Promise<DailyAttempt> {
  const attempt = await store.getAttempt(aid);
  if (!attempt) throw new HttpError(404, "This dive no longer exists. Reload the page.", "stale");
  return attempt;
}

function readDiveToken(token: unknown): DiveToken {
  const dive = verifyToken<DiveToken>(token);
  if (!dive || dive.k !== "daily-dive" || typeof dive.aid !== "string") throw new HttpError(400, "Invalid dive.", "bad_token");
  return dive;
}

async function readPromptToken(token: unknown, store: DailyStore, deps: DailyDeps) {
  const pt = verifyToken<PromptToken>(token);
  const bankPrompt = pt && pt.k === "daily-prompt" ? getPrompt(pt.pid) : undefined;
  if (!pt || !bankPrompt) throw new HttpError(400, "Invalid prompt.", "bad_token");
  const prompt = withTiers(bankPrompt, await (deps.tiers ?? getTierStore)().all());
  const attempt = await loadAttempt(store, pt.aid);
  const round = attempt.rounds[pt.i];
  if (!round || round.promptId !== pt.pid) throw new HttpError(409, "Out of sync. Reload the page.", "out_of_sync");
  return { pt, prompt, attempt, round };
}

export async function start(body: Record<string, unknown>, deps: DailyDeps): Promise<DiveStartResponse> {
  const deviceId = body.deviceId;
  if (typeof deviceId !== "string" || !DEVICE_ID.test(deviceId)) throw new HttpError(400, "Invalid device id.");
  const nickname = cleanNickname(body.nickname);
  if (!nickname) throw new HttpError(400, "Pick a name first.", "nickname");

  const day = dayKey(deps.now());
  const attempt = await deps.store().getOrCreateAttempt({ day, deviceId, nickname, promptIds: dailyPromptIds(day) });
  const seconds = promptSeconds();
  const token: DiveToken = { k: "daily-dive", aid: attempt.id, s: seconds };
  return {
    dive: signToken(token),
    count: attempt.promptIds.length,
    seconds,
    day: attempt.day,
    completed: completedRounds(attempt),
    finished: attempt.finished,
  };
}

export async function begin(body: Record<string, unknown>, deps: DailyDeps): Promise<PromptBeginResponse> {
  const dive = readDiveToken(body.dive);
  const store = deps.store();
  const attempt = await loadAttempt(store, dive.aid);
  const index = body.index;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= attempt.promptIds.length) {
    throw new HttpError(400, "Invalid prompt index.");
  }
  if (attempt.finished) throw new HttpError(409, "You've already finished today's ascent.", "out_of_sync");

  const now = deps.now();
  let round = attempt.rounds[index];
  if (round) {
    // Resuming (e.g. after a refresh): same deadline, never a fresh clock.
    if (round.tier) throw new HttpError(409, "You already played that prompt.", "out_of_sync");
  } else {
    const previous = attempt.rounds[index - 1];
    if (index !== attempt.rounds.length || (previous && !previous.tier)) {
      throw new HttpError(409, "Prompts are played in order.", "out_of_sync");
    }
    round = { promptId: attempt.promptIds[index]!, deadline: now + dive.s * 1000 };
    await store.saveRounds(attempt.id, [...attempt.rounds, round]);
  }

  const prompt = getPrompt(round.promptId);
  if (!prompt) throw new HttpError(410, "That prompt was removed from the bank.", "stale");
  const token: PromptToken = { k: "daily-prompt", aid: attempt.id, i: index, pid: prompt.id, dl: round.deadline };
  return {
    index,
    prompt: publicPrompt(prompt),
    promptToken: signToken(token),
    deadline: round.deadline,
    serverNow: now,
    seconds: dive.s,
  };
}

async function closeRound(store: DailyStore, attempt: DailyAttempt, index: number, patch: Partial<DailyRound>, now: number) {
  const rounds = attempt.rounds.map((r, i) => (i === index ? { ...r, ...patch, doneAt: now } : r));
  await store.saveRounds(attempt.id, rounds);
}

export async function answer(body: Record<string, unknown>, deps: DailyDeps): Promise<AnswerResponse> {
  const store = deps.store();
  const { pt, prompt, attempt, round } = await readPromptToken(body.promptToken, store, deps);

  // Round already over: repeat its outcome (one accepted answer per prompt, then it locks).
  if (round.tier) return lockedOutcome(prompt, round);

  const now = deps.now();
  if (now > round.deadline + SUBMIT_GRACE_MS) {
    await closeRound(store, attempt, pt.i, { tier: "miss", canonical: null }, now);
    return { status: "too_late", reveal: revealFor(prompt) };
  }

  const raw = typeof body.text === "string" ? body.text.slice(0, MAX_ANSWER_LENGTH) : "";
  const result = matchPrompt(prompt, raw);
  switch (result.kind) {
    case "exact":
    case "fuzzy":
      // A corrected spelling: ask "Did you mean …?" first; the player confirms (or edits).
      if (result.kind === "fuzzy" && body.confirm !== true) return { status: "confirm", suggestion: result.answer.canonical };
      await closeRound(store, attempt, pt.i, { tier: result.answer.tier, canonical: result.answer.canonical }, now);
      return { status: "accepted", answer: revealAnswer(result.answer), reveal: revealFor(prompt) };
    case "ambiguous":
      await logRejectedAnswer({ promptId: prompt.id, raw, reason: "ambiguous", mode: "daily" });
      return { status: "ambiguous", message: DAILY_MESSAGES.ambiguous };
    case "empty":
      return { status: "empty", message: DAILY_MESSAGES.empty };
    case "no_match": {
      // The answer arrived in time (checked above), so it counts even if the judge takes a few seconds.
      const verdict = await judgeUnlisted({ prompt, raw, callerKey: `daily:${attempt.id}:${pt.i}` }, deps.judge ?? defaultJudgeDeps);
      if (verdict.kind === "rejected") {
        await logRejectedAnswer({ promptId: prompt.id, raw, reason: "not_in_bank", mode: "daily" });
        return { status: "rejected", message: judgeRejectionMessage(verdict.reason, DAILY_MESSAGES.rejected) };
      }
      // A different wording or spelling than typed: recommend it, never lock it unasked.
      const suggestion = judgeSuggestion(raw, verdict);
      if (suggestion && body.confirm !== true) return { status: "confirm", suggestion };
      // Re-read: the round may have been settled while the judge was thinking.
      const fresh = await loadAttempt(store, attempt.id);
      const freshRound = fresh.rounds[pt.i];
      if (!freshRound || freshRound.tier) return freshRound ? lockedOutcome(prompt, freshRound) : { status: "too_late", reveal: revealFor(prompt) };
      const patch: Partial<DailyRound> =
        verdict.kind === "bank"
          ? { tier: verdict.answer.tier, canonical: verdict.answer.canonical }
          : { tier: "deep_cut", canonical: verdict.canonical, ai: true, reference: verdict.reference };
      await closeRound(store, fresh, pt.i, patch, now);
      const answer = verdict.kind === "bank" ? revealAnswer(verdict.answer) : aiRevealAnswer(verdict.canonical, verdict.reference);
      return { status: "accepted", answer, reveal: revealFor(prompt) };
    }
  }
}

function lockedOutcome(prompt: BankPrompt, round: DailyRound): AnswerResponse {
  const answer = roundAnswer(prompt, round);
  return answer ? { status: "accepted", answer, reveal: revealFor(prompt) } : { status: "too_late", reveal: revealFor(prompt) };
}

export async function reveal(body: Record<string, unknown>, deps: DailyDeps): Promise<RevealResponse> {
  const store = deps.store();
  const { pt, prompt, attempt, round } = await readPromptToken(body.promptToken, store, deps);
  const now = deps.now();
  if (!round.tier) {
    if (now < round.deadline) throw new HttpError(403, "This prompt is still running.", "too_early");
    // A submission may still be in flight during the grace window; it closes the round itself.
    await closeRound(store, attempt, pt.i, { tier: "miss", canonical: null }, now);
  }
  return { reveal: revealFor(prompt) };
}

function buildDistribution(prompts: BankPrompt[], rows: Awaited<ReturnType<DailyStore["distribution"]>>, players: number): PromptDistribution[] {
  return prompts.map((prompt) => {
    const answers: DistributionAnswer[] = rows
      .filter((r) => r.promptId === prompt.id)
      .map((r) => ({ canonical: r.canonical, tier: r.tier, points: pointsForTier(r.tier), count: r.n }))
      .sort((a, b) => b.count - a.count || b.points - a.points);
    return { promptId: prompt.id, prompt: prompt.prompt, players, answers };
  });
}

export async function finish(body: Record<string, unknown>, deps: DailyDeps): Promise<DailyFinishResponse> {
  const dive = readDiveToken(body.dive);
  const store = deps.store();
  let attempt = await loadAttempt(store, dive.aid);
  const rounds = completedRounds(attempt);
  if (rounds.length < attempt.promptIds.length) throw new HttpError(409, "Finish all 7 prompts first.", "out_of_sync");

  const total = rounds.reduce((sum, r) => sum + pointsForTier(r.tier), 0);
  if (!attempt.finished) {
    await store.finish(attempt.id, total);
    attempt = { ...attempt, finished: true, total };
  }
  const [standing, rows] = await Promise.all([store.standing(attempt.day, total), store.distribution(attempt.day)]);
  const prompts = attempt.promptIds.map((id) => getPrompt(id)).filter((p): p is BankPrompt => Boolean(p));
  return {
    day: attempt.day,
    nickname: attempt.nickname,
    total,
    rating: diveRating(total),
    rounds,
    players: standing.players,
    shallower: standing.shallower,
    distribution: buildDistribution(prompts, rows, standing.players),
  };
}

export function createDailyHandler(deps: DailyDeps = { now: Date.now, store: getDailyStore }) {
  return withErrors(async (request) => {
    const body = await readJsonBody(request);
    switch (body.action) {
      case "start":
        return json(await start(body, deps));
      case "begin":
        return json(await begin(body, deps));
      case "answer":
        return json(await answer(body, deps));
      case "reveal":
        return json(await reveal(body, deps));
      case "finish":
        return json(await finish(body, deps));
      default:
        throw new HttpError(400, 'Unknown action. Use "start", "begin", "answer", "reveal", or "finish".');
    }
  });
}
