/**
 * Server-side answer matching.
 *
 * This module is pure, but ONLY server code should call it with real bank data.
 * The answer bank must never reach the browser before a prompt is over.
 *
 * Rules:
 *  - Input and every bank term (canonical + aliases) go through `normalizeAnswer`.
 *  - An exact or alias match always beats a fuzzy one.
 *  - Fuzzy matching uses Levenshtein distance: ≤1 edit when the bank term is
 *    ≤5 characters, ≤2 edits when it is longer. Terms and inputs shorter than
 *    3 characters ("Ai", "Ur") must match exactly, so "a" can't fuzzy-match "ai".
 *  - If two or more DIFFERENT answers tie for the closest fuzzy distance, the
 *    result is "ambiguous": rejected, and the player is asked to be more specific.
 *    A strictly closer answer wins ("1 king" -> 1 Kings, distance 1, beats 2 Kings, distance 2).
 *  - If the same exact term somehow belongs to two answers (a bank error the
 *    validator catches), that is also "ambiguous".
 *  - Shared names are modelled in the BANK, not here: "James" is its own answer
 *    (low tier, `generic_for` the specific Jameses), and "James son of Alphaeus"
 *    is a separate, higher-tier answer. Being more specific earns more points.
 */
import { levenshtein } from "./levenshtein.js";
import { normalizeAnswer } from "./normalize.js";

export interface MatchableAnswer {
  canonical: string;
  aliases?: readonly string[];
}

export type MatchResult<A extends MatchableAnswer = MatchableAnswer> =
  | { kind: "exact"; answer: A; index: number; term: string }
  | { kind: "fuzzy"; answer: A; index: number; term: string; distance: number }
  | { kind: "ambiguous"; candidates: A[]; via: "exact" | "fuzzy" }
  | { kind: "no_match" }
  | { kind: "empty" };

/** Shortest term/input length eligible for fuzzy matching. */
export const MIN_FUZZY_LENGTH = 3;

/** Maximum edits allowed when fuzzy-matching against a normalized bank term. */
export function maxEditsFor(normalizedTerm: string): number {
  const len = Array.from(normalizedTerm).length;
  if (len < MIN_FUZZY_LENGTH) return 0;
  return len <= 5 ? 1 : 2;
}

/** All normalized, de-duplicated terms (canonical first, then aliases) for one answer. */
export function termsFor(answer: MatchableAnswer): string[] {
  const out: string[] = [];
  for (const raw of [answer.canonical, ...(answer.aliases ?? [])]) {
    const term = normalizeAnswer(raw);
    if (term && !out.includes(term)) out.push(term);
  }
  return out;
}

export type Matcher<A extends MatchableAnswer> = (input: string) => MatchResult<A>;

export interface MatcherOptions {
  /**
   * Per-prompt filler phrases removed from the START of the player's input before
   * matching, e.g. ["mount", "mt"] so "Mount Sinai" -> "sinai", or ["parable of"]
   * so "The parable of the sower" -> "sower". The unstripped input is always
   * tried first, so a bank term like "Mount of Olives" still matches exactly.
   */
  stripPrefixes?: readonly string[];
}

/**
 * The normalized input plus each successively prefix-stripped form, unstripped first.
 * Stripping never empties the input.
 */
export function inputVariants(input: string, stripPrefixes: readonly string[] = []): string[] {
  const prefixes = stripPrefixes
    .map(normalizeAnswer)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const variants = [normalizeAnswer(input)];
  if (!variants[0]) return [];
  for (let guard = 0; guard < 5; guard++) {
    const current = variants[variants.length - 1]!;
    const prefix = prefixes.find((p) => current.startsWith(p + " "));
    if (!prefix) break;
    const rest = normalizeAnswer(current.slice(prefix.length + 1));
    if (!rest || variants.includes(rest)) break;
    variants.push(rest);
  }
  return variants;
}

/**
 * Precompute normalized terms for one prompt's answers and return a fast matcher.
 * Build once per prompt (e.g. cache at module scope in a serverless function).
 */
export function buildMatcher<A extends MatchableAnswer>(
  answers: readonly A[],
  options: MatcherOptions = {},
): Matcher<A> {
  const stripPrefixes = options.stripPrefixes ?? [];
  const entries: { term: string; index: number; maxEdits: number }[] = [];
  const exact = new Map<string, Set<number>>();

  answers.forEach((answer, index) => {
    for (const term of termsFor(answer)) {
      entries.push({ term, index, maxEdits: maxEditsFor(term) });
      let owners = exact.get(term);
      if (!owners) exact.set(term, (owners = new Set()));
      owners.add(index);
    }
  });

  return (input: string): MatchResult<A> => {
    const variants = inputVariants(input, stripPrefixes);
    if (variants.length === 0) return { kind: "empty" };

    // 1. Exact / alias match always wins (unstripped input first, then stripped forms).
    for (const variant of variants) {
      const owners = exact.get(variant);
      if (!owners || owners.size === 0) continue;
      const indexes = [...owners];
      if (indexes.length === 1) {
        const index = indexes[0]!;
        return { kind: "exact", answer: answers[index]!, index, term: variant };
      }
      return { kind: "ambiguous", via: "exact", candidates: indexes.map((i) => answers[i]!) };
    }

    // 2. Fuzzy match: closest distance per answer, within that term's allowance.
    const best = new Map<number, { distance: number; term: string }>();
    for (const variant of variants) {
      if (Array.from(variant).length < MIN_FUZZY_LENGTH) continue;
      for (const { term, index, maxEdits } of entries) {
        if (maxEdits === 0) continue;
        const distance = levenshtein(variant, term, maxEdits);
        if (distance > maxEdits) continue;
        const current = best.get(index);
        if (!current || distance < current.distance) best.set(index, { distance, term });
      }
    }
    if (best.size === 0) return { kind: "no_match" };

    let minDistance = Number.POSITIVE_INFINITY;
    for (const { distance } of best.values()) minDistance = Math.min(minDistance, distance);
    const closest = [...best.entries()].filter(([, v]) => v.distance === minDistance);

    if (closest.length > 1) {
      return { kind: "ambiguous", via: "fuzzy", candidates: closest.map(([i]) => answers[i]!) };
    }
    const [index, { term, distance }] = closest[0]!;
    return { kind: "fuzzy", answer: answers[index]!, index, term, distance };
  };
}

/** One-off convenience wrapper. Prefer `buildMatcher` when matching many inputs. */
export function matchAnswer<A extends MatchableAnswer>(
  input: string,
  answers: readonly A[],
  options?: MatcherOptions,
): MatchResult<A> {
  return buildMatcher(answers, options)(input);
}

/** True when the result means the answer is accepted and locks for this prompt. */
export function isAccepted<A extends MatchableAnswer>(
  result: MatchResult<A>,
): result is Extract<MatchResult<A>, { kind: "exact" | "fuzzy" }> {
  return result.kind === "exact" || result.kind === "fuzzy";
}

/** Collisions further apart than this are too unlikely to be worth a warning. */
export const COLLISION_WARN_DISTANCE = 2;

/**
 * Pairs of terms from DIFFERENT answers in the same prompt that are close enough
 * for a realistic typo to land between them (e.g. "Eli" vs "Elon"). Used by the
 * bank validator to warn, not fail.
 */
export function findFuzzyCollisions(
  answers: readonly MatchableAnswer[],
): { a: string; b: string; termA: string; termB: string; distance: number }[] {
  const entries = answers.flatMap((answer, index) => termsFor(answer).map((term) => ({ term, index })));
  const out: { a: string; b: string; termA: string; termB: string; distance: number }[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const x = entries[i]!;
      const y = entries[j]!;
      if (x.index === y.index) continue;
      // A typo can be within BOTH allowances only if distance ≤ allowanceX + allowanceY
      // (triangle inequality). Of those, only warn about genuinely close pairs.
      const reach = Math.min(maxEditsFor(x.term) + maxEditsFor(y.term), COLLISION_WARN_DISTANCE);
      if (maxEditsFor(x.term) === 0 && maxEditsFor(y.term) === 0) continue;
      const distance = levenshtein(x.term, y.term, reach);
      if (distance <= reach && distance > 0) {
        out.push({
          a: answers[x.index]!.canonical,
          b: answers[y.index]!.canonical,
          termA: x.term,
          termB: y.term,
          distance,
        });
      }
    }
  }
  return out;
}
