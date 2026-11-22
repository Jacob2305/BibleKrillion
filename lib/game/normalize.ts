/**
 * Answer normalization. The same function is applied to player input AND to every
 * canonical name/alias in the bank, so both sides always compare like-for-like.
 *
 * Steps:
 *  1. Unicode-decompose and strip accents ("Abél" -> "abel").
 *  2. Lowercase.
 *  3. Delete apostrophes so possessives stay one word ("Jacob's" -> "jacobs").
 *  4. Turn every other run of punctuation/whitespace into one space ("Simon-Peter" -> "simon peter").
 *  5. Drop leading honorifics: the, st, saint, king, prophet, apostle (repeatedly,
 *     so "The Prophet Elijah" -> "elijah"). Never drops the last remaining word.
 *  6. Canonicalize a leading ordinal before a numbered-book name so books line up:
 *     "First Kings" / "1st Kings" / "I Kings" -> "1 kings". Only before those names,
 *     so "I am the bread of life" and "First fruits" are left alone.
 */

/** Second words that follow an ordinal in a numbered book name (full names and common abbreviations). */
const NUMBERED_BOOK_WORDS: ReadonlySet<string> = new Set([
  "samuel", "sam", "sm",
  "kings", "kgs", "ki", "king",
  "chronicles", "chron", "chr", "ch",
  "corinthians", "cor", "co",
  "thessalonians", "thess", "thes", "th",
  "timothy", "tim", "ti",
  "peter", "pet", "pt",
  "john", "jn", "jhn", "jo",
]);

const DROP_LEADING_WORDS: ReadonlySet<string> = new Set(["the", "st", "saint", "king", "prophet", "apostle"]);

const LEADING_ORDINALS: Readonly<Record<string, string>> = {
  first: "1",
  "1st": "1",
  i: "1",
  second: "2",
  "2nd": "2",
  ii: "2",
  third: "3",
  "3rd": "3",
  iii: "3",
};

export function normalizeAnswer(raw: string): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/['‘’`´ʼ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (!cleaned) return "";

  const words = cleaned.split(" ");
  while (words.length > 1 && DROP_LEADING_WORDS.has(words[0]!)) words.shift();

  const ordinal = words.length > 1 ? LEADING_ORDINALS[words[0]!] : undefined;
  if (ordinal && NUMBERED_BOOK_WORDS.has(words[1]!)) words[0] = ordinal;

  return words.join(" ");
}
