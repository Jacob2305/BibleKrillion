/**
 * Live Event Room: a host runs a game on a projector while ~100 phones answer.
 *
 * The server is the only authority. Rooms, players, prompt deadlines and locked
 * answers live in the store; every host action bumps the room's version and
 * broadcasts a public snapshot (no answers until a reveal) to the phones.
 *
 *   create { pin?, rounds?, seconds?, teams? }      → host token + room
 *   host   { hostToken, op, ... }                    → host console actions (see LiveHostOp)
 *   join   { code, nickname, team? }                 → player token
 *   state  { playerToken } | { code } | { hostToken }→ current snapshot (reconnects, polling)
 *   answer { playerToken, index, text }              → server-side match; first accepted answer locks
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { BankPrompt } from "../lib/game/bank.js";
import { computeLeaderboard, computeTeamBoard, nameKey, normalizeRoomCode, randomRoomCode, revealCounts, teamKey } from "../lib/game/live.js";
import type { RevealAnswer } from "../lib/game/api-types.js";
import type {
  LiveAiAnswer,
  LiveAnswerResponse,
  LiveHostAnswers,
  LiveHostInfo,
  LiveHostOp,
  LiveHostResponse,
  LiveJoinResponse,
  LiveMe,
  LiveSnapshot,
  LiveStateResponse,
} from "../lib/game/live-types.js";
import { isAnswerTier, pointsForTier, type AnswerTier } from "../lib/game/scoring.js";
import { allPrompts, getPrompt, matchPrompt, publicPrompt, revealFor } from "./bank.js";
import { MAX_ANSWER_LENGTH, SUBMIT_GRACE_MS, promptSeconds } from "./config.js";
import { HttpError, json, readJsonBody, withErrors } from "./http.js";
import { EVENT_PROMPT_IDS } from "./event-set.js";
import { BOT_TEAM, addBots, botsAnswer, visibleSubs } from "./live-bots.js";
import { getBroadcaster, type Broadcaster } from "./live-broadcast.js";
import { ROOM_TTL_MS, getLiveStore, type LivePlayer, type LiveRoom, type LiveStore, type LiveSubmission, type RoomPatch } from "./live-store.js";
import { cleanNickname, cleanTeamName } from "./names.js";
import { aiRevealAnswer, defaultJudgeDeps, judgeRejectionMessage, judgeUnlisted, type JudgeDeps } from "./judge.js";
import type { VerdictStatus } from "./judge-store.js";
import { logRejectedAnswer } from "./rejections.js";
import { MemoryTierStore, getTierStore, type TierOverrides, type TierStore } from "./tier-store.js";
import { signToken, verifyToken } from "./tokens.js";

export interface LiveDeps {
  now: () => number;
  random: () => number;
  store: () => LiveStore;
  broadcaster: () => Broadcaster;
  sleep: (ms: number) => Promise<void>;
  judge?: JudgeDeps;
  /** The host's permanent tier changes (defaults to the shared store; tests get their own). */
  tiers?: () => TierStore;
  /** Test bots added to every new room (0 when omitted; the real handler uses 2). `create { bots: false }` turns them off. */
  bots?: number;
}

export const MAX_PLAYERS = 150;
export const ROUND_LIMITS = { min: 3, max: 12 } as const;
export const SECOND_LIMITS = { min: 10, max: 60 } as const;
/** A new room plays the whole event set (server/event-set.ts). */
export const DEFAULT_ROUNDS = Math.min(ROUND_LIMITS.max, Math.max(ROUND_LIMITS.min, EVENT_PROMPT_IDS.length));

export const LIVE_MESSAGES = {
  rejected: "Not in the bank — try again.",
  ambiguous: "Be more specific — that could be more than one answer.",
  empty: "Type an answer first.",
  over: "That prompt is over.",
  judgeTooSlow: "The reveal started before the judge finished. Sorry!",
  ended: "The host ended this room.",
} as const;

interface HostToken {
  k: "live-host";
  rid: string;
}

interface PlayerToken {
  k: "live-player";
  rid: string;
  pid: string;
}

// ───────────────────────── helpers ─────────────────────────

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function pinMatches(given: unknown, expected: string): boolean {
  if (typeof given !== "string") return false;
  const a = createHash("sha256").update(given.trim()).digest();
  const b = createHash("sha256").update(expected.trim()).digest();
  return timingSafeEqual(a, b);
}

function promptAt(room: LiveRoom, index: number): BankPrompt {
  const prompt = getPrompt(room.promptIds[index]);
  if (!prompt) throw new HttpError(410, "That prompt was removed from the bank. Start a new room.", "stale");
  return prompt;
}

const isOpen = (room: LiveRoom, now: number) => room.endedAt === null && now - room.createdAt < ROOM_TTL_MS;

/**
 * Prompts for a room: the event set (server/event-set.ts) in order, skipping any
 * in `keep`; then random ones if more are needed.
 */
function roomPrompts(count: number, random: () => number, keep: readonly string[] = []): string[] {
  const used = new Set(keep);
  const picked = EVENT_PROMPT_IDS.filter((id) => !used.has(id) && getPrompt(id)).slice(0, count);
  if (picked.length < count) picked.push(...pickPrompts(count - picked.length, random, [...keep, ...picked]));
  return picked;
}

/**
 * Random prompts, distinct categories where possible, never one already in `keep`.
 */
function pickPrompts(count: number, random: () => number, keep: readonly string[] = []): string[] {
  const used = new Set(keep);
  const categories = new Set(keep.map((id) => getPrompt(id)?.category));
  const pool = allPrompts().filter((p) => !used.has(p.id));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const picked: string[] = [];
  for (const p of pool) {
    if (picked.length >= count) break;
    if (!categories.has(p.category)) {
      picked.push(p.id);
      categories.add(p.category);
    }
  }
  for (const p of pool) {
    if (picked.length >= count) break;
    if (!picked.includes(p.id)) picked.push(p.id);
  }
  return picked;
}

// ───────────────────────── tier overrides ─────────────────────────

const TEST_TIERS = new WeakMap<LiveDeps, TierStore>();

function tiersFor(deps: LiveDeps): TierStore {
  if (deps.tiers) return deps.tiers();
  let store = TEST_TIERS.get(deps);
  if (!store) TEST_TIERS.set(deps, (store = new MemoryTierStore()));
  return store;
}

/**
 * The live store, with every room it hands back carrying the PERMANENT tier
 * changes (server/tier-store.ts) as its overrides. Rooms made before those
 * changes pick them up too.
 */
function storeFor(deps: LiveDeps): LiveStore {
  const store = deps.store();
  const tiers = tiersFor(deps);
  const fill = async (room: LiveRoom | null): Promise<LiveRoom | null> => {
    if (!room) return room;
    const global = await tiers.all();
    const merged: TierOverrides = { ...room.tierOverrides };
    for (const [promptId, changes] of Object.entries(global)) merged[promptId] = { ...(merged[promptId] ?? {}), ...changes };
    return { ...room, tierOverrides: merged };
  };
  const filled = new Set<PropertyKey>(["createRoom", "getRoom", "findOpenRoom", "updateRoom"]);
  return new Proxy(store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      if (filled.has(prop)) return async (...args: unknown[]) => fill(await (value as (...a: unknown[]) => Promise<LiveRoom | null>).apply(target, args));
      return value.bind(target);
    },
  });
}

/** The tier the host set for this answer in this room, if any. */
function overrideFor(room: LiveRoom, roundIndex: number, canonical: string): AnswerTier | undefined {
  const tier = room.tierOverrides[room.promptIds[roundIndex] ?? ""]?.[canonical];
  return isAnswerTier(tier) ? tier : undefined;
}

/** Submissions with the host's re-tiering applied (points recomputed from the tier). */
function withOverrides(room: LiveRoom, subs: readonly LiveSubmission[]): LiveSubmission[] {
  return subs.map((s) => {
    const tier = overrideFor(room, s.roundIndex, s.canonical);
    return tier && tier !== s.tier ? { ...s, tier, points: pointsForTier(tier) } : s;
  });
}

function retierReveal(room: LiveRoom, roundIndex: number, answers: RevealAnswer[]): RevealAnswer[] {
  return answers
    .map((a) => {
      const tier = overrideFor(room, roundIndex, a.canonical);
      if (!tier || tier === a.tier) return a;
      const moved: RevealAnswer = { ...a, tier, points: pointsForTier(tier) };
      if (tier !== "one_in_a_million") delete moved.gemNote;
      return moved;
    })
    .sort((a, b) => b.points - a.points || a.canonical.localeCompare(b.canonical));
}

// ───────────────────────── teams ─────────────────────────

/** Teams in the room (first spelling wins), A–Z. */
function teamNamesOf(players: readonly LivePlayer[]): string[] {
  const names = new Map<string, string>();
  for (const p of players) if (p.team && !names.has(teamKey(p.team))) names.set(teamKey(p.team), p.team);
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

/** "table 4" joins an existing "Table 4" rather than starting a near-duplicate team. */
function existingTeamSpelling(players: readonly LivePlayer[], team: string): string {
  return players.find((p) => p.team && teamKey(p.team) === teamKey(team))?.team ?? team;
}

// ───────────────────────── views ─────────────────────────

export function buildSnapshot(room: LiveRoom, players: readonly LivePlayer[], allSubs: readonly LiveSubmission[], now: number): LiveSnapshot {
  const subs = withOverrides(room, visibleSubs(allSubs, players, room, now));
  const active = players.filter((p) => !p.kicked);
  const nicknames = new Map(active.map((p) => [p.id, p.nickname]));
  const snapshot: LiveSnapshot = {
    code: room.code,
    version: room.version,
    phase: room.phase,
    roundIndex: room.roundIndex,
    roundCount: room.promptIds.length,
    seconds: room.seconds,
    teams: room.teams,
    closed: !isOpen(room, now),
    serverNow: now,
    playerCount: active.length,
    removed: players.filter((p) => p.kicked).map((p) => p.id),
  };

  if (room.teams) snapshot.teamNames = teamNamesOf(active);
  if (room.phase === "lobby") {
    snapshot.players = active.map((p) => ({ id: p.id, nickname: p.nickname, team: p.team }));
    return snapshot;
  }

  const index = room.roundIndex;
  const prompt = promptAt(room, index);
  const roundSubs = subs.filter((s) => s.roundIndex === index);

  if (room.phase === "question" || room.phase === "reveal") {
    snapshot.question = { index, prompt: publicPrompt(prompt), deadline: room.deadline ?? now, seconds: room.seconds };
  }
  if (room.phase === "question") {
    snapshot.answeredCount = roundSubs.filter((s) => nicknames.has(s.playerId)).length;
    return snapshot;
  }

  // reveal, leaderboard, final: the current prompt has been revealed.
  snapshot.leaderboard = computeLeaderboard(players, subs, (i) => i <= index, index);
  if (room.teams) snapshot.teamBoard = computeTeamBoard(snapshot.leaderboard);
  if (room.phase === "reveal") {
    const { counts, finders, answered } = revealCounts(roundSubs, nicknames);
    const reveal = revealFor(prompt);
    const aiAnswers = new Map<string, RevealAnswer>();
    for (const s of roundSubs) {
      if (s.ai && nicknames.has(s.playerId) && !aiAnswers.has(s.canonical)) aiAnswers.set(s.canonical, aiRevealAnswer(s.canonical, s.reference ?? ""));
    }
    reveal.answers = retierReveal(room, index, [...reveal.answers, ...aiAnswers.values()]);
    snapshot.reveal = { reveal, counts, finders, answered, players: active.length };
    snapshot.view = room.revealView;
  }
  return snapshot;
}

function meFor(player: LivePlayer, room: LiveRoom, subs: readonly LiveSubmission[]): LiveMe {
  const mine =
    room.phase === "question" || room.phase === "reveal"
      ? subs.find((s) => s.playerId === player.id && s.roundIndex === room.roundIndex)
      : undefined;
  return {
    id: player.id,
    nickname: player.nickname,
    team: player.team,
    kicked: player.kicked,
    current: mine ? { index: mine.roundIndex, canonical: mine.canonical } : null,
  };
}

/** "promptId|canonical" → review status of the AI verdicts for that answer. */
type AiStatuses = Map<string, VerdictStatus>;

function aiAnswersFor(room: LiveRoom, subs: readonly LiveSubmission[], statuses: AiStatuses): LiveAiAnswer[] {
  const out = new Map<string, LiveAiAnswer>();
  for (const s of subs) {
    if (!s.ai) continue;
    const key = `${s.roundIndex}|${s.canonical}`;
    const existing = out.get(key);
    if (existing) {
      existing.count++;
      continue;
    }
    const promptId = room.promptIds[s.roundIndex] ?? "";
    out.set(key, {
      roundIndex: s.roundIndex,
      prompt: getPrompt(promptId)?.prompt ?? "",
      canonical: s.canonical,
      reference: s.reference ?? "",
      count: 1,
      status: statuses.get(`${promptId}|${s.canonical}`) ?? "auto",
    });
  }
  return [...out.values()].sort((a, b) => b.roundIndex - a.roundIndex || a.canonical.localeCompare(b.canonical));
}

function hostInfo(
  room: LiveRoom,
  players: readonly LivePlayer[],
  allSubs: readonly LiveSubmission[],
  now: number,
  statuses: AiStatuses = new Map(),
): LiveHostInfo {
  const subs = visibleSubs(allSubs, players, room, now);
  const answered = new Set(room.phase === "question" ? subs.filter((s) => s.roundIndex === room.roundIndex).map((s) => s.playerId) : []);
  return {
    prompts: room.promptIds.map((id, index) => {
      const p = getPrompt(id);
      return { index, id, prompt: p?.prompt ?? "(removed prompt)", category: p?.category ?? "" };
    }),
    players: players.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      team: p.team,
      kicked: p.kicked,
      answered: answered.has(p.id),
      ...(p.bot ? { bot: true as const } : {}),
    })),
    aiAnswers: aiAnswersFor(room, subs, statuses),
  };
}

/**
 * Host only: every answer for one of the room's prompts, with this room's tiers
 * and how many players gave each. Never part of a snapshot.
 */
function hostAnswers(room: LiveRoom, index: number, subs: readonly LiveSubmission[]): LiveHostAnswers {
  const prompt = promptAt(room, index);
  const roundSubs = subs.filter((s) => s.roundIndex === index);
  const counts = new Map<string, number>();
  for (const s of roundSubs) counts.set(s.canonical, (counts.get(s.canonical) ?? 0) + 1);
  const list: LiveHostAnswers["answers"] = prompt.answers.map((a) => {
    const tier = overrideFor(room, index, a.canonical) ?? a.tier;
    return { canonical: a.canonical, tier, baseTier: a.tier, points: pointsForTier(tier), reference: a.reference, count: counts.get(a.canonical) ?? 0 };
  });
  const listed = new Set(list.map((a) => a.canonical));
  for (const s of roundSubs) {
    if (!s.ai || listed.has(s.canonical)) continue;
    listed.add(s.canonical);
    const tier = overrideFor(room, index, s.canonical) ?? s.tier;
    list.push({ canonical: s.canonical, tier, baseTier: s.tier, points: pointsForTier(tier), reference: s.reference ?? "", count: counts.get(s.canonical) ?? 0, ai: true });
  }
  list.sort((a, b) => b.points - a.points || a.canonical.localeCompare(b.canonical));
  return { index, promptId: prompt.id, prompt: prompt.prompt, answers: list };
}

// ───────────────────────── tokens ─────────────────────────

function readHostToken(token: unknown): HostToken {
  const t = verifyToken<HostToken>(token);
  if (!t || t.k !== "live-host" || typeof t.rid !== "string") throw new HttpError(401, "This host link is no longer valid.", "bad_token");
  return t;
}

function readPlayerToken(token: unknown): PlayerToken {
  const t = verifyToken<PlayerToken>(token);
  if (!t || t.k !== "live-player" || typeof t.rid !== "string" || typeof t.pid !== "string") {
    throw new HttpError(401, "Your seat in this room expired. Join again.", "bad_token");
  }
  return t;
}

async function loadRoom(store: LiveStore, id: string): Promise<LiveRoom> {
  const room = await store.getRoom(id);
  if (!room) throw new HttpError(404, "That room doesn't exist anymore.", "no_room");
  return room;
}

async function roomData(store: LiveStore, roomId: string) {
  const [players, subs] = await Promise.all([store.listPlayers(roomId), store.listSubmissions(roomId)]);
  return { players, subs };
}

// ───────────────────────── actions ─────────────────────────

export async function create(body: Record<string, unknown>, deps: LiveDeps): Promise<LiveHostResponse> {
  const pin = process.env.HOST_PIN;
  if (pin && !pinMatches(body.pin, pin)) {
    throw new HttpError(401, body.pin ? "That PIN isn't right." : "Enter the host PIN.", "pin");
  }
  const now = deps.now();
  const rounds = clampInt(body.rounds, ROUND_LIMITS.min, ROUND_LIMITS.max, DEFAULT_ROUNDS);
  const seconds = clampInt(body.seconds, SECOND_LIMITS.min, SECOND_LIMITS.max, promptSeconds());
  const promptIds = roomPrompts(rounds, deps.random);
  const store = storeFor(deps);

  let room: LiveRoom | null = null;
  for (let attempt = 0; attempt < 12 && !room; attempt++) {
    room = await store.createRoom({ code: randomRoomCode(deps.random), promptIds, seconds, teams: body.teams === true, now });
  }
  if (!room) throw new HttpError(503, "Couldn't find a free room code. Try again.");

  const bots = body.bots === false ? 0 : (deps.bots ?? 0);
  if (bots > 0) {
    try {
      await addBots(store, room.id, now, bots, room.teams ? BOT_TEAM : null);
    } catch (err) {
      // Before migration 0004 the database has no bot column: host without bots rather than fail.
      if (!(err instanceof HttpError && err.code === "migration")) throw err;
      console.warn(`[live] ${err.message} (room ${room.code} has no test bots)`);
    }
  }
  const players = bots > 0 ? await store.listPlayers(room.id) : [];

  const token: HostToken = { k: "live-host", rid: room.id };
  return {
    hostToken: signToken(token),
    snapshot: buildSnapshot(room, players, [], now),
    host: hostInfo(room, players, [], now),
    realtime: deps.broadcaster().realtimeFor(room.id),
  };
}

export async function host(body: Record<string, unknown>, deps: LiveDeps): Promise<LiveHostResponse> {
  const token = readHostToken(body.hostToken);
  const store = storeFor(deps);
  let room = await loadRoom(store, token.rid);
  let now = deps.now();
  const op = body.op as LiveHostOp;
  const readOnly = op === "state" || op === "answers";
  if (!readOnly && !isOpen(room, now)) throw new HttpError(410, "This room has ended. Create a new one.", "ended");

  let answersIndex: number | null = null;
  const promptIndex = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= room.promptIds.length) throw new HttpError(400, "Which prompt?");
    return value;
  };
  const change = async (patch: RoomPatch) => {
    const updated = await store.updateRoom(room.id, room.version, patch);
    if (!updated) throw new HttpError(409, "The room changed in another tab. Refreshed — try again.", "conflict");
    room = updated;
  };
  const requirePhase = (...phases: LiveRoom["phase"][]) => {
    if (!phases.includes(room.phase)) throw new HttpError(409, `Can't do that during ${room.phase}.`, "bad_phase");
  };

  switch (op) {
    case "state":
      break;

    case "settings": {
      requirePhase("lobby");
      const rounds = clampInt(body.rounds, ROUND_LIMITS.min, ROUND_LIMITS.max, room.promptIds.length);
      const promptIds =
        rounds <= room.promptIds.length
          ? room.promptIds.slice(0, rounds)
          : [...room.promptIds, ...roomPrompts(rounds - room.promptIds.length, deps.random, room.promptIds)];
      const teams = typeof body.teams === "boolean" ? body.teams : room.teams;
      if (teams && !room.teams) {
        for (const p of await store.listPlayers(room.id)) if (p.bot && !p.team) await store.setTeam(room.id, p.id, BOT_TEAM);
      }
      await change({
        promptIds,
        seconds: clampInt(body.seconds, SECOND_LIMITS.min, SECOND_LIMITS.max, room.seconds),
        teams,
      });
      break;
    }

    case "team": {
      // The host moves a player to another team (or a brand-new one, or none).
      const playerId = body.playerId;
      if (typeof playerId !== "string") throw new HttpError(400, "Which player?");
      const players = await store.listPlayers(room.id);
      if (!players.some((p) => p.id === playerId)) throw new HttpError(404, "That player isn't in this room.");
      const wanted = body.team === null || body.team === "" ? null : cleanTeamName(body.team);
      await store.setTeam(room.id, playerId, wanted && existingTeamSpelling(players, wanted));
      await change({});
      break;
    }

    case "swap": {
      const index = body.index;
      if (typeof index !== "number" || !Number.isInteger(index) || index <= room.roundIndex || index >= room.promptIds.length) {
        throw new HttpError(400, "Only upcoming prompts can be swapped.");
      }
      if (room.phase === "final") throw new HttpError(409, "The game is over.", "bad_phase");
      const others = room.promptIds.filter((_, i) => i !== index);
      const [replacement] = pickPrompts(1, deps.random, [...others, room.promptIds[index]!]);
      if (!replacement) throw new HttpError(409, "No other prompts left to swap in.");
      await change({ promptIds: room.promptIds.map((id, i) => (i === index ? replacement : id)) });
      break;
    }

    case "start": {
      const next = room.roundIndex + 1;
      requirePhase("lobby", "reveal", "leaderboard");
      if (next >= room.promptIds.length) throw new HttpError(409, "That was the last prompt. Show the final results.", "bad_phase");
      promptAt(room, next);
      const deadline = now + room.seconds * 1000;
      await store.saveRound({ roomId: room.id, index: next, promptId: room.promptIds[next]!, openedAt: now, deadline });
      await change({ phase: "question", roundIndex: next, openedAt: now, deadline });
      await botsAnswer(store, room, await store.listPlayers(room.id), promptAt(room, next), deps.random);
      break;
    }

    case "close":
      requirePhase("question");
      if ((room.deadline ?? 0) > now) await change({ deadline: now });
      break;

    case "reveal": {
      requirePhase("question");
      if ((room.deadline ?? 0) > now) await change({ deadline: now });
      // Let answers already on their way (sent before the buzzer) land first.
      const wait = (room.deadline ?? now) + SUBMIT_GRACE_MS - deps.now();
      if (wait > 0) await deps.sleep(wait);
      now = deps.now();
      // Each reveal starts on the climb. Only written when it changes, so rooms work before migration 0006.
      await change(room.revealView === "climb" ? { phase: "reveal" } : { phase: "reveal", revealView: "climb" });
      await store.markRevealed(room.id, room.roundIndex, now);
      break;
    }

    case "view": {
      // The host picks what the projector shows after a reveal: the climb or the answer board
      // (also the way back from the leaderboard).
      requirePhase("reveal", "leaderboard");
      const view = body.view;
      if (view !== "climb" && view !== "answers") throw new HttpError(400, "Show the climb or the answers?");
      await change(view === room.revealView ? { phase: "reveal" } : { phase: "reveal", revealView: view });
      break;
    }

    case "leaderboard":
      requirePhase("reveal");
      await change({ phase: "leaderboard" });
      break;

    case "final":
      requirePhase("reveal", "leaderboard");
      await change({ phase: "final" });
      break;

    case "kick":
    case "unkick": {
      const playerId = body.playerId;
      if (typeof playerId !== "string") throw new HttpError(400, "Which player?");
      await store.setKicked(room.id, playerId, op === "kick");
      await change({}); // bump the version so every screen refreshes its lists
      break;
    }

    case "ai_approve":
    case "ai_reject": {
      const roundIndex = body.roundIndex;
      const canonical = body.canonical;
      if (typeof roundIndex !== "number" || typeof canonical !== "string" || !room.promptIds[roundIndex]) throw new HttpError(400, "Which answer?");
      const judge = deps.judge ?? defaultJudgeDeps;
      await judge.store().setStatus(room.promptIds[roundIndex]!, canonical, op === "ai_approve" ? "approved" : "rejected", now);
      // Overruled: those answers stop counting in this room (they become misses).
      if (op === "ai_reject") await store.deleteAiSubmissions(room.id, roundIndex, canonical);
      await change({});
      break;
    }

    case "end":
      await change({ endedAt: now });
      break;

    case "answers":
      answersIndex = promptIndex(body.index);
      break;

    case "retier": {
      const index = promptIndex(body.index);
      const canonical = body.canonical;
      const tier = body.tier;
      if (typeof canonical !== "string" || !isAnswerTier(tier)) throw new HttpError(400, "Which answer, and which tier?");
      const prompt = promptAt(room, index);
      const base =
        prompt.answers.find((a) => a.canonical === canonical)?.tier ??
        (await store.listSubmissions(room.id)).find((s) => s.roundIndex === index && s.ai && s.canonical === canonical)?.tier;
      if (!base) throw new HttpError(404, "That answer isn't in this prompt.");
      // Saved for good (every room, Practice and the Daily), not just this room.
      await tiersFor(deps).set(prompt.id, canonical, tier === base ? null : tier, now);
      await change({});
      answersIndex = index;
      break;
    }

    default:
      throw new HttpError(400, "Unknown host action.");
  }

  const { players, subs } = await roomData(store, room.id);
  const snapshot = buildSnapshot(room, players, subs, now);
  if (!readOnly) await deps.broadcaster().send(room.id, snapshot);
  const info = hostInfo(room, players, subs, now, await aiStatuses(room, subs, deps));
  if (answersIndex !== null) info.answers = hostAnswers(room, answersIndex, subs);
  return {
    hostToken: body.hostToken as string,
    snapshot,
    host: info,
    realtime: deps.broadcaster().realtimeFor(room.id),
  };
}

export async function join(body: Record<string, unknown>, deps: LiveDeps): Promise<LiveJoinResponse> {
  const code = normalizeRoomCode(body.code);
  if (!code) throw new HttpError(400, "Room codes are 4 letters.", "code");
  const nickname = cleanNickname(body.nickname);
  if (!nickname) throw new HttpError(400, "Pick a nickname first.", "nickname");

  const store = storeFor(deps);
  const now = deps.now();
  const room = await store.findOpenRoom(code, now);
  if (!room) throw new HttpError(404, `No open room with code ${code}. Check the screen.`, "no_room");
  if (room.phase === "final") throw new HttpError(410, "That game has finished.", "ended");

  const existing = await store.listPlayers(room.id);
  if (existing.filter((p) => !p.kicked).length >= MAX_PLAYERS) throw new HttpError(409, "This room is full.", "full");
  const wantedTeam = room.teams ? cleanTeamName(body.team) : null;
  const team = wantedTeam && existingTeamSpelling(existing, wantedTeam);
  const player = await store.addPlayer({ roomId: room.id, nickname, nameKey: nameKey(nickname), team, now });
  if (player === "name_taken") throw new HttpError(409, `Someone here is already called “${nickname}”. Pick another name.`, "name_taken");

  const token: PlayerToken = { k: "live-player", rid: room.id, pid: player.id };
  const subs = await store.listSubmissions(room.id);
  return {
    playerToken: signToken(token),
    me: meFor(player, room, subs),
    snapshot: buildSnapshot(room, [...existing, player], subs, now),
    realtime: deps.broadcaster().realtimeFor(room.id),
  };
}

export async function state(body: Record<string, unknown>, deps: LiveDeps): Promise<LiveStateResponse> {
  const store = storeFor(deps);
  const now = deps.now();
  if (body.playerToken !== undefined) {
    const token = readPlayerToken(body.playerToken);
    const [room, player] = await Promise.all([loadRoom(store, token.rid), store.getPlayer(token.pid)]);
    if (!player || player.roomId !== room.id) throw new HttpError(401, "Your seat in this room expired. Join again.", "bad_token");
    const { players, subs } = await roomData(store, room.id);
    return { snapshot: buildSnapshot(room, players, subs, now), me: meFor(player, room, subs), realtime: deps.broadcaster().realtimeFor(room.id) };
  }
  const code = normalizeRoomCode(body.code);
  if (!code) throw new HttpError(400, "Room codes are 4 letters.", "code");
  const room = await store.findOpenRoom(code, now);
  if (!room) throw new HttpError(404, `No open room with code ${code}.`, "no_room");
  const { players, subs } = await roomData(store, room.id);
  return { snapshot: buildSnapshot(room, players, subs, now), realtime: deps.broadcaster().realtimeFor(room.id) };
}

export async function answer(body: Record<string, unknown>, deps: LiveDeps): Promise<LiveAnswerResponse> {
  const token = readPlayerToken(body.playerToken);
  const store = storeFor(deps);
  const [room, player] = await Promise.all([loadRoom(store, token.rid), store.getPlayer(token.pid)]);
  if (!player || player.roomId !== room.id) throw new HttpError(401, "Your seat in this room expired. Join again.", "bad_token");
  if (player.kicked) throw new HttpError(403, "The host removed you from this room.", "kicked");

  const now = deps.now();
  if (!isOpen(room, now)) return { status: "too_late", message: LIVE_MESSAGES.ended };
  const index = body.index;
  if (room.phase !== "question" || index !== room.roundIndex || now > (room.deadline ?? 0) + SUBMIT_GRACE_MS) {
    return { status: "too_late", message: LIVE_MESSAGES.over };
  }

  const prompt = promptAt(room, room.roundIndex);
  const raw = typeof body.text === "string" ? body.text.slice(0, MAX_ANSWER_LENGTH) : "";
  const result = matchPrompt(prompt, raw);
  switch (result.kind) {
    case "exact":
    case "fuzzy": {
      // A corrected spelling: ask "Did you mean …?" first; the player confirms (or edits).
      if (result.kind === "fuzzy" && body.confirm !== true) return { status: "confirm", suggestion: result.answer.canonical };
      const tier = overrideFor(room, room.roundIndex, result.answer.canonical) ?? result.answer.tier;
      const stored = await store.addSubmission({
        roomId: room.id,
        roundIndex: room.roundIndex,
        playerId: player.id,
        raw,
        canonical: result.answer.canonical,
        tier,
        points: pointsForTier(tier),
        ms: Math.max(0, now - (room.openedAt ?? now)),
        ai: false,
        reference: null,
      });
      await closeIfEveryoneAnswered(room, deps);
      return { status: "locked", index: room.roundIndex, canonical: stored.canonical };
    }
    case "ambiguous":
      await logRejectedAnswer({ promptId: prompt.id, raw, reason: "ambiguous", mode: "live" });
      return { status: "ambiguous", message: LIVE_MESSAGES.ambiguous };
    case "empty":
      return { status: "empty", message: LIVE_MESSAGES.empty };
    case "no_match": {
      const callerKey = `live:${room.id}:${room.roundIndex}:${player.id}`;
      const verdict = await judgeUnlisted({ prompt, raw, callerKey }, deps.judge ?? defaultJudgeDeps);
      if (verdict.kind === "rejected") {
        await logRejectedAnswer({ promptId: prompt.id, raw, reason: "not_in_bank", mode: "live" });
        return { status: "rejected", message: judgeRejectionMessage(verdict.reason, LIVE_MESSAGES.rejected) };
      }
      // The judge recognised a bank answer worded differently: recommend it, never lock it unasked.
      if (verdict.kind === "bank" && body.confirm !== true) return { status: "confirm", suggestion: verdict.answer.canonical };
      // The judge can take a few seconds: make sure the prompt was not revealed meanwhile.
      const fresh = await loadRoom(store, room.id);
      if (fresh.phase !== "question" || fresh.roundIndex !== room.roundIndex || !isOpen(fresh, deps.now())) {
        return { status: "too_late", message: LIVE_MESSAGES.judgeTooSlow };
      }
      const tier = verdict.kind === "bank" ? verdict.answer.tier : "deep_cut";
      const stored = await store.addSubmission({
        roomId: room.id,
        roundIndex: room.roundIndex,
        playerId: player.id,
        raw,
        canonical: verdict.kind === "bank" ? verdict.answer.canonical : verdict.canonical,
        tier,
        points: pointsForTier(tier),
        ms: Math.max(0, now - (room.openedAt ?? now)),
        ai: verdict.kind === "accepted",
        reference: verdict.kind === "accepted" ? verdict.reference : null,
      });
      await closeIfEveryoneAnswered(fresh, deps);
      return { status: "locked", index: room.roundIndex, canonical: stored.canonical };
    }
  }
}

async function aiStatuses(room: LiveRoom, subs: readonly LiveSubmission[], deps: LiveDeps): Promise<AiStatuses> {
  const statuses: AiStatuses = new Map();
  if (!subs.some((s) => s.ai)) return statuses;
  const verdicts = await (deps.judge ?? defaultJudgeDeps).store().listAccepted({ promptIds: room.promptIds });
  for (const v of verdicts) {
    const key = `${v.promptId}|${v.canonical}`;
    // Any host decision beats the automatic ruling.
    if (v.status !== "auto" || !statuses.has(key)) statuses.set(key, v.status);
  }
  return statuses;
}

/** When the last player locks in, end the timer early so nobody waits. */
async function closeIfEveryoneAnswered(room: LiveRoom, deps: LiveDeps): Promise<void> {
  const store = storeFor(deps);
  const [players, answered] = await Promise.all([store.listPlayers(room.id), store.answeredPlayerIds(room.id, room.roundIndex)]);
  const done = new Set(answered);
  // Bots answer on their own schedule; only real players are waited on.
  const active = players.filter((p) => !p.kicked && !p.bot);
  if (active.length === 0 || !active.every((p) => done.has(p.id))) return;
  const now = deps.now();
  if ((room.deadline ?? 0) <= now) return;
  const closed = await store.updateRoom(room.id, room.version, { deadline: now });
  if (!closed) return; // the host acted meanwhile; their snapshot wins
  const subs = await store.listSubmissions(room.id);
  await deps.broadcaster().send(room.id, buildSnapshot(closed, players, subs, now));
}

// ───────────────────────── handler ─────────────────────────

const defaultDeps: LiveDeps = {
  now: Date.now,
  random: Math.random,
  store: getLiveStore,
  broadcaster: getBroadcaster,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  tiers: getTierStore,
  bots: 2,
};

export function createLiveHandler(deps: LiveDeps = defaultDeps) {
  return withErrors(async (request) => {
    const body = await readJsonBody(request);
    switch (body.action) {
      case "create":
        return json(await create(body, deps));
      case "host":
        return json(await host(body, deps));
      case "join":
        return json(await join(body, deps));
      case "state":
        return json(await state(body, deps));
      case "answer":
        return json(await answer(body, deps));
      default:
        throw new HttpError(400, 'Unknown action. Use "create", "host", "join", "state", or "answer".');
    }
  });
}
