/**
 * Request/response shapes shared by the client and the /api functions.
 * Types only: importing this never pulls bank data into the browser.
 */
import type { AnswerTier, DiveRating, ResultTier } from "./scoring.js";

/** What a player may see about a prompt while it is running. Never includes answers. */
export interface PublicPrompt {
  id: string;
  prompt: string;
  category: string;
  testament: "OT" | "NT" | "both";
  closedSet: boolean;
}

/** One bank answer as shown at reveal (after the prompt is over for this player). */
export interface RevealAnswer {
  canonical: string;
  tier: AnswerTier;
  points: number;
  reference: string;
  gemNote?: string;
  /** For shared names ("James"): the specific answers it could mean. */
  genericFor?: string[];
  /** Not in the bank: accepted by the AI judge (scores Deep Cut). */
  aiJudged?: true;
}

export interface PromptReveal {
  promptId: string;
  prompt: string;
  /** Deepest tier first. */
  answers: RevealAnswer[];
}

/** A prompt the player already finished (used to resume a Daily Dive after a refresh). */
export interface CompletedRound {
  prompt: PublicPrompt;
  tier: ResultTier;
  answer: RevealAnswer | null;
}

export interface DiveStartResponse {
  /** Opaque sealed token for this dive. */
  dive: string;
  count: number;
  seconds: number;
  /** Daily: the New York calendar day ("YYYY-MM-DD") this dive belongs to. */
  day?: string;
  /** Daily: rounds already played on this device today (resume after refresh). */
  completed?: CompletedRound[];
  /** Daily: this device already finished today's dive. */
  finished?: boolean;
}

export interface DistributionAnswer {
  /** null = ran out of time. */
  canonical: string | null;
  tier: ResultTier;
  points: number;
  count: number;
}

export interface PromptDistribution {
  promptId: string;
  prompt: string;
  /** Finished divers today (all of them answered or missed this prompt). */
  players: number;
  /** Most common first. */
  answers: DistributionAnswer[];
}

export interface DailyFinishResponse {
  day: string;
  nickname: string;
  total: number;
  rating: DiveRating;
  rounds: CompletedRound[];
  /** Finished divers today, including you. */
  players: number;
  /** How many of them scored less than you. */
  shallower: number;
  distribution: PromptDistribution[];
}

export interface PromptBeginResponse {
  index: number;
  prompt: PublicPrompt;
  /** Opaque signed token for this prompt attempt; send it with answers. */
  promptToken: string;
  /** Server epoch ms when time runs out. */
  deadline: number;
  /** Server epoch ms when this response was created (for clock-offset correction). */
  serverNow: number;
  seconds: number;
}

export type AnswerResponse =
  | { status: "accepted"; answer: RevealAnswer; reveal: PromptReveal }
  /** The answer matched a bank answer only after spelling correction: confirm it (resend with confirm: true) or edit it. */
  | { status: "confirm"; suggestion: string }
  | { status: "rejected"; message: string }
  | { status: "ambiguous"; message: string }
  | { status: "empty"; message: string }
  | { status: "too_late"; reveal: PromptReveal };

export interface RevealResponse {
  reveal: PromptReveal;
}

export interface ApiErrorBody {
  error: string;
  code?: string;
}
