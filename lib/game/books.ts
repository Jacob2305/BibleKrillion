/** The Protestant 66-book canon, in order. */
export const OT_BOOKS = [
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth",
  "1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra",
  "Nehemiah", "Esther", "Job", "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon",
  "Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos",
  "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi",
] as const;

export const NT_BOOKS = [
  "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians", "2 Corinthians",
  "Galatians", "Ephesians", "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians",
  "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James", "1 Peter", "2 Peter",
  "1 John", "2 John", "3 John", "Jude", "Revelation",
] as const;

export const BIBLE_BOOKS: readonly string[] = [...OT_BOOKS, ...NT_BOOKS];

/** Book names accepted at the start of a Scripture reference (canon + common singular/alternate forms). */
const REFERENCE_BOOK_NAMES: readonly string[] = [...BIBLE_BOOKS, "Psalm", "Song of Songs"]
  // Longest first so "1 John" wins over "John".
  .sort((a, b) => b.length - a.length);

/**
 * Checks that a reference looks like "Book C:V" (optionally several, separated by ";",
 * where later parts may omit the book: "Genesis 4:19; 36:2"). Returns an error message or null.
 */
export function checkReference(reference: string): string | null {
  if (typeof reference !== "string" || !reference.trim()) return "missing reference";
  const parts = reference.split(";").map((p) => p.trim());
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (!part) return `empty segment in "${reference}"`;
    const book = REFERENCE_BOOK_NAMES.find((b) => part === b || part.startsWith(b + " "));
    if (book) {
      if (!/^\d+(:\d+)?/.test(part.slice(book.length + 1))) return `"${part}" has no chapter number after "${book}"`;
      continue;
    }
    if (i > 0 && /^\d+(:\d+)?/.test(part)) continue; // same book as the previous segment
    return `"${part}" does not start with a book of the 66-book canon`;
  }
  return null;
}
