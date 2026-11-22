import type {
  LiveAnswerResponse,
  LiveHostOp,
  LiveHostResponse,
  LiveJoinResponse,
  LiveStateResponse,
} from "../../lib/game/live-types";
import { post } from "../lib/api";

const URL = "/api/live";

export const liveApi = {
  create: (opts: { pin?: string; rounds: number; seconds: number; teams: boolean }) =>
    post<LiveHostResponse>(URL, { action: "create", ...opts }),
  host: (hostToken: string, op: LiveHostOp, extra: Record<string, unknown> = {}) =>
    post<LiveHostResponse>(URL, { action: "host", hostToken, op, ...extra }),
  join: (code: string, nickname: string, team?: string) => post<LiveJoinResponse>(URL, { action: "join", code, nickname, team }),
  stateByCode: (code: string) => post<LiveStateResponse>(URL, { action: "state", code }),
  stateAsPlayer: (playerToken: string) => post<LiveStateResponse>(URL, { action: "state", playerToken }),
  answer: (playerToken: string, index: number, text: string, confirm?: boolean) =>
    post<LiveAnswerResponse>(URL, { action: "answer", playerToken, index, text, confirm }),
};

/** The link phones open (also encoded in the QR code). */
export const joinUrl = (code: string) => `${window.location.origin}/join?code=${code}`;
/** What to tell people to type, e.g. "biblediv.example/join". */
export const joinDisplayUrl = () => `${window.location.host}/join`;
