/**
 * Server-side access to the answer bank. This is the ONLY place the bank is loaded.
 */
import bankJson from "../data/prompts.json" with { type: "json" };
import type { PromptReveal, PublicPrompt, RevealAnswer } from "../lib/game/api-types.js";
import { buildPromptMatcher, type Bank, type BankAnswer, type BankPrompt } from "../lib/game/bank.js";
import type { Matcher, MatchResult } from "../lib/game/matching.js";
import { pointsForTier } from "../lib/game/scoring.js";

const BANK = bankJson as unknown as Bank;
const BY_ID = new Map(BANK.map((p) => [p.id, p]));
const MATCHERS = new Map<string, Matcher<BankAnswer>>();

export function allPrompts(): readonly BankPrompt[] {
  return BANK;
}

export function getPrompt(id: unknown): BankPrompt | undefined {
  return typeof id === "string" ? BY_ID.get(id) : undefined;
}

/** Match player text against one prompt (matchers are built once per warm instance). */
export function matchPrompt(prompt: BankPrompt, text: string): MatchResult<BankAnswer> {
  let matcher = MATCHERS.get(prompt.id);
  if (!matcher) MATCHERS.set(prompt.id, (matcher = buildPromptMatcher(prompt)));
  return matcher(text);
}

export function publicPrompt(prompt: BankPrompt): PublicPrompt {
  return {
    id: prompt.id,
    prompt: prompt.prompt,
    category: prompt.category,
    testament: prompt.testament,
    closedSet: prompt.closed_set,
  };
}

export function revealAnswer(answer: BankAnswer): RevealAnswer {
  const out: RevealAnswer = {
    canonical: answer.canonical,
    tier: answer.tier,
    points: pointsForTier(answer.tier),
    reference: answer.reference,
  };
  if (answer.tier === "one_in_a_million" && answer.gem_note) out.gemNote = answer.gem_note;
  if (answer.generic_for) out.genericFor = answer.generic_for;
  return out;
}

/** Full answer list for the reveal screen, deepest tier first, then A–Z. */
export function revealFor(prompt: BankPrompt): PromptReveal {
  const answers = prompt.answers
    .map(revealAnswer)
    .sort((a, b) => b.points - a.points || a.canonical.localeCompare(b.canonical));
  return { promptId: prompt.id, prompt: prompt.prompt, answers };
}

/**
 * Pick `count` distinct random prompts, avoiding two from the same category when
 * the bank allows it (e.g. not both "sons of Jacob" and "tribes" in one dive).
 */
export function pickRandomPromptIds(count: number, random: () => number = Math.random, bank: readonly BankPrompt[] = BANK): string[] {
  const shuffled = [...bank];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  const picked: BankPrompt[] = [];
  const categories = new Set<string>();
  for (const p of shuffled) {
    if (picked.length >= count) break;
    if (!categories.has(p.category)) {
      picked.push(p);
      categories.add(p.category);
    }
  }
  for (const p of shuffled) {
    if (picked.length >= count) break;
    if (!picked.includes(p)) picked.push(p);
  }
  return picked.map((p) => p.id);
}
