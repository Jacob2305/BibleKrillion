/**
 * Prompt bank schema, validation, and formatting.
 *
 * The bank itself (data/prompts.json) is SERVER-ONLY. This module is pure and is
 * used by the validate/review scripts, the tests, and the /api functions.
 */
import { checkReference } from "./books.js";
import { buildMatcher, findFuzzyCollisions, termsFor, type Matcher } from "./matching.js";
import { normalizeAnswer } from "./normalize.js";
import { ANSWER_TIERS, PROMPTS_PER_DIVE, isAnswerTier, pointsForTier, type AnswerTier } from "./scoring.js";

export type Testament = "OT" | "NT" | "both";
export type Difficulty = "easy" | "medium" | "hard";

export interface BankAnswer {
  canonical: string;
  aliases: string[];
  tier: AnswerTier;
  /** Scripture reference(s), e.g. "Judges 3:31" or "Genesis 4:19; 36:2". */
  reference: string;
  /** Required for gems (One in a Million). Shown at reveal. */
  gem_note?: string;
  /**
   * Marks a shared name ("James") that is accepted at a LOWER tier than the
   * specific answers it could mean (canonicals listed here). Being specific pays.
   */
  generic_for?: string[];
  needs_review?: boolean;
  /** Why it needs review; printed by `npm run review-bank`. */
  review_note?: string;
}

export interface BankPrompt {
  id: string;
  prompt: string;
  category: string;
  testament: Testament;
  difficulty?: Difficulty;
  closed_set: boolean;
  /** Filler phrases stripped from the start of player input, e.g. ["mount", "mt"]. */
  strip_prefixes?: string[];
  answers: BankAnswer[];
}

export type Bank = BankPrompt[];

export const MIN_ANSWERS_PER_PROMPT = 8;

const PROMPT_KEYS = new Set(["id", "prompt", "category", "testament", "difficulty", "closed_set", "strip_prefixes", "answers"]);
const ANSWER_KEYS = new Set([
  "canonical", "aliases", "tier", "reference", "gem_note", "generic_for", "needs_review", "review_note",
]);
const TESTAMENTS: readonly Testament[] = ["OT", "NT", "both"];
const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];

export interface BankIssue {
  promptId?: string;
  answer?: string;
  message: string;
}

export interface BankStats {
  prompts: number;
  answers: number;
  gems: number;
  needsReview: number;
  closedSet: number;
  byTestament: Record<Testament, number>;
  byDifficulty: Record<Difficulty | "unset", number>;
}

export interface BankValidation {
  errors: BankIssue[];
  warnings: BankIssue[];
  stats: BankStats;
}

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** "1 kings"/"2 kings" or "jeroboam i"/"jeroboam ii": siblings that differ only by a number. Expected, not a warning. */
function numberedSiblings(a: string, b: string): boolean {
  const base = (t: string) =>
    t.replace(/^(\d+|i{1,3}) /, "").replace(/ (\d+|i{1,3}|iv)$/, "");
  const ba = base(a);
  const bb = base(b);
  return ba.length > 0 && ba === bb && a !== b;
}

export function validateBank(data: unknown): BankValidation {
  const errors: BankIssue[] = [];
  const warnings: BankIssue[] = [];
  const stats: BankStats = {
    prompts: 0,
    answers: 0,
    gems: 0,
    needsReview: 0,
    closedSet: 0,
    byTestament: { OT: 0, NT: 0, both: 0 },
    byDifficulty: { easy: 0, medium: 0, hard: 0, unset: 0 },
  };

  if (!Array.isArray(data)) {
    errors.push({ message: "Bank must be a JSON array of prompts." });
    return { errors, warnings, stats };
  }
  if (data.length < PROMPTS_PER_DIVE) {
    errors.push({ message: `Bank has ${data.length} prompts; at least ${PROMPTS_PER_DIVE} are needed for one dive.` });
  }

  const seenIds = new Set<string>();

  data.forEach((raw: unknown, pIndex) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      errors.push({ message: `Prompt #${pIndex + 1} is not an object.` });
      return;
    }
    const p = raw as Record<string, unknown>;
    const promptId = isNonEmptyString(p.id) ? p.id : `#${pIndex + 1}`;
    const err = (message: string, answer?: string) => errors.push({ promptId, answer, message });
    const warn = (message: string, answer?: string) => warnings.push({ promptId, answer, message });
    stats.prompts++;

    for (const key of Object.keys(p)) if (!PROMPT_KEYS.has(key)) warn(`Unknown prompt field "${key}" (typo?).`);

    if (!isNonEmptyString(p.id)) err("Missing id.");
    else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.id)) err(`id "${p.id}" must be kebab-case (a-z, 0-9, hyphens).`);
    else if (seenIds.has(p.id)) err(`Duplicate prompt id "${p.id}".`);
    else seenIds.add(p.id);

    if (!isNonEmptyString(p.prompt)) err("Missing prompt text.");
    if (!isNonEmptyString(p.category)) err("Missing category.");
    if (!TESTAMENTS.includes(p.testament as Testament)) err(`testament must be one of ${TESTAMENTS.join(", ")}.`);
    else stats.byTestament[p.testament as Testament]++;
    if (p.difficulty === undefined) stats.byDifficulty.unset++;
    else if (!DIFFICULTIES.includes(p.difficulty as Difficulty)) err(`difficulty must be one of ${DIFFICULTIES.join(", ")}.`);
    else stats.byDifficulty[p.difficulty as Difficulty]++;
    if (typeof p.closed_set !== "boolean") err("closed_set must be true or false.");
    else if (p.closed_set) stats.closedSet++;
    if (p.strip_prefixes !== undefined) {
      if (!isStringArray(p.strip_prefixes)) err("strip_prefixes must be an array of strings.");
      else for (const sp of p.strip_prefixes) if (!normalizeAnswer(sp)) err(`strip_prefixes entry "${sp}" is empty after normalization.`);
    }

    if (!Array.isArray(p.answers)) {
      err("answers must be an array.");
      return;
    }
    if (p.answers.length < MIN_ANSWERS_PER_PROMPT) {
      err(`Has ${p.answers.length} answers; needs at least ${MIN_ANSWERS_PER_PROMPT}.`);
    }

    const validAnswers: BankAnswer[] = [];
    let gems = 0;

    p.answers.forEach((rawAnswer: unknown, aIndex) => {
      if (typeof rawAnswer !== "object" || rawAnswer === null || Array.isArray(rawAnswer)) {
        err(`Answer #${aIndex + 1} is not an object.`);
        return;
      }
      const a = rawAnswer as Record<string, unknown>;
      const label = isNonEmptyString(a.canonical) ? a.canonical : `answer #${aIndex + 1}`;
      stats.answers++;

      for (const key of Object.keys(a)) if (!ANSWER_KEYS.has(key)) warn(`Unknown answer field "${key}" (typo?).`, label);

      let ok = true;
      if (!isNonEmptyString(a.canonical)) {
        err("Missing canonical name.", label);
        ok = false;
      } else if (!normalizeAnswer(a.canonical)) {
        err("Canonical name is empty after normalization.", label);
        ok = false;
      }
      if (!isStringArray(a.aliases)) {
        err("aliases must be an array of strings (use [] for none).", label);
        ok = false;
      } else {
        for (const alias of a.aliases) if (!normalizeAnswer(alias)) err(`Alias "${alias}" is empty after normalization.`, label);
      }
      if (!isAnswerTier(a.tier)) {
        err(`Invalid tier "${String(a.tier)}". Use one of: ${ANSWER_TIERS.join(", ")}.`, label);
        ok = false;
      }
      const refProblem = checkReference(a.reference as string);
      if (refProblem) err(`Bad reference: ${refProblem}.`, label);

      if (a.tier === "one_in_a_million") {
        gems++;
        if (!isNonEmptyString(a.gem_note)) err("Gems (one_in_a_million) need a gem_note.", label);
      } else if (a.gem_note !== undefined) {
        warn("Has a gem_note but is not a gem; the note will not be shown.", label);
      }
      if (a.gem_note !== undefined && !isNonEmptyString(a.gem_note)) err("gem_note must be a non-empty string.", label);
      if (a.needs_review !== undefined && typeof a.needs_review !== "boolean") err("needs_review must be true or false.", label);
      if (a.needs_review === true) stats.needsReview++;
      if (a.review_note !== undefined && !isNonEmptyString(a.review_note)) err("review_note must be a non-empty string.", label);
      if (a.generic_for !== undefined && !isStringArray(a.generic_for)) {
        err("generic_for must be an array of canonical names.", label);
        ok = false;
      }

      if (ok) validAnswers.push(a as unknown as BankAnswer);
    });

    stats.gems += gems;
    if (gems === 0) err("Needs at least one gem (tier one_in_a_million).");

    // Duplicate terms: the same name/alias (after normalization) may appear only once per prompt.
    const owners = new Map<string, string[]>();
    for (const answer of validAnswers) {
      const raw = [answer.canonical, ...answer.aliases].map(normalizeAnswer).filter(Boolean);
      const unique = termsFor(answer);
      if (raw.length !== unique.length) warn("Repeats one of its own aliases (harmless, but redundant).", answer.canonical);
      for (const term of unique) owners.set(term, [...(owners.get(term) ?? []), answer.canonical]);
    }
    for (const [term, list] of owners) {
      if (list.length > 1) err(`"${term}" appears in more than one answer: ${list.join(", ")}. Use a generic answer instead.`);
    }
    const canonicals = new Set(validAnswers.map((x) => x.canonical));
    if (canonicals.size !== validAnswers.length) err("Two answers share the same canonical name.");

    // Generic answers must score strictly less than at least one, and no more than any, specific answer.
    const byCanonical = new Map(validAnswers.map((x) => [x.canonical, x]));
    const genericPairs = new Set<string>();
    for (const answer of validAnswers) {
      if (!answer.generic_for) continue;
      if (answer.generic_for.length < 2) err("generic_for should list at least two specific answers.", answer.canonical);
      const specifics: BankAnswer[] = [];
      for (const name of answer.generic_for) {
        const specific = byCanonical.get(name);
        if (!specific) err(`generic_for names "${name}", which is not a canonical answer in this prompt.`, answer.canonical);
        else if (specific === answer) err("generic_for cannot include itself.", answer.canonical);
        else {
          specifics.push(specific);
          for (const t1 of termsFor(answer)) for (const t2 of termsFor(specific)) genericPairs.add(`${t1}|${t2}`);
        }
      }
      if (specifics.length > 0) {
        const genericPts = pointsForTier(answer.tier);
        const higher = specifics.filter((s) => pointsForTier(s.tier) < genericPts);
        if (higher.length) err(`Generic answer outscores specific answer(s): ${higher.map((s) => s.canonical).join(", ")}.`, answer.canonical);
        if (!specifics.some((s) => pointsForTier(s.tier) > genericPts)) {
          err("Generic answer must score less than at least one specific answer.", answer.canonical);
        }
      }
    }

    // Fuzzy collisions between different answers: warn, don't fail.
    for (const c of findFuzzyCollisions(validAnswers)) {
      if (numberedSiblings(c.termA, c.termB)) continue;
      if (genericPairs.has(`${c.termA}|${c.termB}`) || genericPairs.has(`${c.termB}|${c.termA}`)) continue;
      warn(`Fuzzy collision: "${c.termA}" (${c.a}) ~ "${c.termB}" (${c.b}), distance ${c.distance}.`);
    }
  });

  return { errors, warnings, stats };
}

/** Build the server-side matcher for one prompt, honouring its strip_prefixes. */
export function buildPromptMatcher(prompt: BankPrompt): Matcher<BankAnswer> {
  return buildMatcher(prompt.answers, { stripPrefixes: prompt.strip_prefixes });
}

const ANSWER_KEY_ORDER: (keyof BankAnswer)[] = [
  "canonical", "aliases", "tier", "reference", "gem_note", "generic_for", "needs_review", "review_note",
];
const PROMPT_KEY_ORDER: (keyof BankPrompt)[] = [
  "id", "prompt", "category", "testament", "difficulty", "closed_set", "strip_prefixes",
];

/**
 * Stable, review-friendly JSON: prompt fields one per line, each answer on ONE line.
 * Used by format-bank and merge-approved so diffs stay small.
 */
export function formatBank(bank: Bank): string {
  const promptBlocks = bank.map((prompt) => {
    const lines: string[] = [];
    const record = prompt as unknown as Record<string, unknown>;
    const extraKeys = Object.keys(record).filter((k) => k !== "answers" && !(PROMPT_KEY_ORDER as string[]).includes(k));
    for (const key of [...PROMPT_KEY_ORDER, ...extraKeys]) {
      if (record[key] !== undefined) lines.push(`    ${JSON.stringify(key)}: ${JSON.stringify(record[key])}`);
    }
    const answers = prompt.answers.map((answer) => {
      const ordered: Record<string, unknown> = {};
      for (const key of ANSWER_KEY_ORDER) if (answer[key] !== undefined) ordered[key] = answer[key];
      for (const key of Object.keys(answer)) if (!(key in ordered)) ordered[key] = (answer as unknown as Record<string, unknown>)[key];
      return `      ${JSON.stringify(ordered)}`;
    });
    lines.push(`    "answers": [\n${answers.join(",\n")}\n    ]`);
    return `  {\n${lines.join(",\n")}\n  }`;
  });
  return `[\n${promptBlocks.join(",\n")}\n]\n`;
}
