/**
 * Live Event Room shapes shared by the phones, the host console, the projector
 * and /api/live. Types only: importing this never pulls bank data into the browser.
 */
import type { PromptReveal, PublicPrompt } from "./api-types.js";

/**
 * lobby → question → reveal → (leaderboard) → question … → final.
 * A question whose deadline has passed is "closed" (still phase "question")
 * until the host reveals it.
 */
export type LivePhase = "lobby" | "question" | "reveal" | "leaderboard" | "final";

export interface LivePlayerPublic {
  id: string;
  nickname: string;
  team: string | null;
}

export interface LiveLeaderRow {
  rank: number;
  id: string;
  nickname: string;
  team: string | null;
  total: number;
  /** Points from the most recently revealed prompt (null = no answer). */
  last: number | null;
}

export interface LiveTeamRow {
  rank: number;
  team: string;
  members: number;
  total: number;
  /** Points per member, so small and big teams compete fairly. */
  average: number;
}

export interface LiveQuestion {
  index: number;
  prompt: PublicPrompt;
  /** Server epoch ms when answers stop. */
  deadline: number;
  seconds: number;
}

export interface LiveRoundReveal {
  reveal: PromptReveal;
  /** canonical → how many players gave it (for fun; never changes points). */
  counts: Record<string, number>;
  /** Players who locked an answer / players in the room. */
  answered: number;
  players: number;
  /** canonical → nicknames, for Rare and deeper answers (a few names each). */
  finders: Record<string, string[]>;
}

/** Everything public about a room. Broadcast to every phone; contains no answers until a reveal. */
export interface LiveSnapshot {
  code: string;
  /** Increments on every host action; clients ignore older snapshots. */
  version: number;
  phase: LivePhase;
  /** -1 in the lobby. */
  roundIndex: number;
  roundCount: number;
  seconds: number;
  teams: boolean;
  /** The host ended the room: no more joining or answering. */
  closed: boolean;
  serverNow: number;
  playerCount: number;
  /** Ids of players the host removed (their phones show a notice). */
  removed: string[];
  /** Lobby only: who has joined (for the projector's name wall). */
  players?: LivePlayerPublic[];
  /** Current prompt (question and reveal phases). */
  question?: LiveQuestion;
  /** Question phase: how many players have locked an answer. */
  answeredCount?: number;
  /** Reveal phase. */
  reveal?: LiveRoundReveal;
  /** Reveal, leaderboard and final phases: every player, best first. */
  leaderboard?: LiveLeaderRow[];
  teamBoard?: LiveTeamRow[];
}

/** This phone's player. */
export interface LiveMe {
  id: string;
  nickname: string;
  team: string | null;
  kicked: boolean;
  /** The answer this player locked for the current prompt, if any. */
  current: { index: number; canonical: string } | null;
}

/** Where to listen for room updates (null = poll instead). The key is the public anon key. */
export interface LiveRealtime {
  url: string;
  key: string;
  topic: string;
}

/** Host-only extras. */
export interface LiveHostInfo {
  /** The room's prompt list (the host may preview and swap them). */
  prompts: { index: number; id: string; prompt: string; category: string }[];
  /** Everyone who joined, including removed players. */
  players: (LivePlayerPublic & { kicked: boolean; answered: boolean })[];
  /** Answers the AI judge accepted in this room, for the host to approve or overrule. */
  aiAnswers: LiveAiAnswer[];
}

export interface LiveAiAnswer {
  roundIndex: number;
  prompt: string;
  canonical: string;
  reference: string;
  /** Players in this room who gave it. */
  count: number;
  /** auto = the AI's ruling stands; approved/merged = a host confirmed it; rejected = overruled. */
  status: "auto" | "approved" | "rejected" | "merged";
}

export interface LiveJoinResponse {
  playerToken: string;
  me: LiveMe;
  snapshot: LiveSnapshot;
  realtime: LiveRealtime | null;
}

export interface LiveStateResponse {
  snapshot: LiveSnapshot;
  me?: LiveMe;
  realtime: LiveRealtime | null;
}

export interface LiveHostResponse {
  hostToken: string;
  snapshot: LiveSnapshot;
  host: LiveHostInfo;
  realtime: LiveRealtime | null;
}

export type LiveAnswerResponse =
  | { status: "locked"; index: number; canonical: string }
  /** Matched only after spelling correction: resend with confirm: true, or edit. */
  | { status: "confirm"; suggestion: string }
  | { status: "rejected"; message: string }
  | { status: "ambiguous"; message: string }
  | { status: "empty"; message: string }
  | { status: "too_late"; message: string };

export type LiveHostOp =
  | "state"
  | "settings"
  | "swap"
  | "start"
  | "close"
  | "reveal"
  | "leaderboard"
  | "final"
  | "kick"
  | "unkick"
  | "ai_approve"
  | "ai_reject"
  | "end";
