/**
 * Server-side answer matching.
 *
 * This module is pure, but ONLY server code should call it with real bank data.
 * The answer bank must never reach the browser before a prompt is over.
 *
 * Rules:
 *  - Input and every bank term (canonical + aliases) go through `normalizeAnswer`.
 *  - An exact or alias match always beats a fuzzy one.
 *  - Fuzzy matching is lenient (the server always asks "Did you mean …?" before
 *    accepting a fuzzy match, so a generous guess costs nothing):
 *      · edit distance where a swapped letter pair counts as 1 edit,
 *      · also compared on a sound-alike spelling ("Zakeus" ~ "Zacchaeus",
 *        "Thesalonika" ~ "Thessalonica"), taking whichever is closer,
 *      · allowance grows with the term: 1 edit for 3–4 letters, 2 for 5–7,
 *        3 for 8–11, 4 for longer.
 *    A correction of 2+ edits must start with the same sound as the input.
 *    Terms and inputs shorter than 3 characters ("Ai", "Ur") must match exactly.
 *  - A strictly closer answer wins ("1 king" -> 1 Kings beats 2 Kings). A tie
 *    for closest is broken by: fewer raw edits, then same first sound.
 *    Only a tie that survives all of that is "ambiguous"
 *    (rejected; the player is asked to be more specific).
 *  - If the same exact term somehow belongs to two answers (a bank error the
 *    validator catches), that is also "ambiguous".
 *  - Shared names are modelled in the BANK, not here: "James" is its own answer
 *    (low tier, `generic_for` the specific Jameses), and "James son of Alphaeus"
 *    is a separate, higher-tier answer. Being more specific earns more points.
 */
import { levenshtein, typoDistance } from "./levenshtein.js";
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
  if (len <= 4) return 1;
  if (len <= 7) return 2;
  if (len <= 11) return 3;
  return 4;
}

/**
 * A rough sound-alike spelling of a normalized term, so spellings that sound
 * right still land: ph/f, ch/k, c/k/s, z/s, y/i, ae/e, silent h, doubled letters.
 */
export function soundSkeleton(normalized: string): string {
  return normalized
    .replace(/ph/g, "f")
    .replace(/ch/g, "k")
    .replace(/ck/g, "k")
    .replace(/th/g, "t")
    .replace(/[ao]e/g, "e")
    .replace(/q/g, "k")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/c/g, "k")
    .replace(/x/g, "ks")
    .replace(/z/g, "s")
    .replace(/y/g, "i")
    .replace(/([^aeiou\s])h/g, "$1")
    .replace(/(.)\1+/g, "$1");
}

/** First letter of a sound skeleton, ignoring a leading book number ("1 kings" -> "k"). */
function firstSound(skel: string): string | undefined {
  return skel.replace(/^[\d\s]+/, "")[0];
}

/** Fuzzy distance used for matching: the closer of the raw and sound-alike comparisons. */
function fuzzyDistance(input: string, inputSkel: string, term: string, termSkel: string, max: number): number {
  const raw = typoDistance(input, term, max);
  if (raw <= 1) return raw;
  return Math.min(raw, typoDistance(inputSkel, termSkel, max));
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
  const entries: { term: string; skel: string; index: number; maxEdits: number }[] = [];
  const exact = new Map<string, Set<number>>();

  answers.forEach((answer, index) => {
    for (const term of termsFor(answer)) {
      entries.push({ term, skel: soundSkeleton(term), index, maxEdits: maxEditsFor(term) });
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

    // 2. Fuzzy match: best (distance, tie-break key) per answer, within that term's allowance.
    type Hit = { distance: number; term: string; key: [number, number] };
    const better = (a: Hit, b: Hit) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      for (let k = 0; k < 2; k++) if (a.key[k] !== b.key[k]) return a.key[k]! - b.key[k]!;
      return 0;
    };
    const best = new Map<number, Hit>();
    for (const variant of variants) {
      if (Array.from(variant).length < MIN_FUZZY_LENGTH) continue;
      const variantSkel = soundSkeleton(variant);
      for (const { term, skel, index, maxEdits } of entries) {
        if (maxEdits === 0) continue;
        const distance = fuzzyDistance(variant, variantSkel, term, skel, maxEdits);
        if (distance > maxEdits) continue;
        // Bigger corrections must at least start with the same sound ("Elijah" is not "Urijah").
        if (distance >= 2 && firstSound(variantSkel) !== firstSound(skel)) continue;
        const hit: Hit = {
          distance,
          term,
          key: [
            typoDistance(variant, term, maxEdits + 2),
            firstSound(variantSkel) === firstSound(skel) ? 0 : 1,
          ],
        };
        const current = best.get(index);
        if (!current || better(hit, current) < 0) best.set(index, hit);
      }
    }
    if (best.size === 0) return { kind: "no_match" };

    const ranked = [...best.entries()].sort(([, a], [, b]) => better(a, b));
    const top = ranked[0]![1];
    const tied = ranked.filter(([, h]) => better(h, top) === 0);
    if (tied.length > 1) {
      return { kind: "ambiguous", via: "fuzzy", candidates: tied.map(([i]) => answers[i]!) };
    }
    const [index, { term, distance }] = ranked[0]!;
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
