/** Player-supplied names (nicknames, team names). */

const MAX_NAME_LENGTH = 24;

/** Trim, drop control/format characters, collapse spaces, 1–24 characters; null if nothing is left. */
export function cleanNickname(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return Array.from(cleaned).slice(0, MAX_NAME_LENGTH).join("");
}

/** Same rules for an optional team name. */
export const cleanTeamName = cleanNickname;
