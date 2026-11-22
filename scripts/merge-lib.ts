/** Pure logic for `npm run merge-approved` (kept separate so it can be tested). */
import { buildPromptMatcher, type Bank, type BankAnswer } from "../lib/game/bank.js";
import { normalizeAnswer } from "../lib/game/normalize.js";

export interface ApprovedAnswer {
  promptId: string;
  canonical: string;
  reference: string;
  reason: string;
  /** What players typed. Useful spellings become aliases. */
  variants: string[];
}

export interface MergeResult {
  bank: Bank;
  added: { promptId: string; answer: BankAnswer }[];
  /** Already in the bank (nothing to add, but safe to mark as merged). */
  alreadyPresent: ApprovedAnswer[];
  /** Couldn't be merged; left for a human. */
  skipped: { item: ApprovedAnswer; why: string }[];
}

const MAX_ALIASES = 5;

export function mergeApproved(bank: Bank, approved: readonly ApprovedAnswer[], date: string): MergeResult {
  const next: Bank = structuredClone(bank) as Bank;
  const result: MergeResult = { bank: next, added: [], alreadyPresent: [], skipped: [] };
  for (const item of approved) {
    const prompt = next.find((p) => p.id === item.promptId);
    if (!prompt) {
      result.skipped.push({ item, why: "that prompt is no longer in the bank" });
      continue;
    }
    if (prompt.closed_set) {
      result.skipped.push({ item, why: "closed-set prompts list every answer already; check it by hand" });
      continue;
    }
    if (!item.canonical.trim() || !item.reference.trim()) {
      result.skipped.push({ item, why: "missing name or reference" });
      continue;
    }
    const matcher = buildPromptMatcher(prompt); // rebuilt each time so answers added earlier in this run count
    const existing = matcher(item.canonical);
    if (existing.kind === "exact") {
      result.alreadyPresent.push(item);
      continue;
    }
    if (existing.kind === "fuzzy" || existing.kind === "ambiguous") {
      result.skipped.push({ item, why: `too close to an existing answer (${existing.kind === "fuzzy" ? existing.answer.canonical : "several"}); add it by hand if it's really different` });
      continue;
    }
    const canonicalKey = normalizeAnswer(item.canonical);
    const seen = new Set([canonicalKey]);
    const aliases: string[] = [];
    for (const v of item.variants) {
      const key = normalizeAnswer(v);
      if (!key || seen.has(key) || aliases.length >= MAX_ALIASES) continue;
      if (matcher(v).kind !== "no_match") continue; // would collide with another answer
      seen.add(key);
      aliases.push(v.trim());
    }
    const answer: BankAnswer = {
      canonical: item.canonical.trim(),
      aliases,
      tier: "deep_cut",
      reference: item.reference.trim(),
      needs_review: true,
      review_note: `Added from the AI judge (host-approved ${date}).${item.reason ? ` ${item.reason}` : ""}`,
    };
    prompt.answers.push(answer);
    result.added.push({ promptId: prompt.id, answer });
  }
  return result;
}
