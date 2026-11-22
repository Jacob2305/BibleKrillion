/**
 * Pure Live Event Room logic (no I/O): room codes, standings and reveal counts.
 * Shared by the server and the tests.
 */
import type { LiveLeaderRow, LiveTeamRow } from "./live-types.js";
import type { AnswerTier } from "./scoring.js";

/**
 * Room codes use consonants only, so a random code can never spell a word, and
 * skip letters that are easy to misread on a projector.
 */
export const ROOM_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
export const ROOM_CODE_LENGTH = 4;

export function randomRoomCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)];
  return code;
}

/** "bc df" / "b-c-d-f" → "BCDF"; null if it can't be a room code. */
export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.toUpperCase().replace(/[^A-Z]/g, "");
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** Case/space-insensitive key so "Sam" and " sam " can't both join one room. */
export function nameKey(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export interface StandingPlayer {
  id: string;
  nickname: string;
  team: string | null;
  kicked: boolean;
  joinedAt: number;
}

export interface StandingSubmission {
  roundIndex: number;
  playerId: string;
  canonical: string;
  tier: AnswerTier;
  points: number;
  /** Milliseconds from the prompt opening to this answer (faster breaks ties). */
  ms: number;
}

/**
 * Leaderboard over the revealed rounds: total points, ties broken by total
 * answer time (faster first), then by who joined first. Removed players are left out.
 */
export function computeLeaderboard(
  players: readonly StandingPlayer[],
  submissions: readonly StandingSubmission[],
  revealed: (roundIndex: number) => boolean,
  lastRound: number,
): LiveLeaderRow[] {
  const active = players.filter((p) => !p.kicked);
  const stats = new Map(active.map((p) => [p.id, { total: 0, ms: 0, last: null as number | null }]));
  for (const s of submissions) {
    const st = stats.get(s.playerId);
    if (!st || !revealed(s.roundIndex)) continue;
    st.total += s.points;
    st.ms += s.ms;
    if (s.roundIndex === lastRound) st.last = s.points;
  }
  const rows = active
    .map((p) => ({ p, st: stats.get(p.id)! }))
    .sort((a, b) => b.st.total - a.st.total || a.st.ms - b.st.ms || a.p.joinedAt - b.p.joinedAt);
  return rows.map(({ p, st }, i) => ({ rank: i + 1, id: p.id, nickname: p.nickname, team: p.team, total: st.total, last: st.last }));
}

/** Team key: case-insensitive, so "Youth Group" and "youth group" are one team. */
export function teamKey(team: string): string {
  return nameKey(team);
}

/** Teams ranked by points per member (rounded), then total. */
export function computeTeamBoard(leaderboard: readonly LiveLeaderRow[]): LiveTeamRow[] {
  const teams = new Map<string, { team: string; members: number; total: number }>();
  for (const row of leaderboard) {
    if (!row.team) continue;
    const key = teamKey(row.team);
    const t = teams.get(key) ?? { team: row.team, members: 0, total: 0 };
    t.members++;
    t.total += row.total;
    teams.set(key, t);
  }
  return [...teams.values()]
    .map((t) => ({ ...t, average: Math.round(t.total / t.members) }))
    .sort((a, b) => b.average - a.average || b.total - a.total || a.team.localeCompare(b.team))
    .map((t, i) => ({ rank: i + 1, ...t }));
}

/** Deep answers worth calling out by name on the projector. */
const FINDER_TIERS: ReadonlySet<AnswerTier> = new Set(["rare", "deep_cut", "one_in_a_million"]);
export const MAX_FINDERS_SHOWN = 6;

/** How many players gave each answer this round, and who found the deep ones. */
export function revealCounts(
  roundSubmissions: readonly StandingSubmission[],
  nicknames: ReadonlyMap<string, string>,
): { counts: Record<string, number>; finders: Record<string, string[]>; answered: number } {
  const counts: Record<string, number> = {};
  const finders: Record<string, string[]> = {};
  let answered = 0;
  for (const s of [...roundSubmissions].sort((a, b) => a.ms - b.ms)) {
    const name = nicknames.get(s.playerId);
    if (name === undefined) continue; // removed player
    answered++;
    counts[s.canonical] = (counts[s.canonical] ?? 0) + 1;
    if (FINDER_TIERS.has(s.tier)) {
      const list = (finders[s.canonical] ??= []);
      if (list.length < MAX_FINDERS_SHOWN) list.push(name);
    }
  }
  return { counts, finders, answered };
}
