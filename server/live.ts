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
import { computeLeaderboard, computeTeamBoard, nameKey, normalizeRoomCode, randomRoomCode, revealCounts } from "../lib/game/live.js";
import type { RevealAnswer } from "../lib/game/api-types.js";
import type {
  LiveAiAnswer,
  LiveAnswerResponse,
  LiveHostInfo,
  LiveHostOp,
  LiveHostResponse,
  LiveJoinResponse,
  LiveMe,
  LiveSnapshot,
  LiveStateResponse,
} from "../lib/game/live-types.js";
import { PROMPTS_PER_DIVE, pointsForTier } from "../lib/game/scoring.js";
import { allPrompts, getPrompt, matchPrompt, publicPrompt, revealFor } from "./bank.js";
import { MAX_ANSWER_LENGTH, SUBMIT_GRACE_MS, promptSeconds } from "./config.js";
import { HttpError, json, readJsonBody, withErrors } from "./http.js";
import { getBroadcaster, type Broadcaster } from "./live-broadcast.js";
import { ROOM_TTL_MS, getLiveStore, type LivePlayer, type LiveRoom, type LiveStore, type LiveSubmission, type RoomPatch } from "./live-store.js";
import { cleanNickname, cleanTeamName } from "./names.js";
import { aiRevealAnswer, defaultJudgeDeps, judgeRejectionMessage, judgeUnlisted, type JudgeDeps } from "./judge.js";
import type { VerdictStatus } from "./judge-store.js";
import { logRejectedAnswer } from "./rejections.js";
import { signToken, verifyToken } from "./tokens.js";

export interface LiveDeps {
  now: () => number;
  random: () => number;
  store: () => LiveStore;
  broadcaster: () => Broadcaster;
  sleep: (ms: number) => Promise<void>;
  judge?: JudgeDeps;
}

export const MAX_PLAYERS = 150;
export const ROUND_LIMITS = { min: 3, max: 12 } as const;
export const SECOND_LIMITS = { min: 10, max: 60 } as const;

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
 * Prompts for a room: random, distinct categories where possible, never one
 * already in `keep`.
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

// ───────────────────────── views ─────────────────────────

export function buildSnapshot(room: LiveRoom, players: readonly LivePlayer[], subs: readonly LiveSubmission[], now: number): LiveSnapshot {
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
    if (aiAnswers.size > 0) {
      reveal.answers = [...reveal.answers, ...aiAnswers.values()].sort((a, b) => b.points - a.points || a.canonical.localeCompare(b.canonical));
    }
    snapshot.reveal = { reveal, counts, finders, answered, players: active.length };
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

function hostInfo(room: LiveRoom, players: readonly LivePlayer[], subs: readonly LiveSubmission[], statuses: AiStatuses = new Map()): LiveHostInfo {
  const answered = new Set(room.phase === "question" ? subs.filter((s) => s.roundIndex === room.roundIndex).map((s) => s.playerId) : []);
  return {
    prompts: room.promptIds.map((id, index) => {
      const p = getPrompt(id);
      return { index, id, prompt: p?.prompt ?? "(removed prompt)", category: p?.category ?? "" };
    }),
    players: players.map((p) => ({ id: p.id, nickname: p.nickname, team: p.team, kicked: p.kicked, answered: answered.has(p.id) })),
    aiAnswers: aiAnswersFor(room, subs, statuses),
  };
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
  const rounds = clampInt(body.rounds, ROUND_LIMITS.min, ROUND_LIMITS.max, PROMPTS_PER_DIVE);
  const seconds = clampInt(body.seconds, SECOND_LIMITS.min, SECOND_LIMITS.max, promptSeconds());
  const promptIds = pickPrompts(rounds, deps.random);
  const store = deps.store();

  let room: LiveRoom | null = null;
  for (let attempt = 0; attempt < 12 && !room; attempt++) {
    room = await store.createRoom({ code: randomRoomCode(deps.random), promptIds, seconds, teams: body.teams === true, now });
  }
  if (!room) throw new HttpError(503, "Couldn't find a free room code. Try again.");

  const token: HostToken = { k: "live-host", rid: room.id };
  return {
    hostToken: signToken(token),
    snapshot: buildSnapshot(room, [], [], now),
    host: hostInfo(room, [], []),
    realtime: deps.broadcaster().realtimeFor(room.id),
  };
}

export async function host(body: Record<string, unknown>, deps: LiveDeps): Promise<LiveHostResponse> {
  const token = readHostToken(body.hostToken);
  const store = deps.store();
  let room = await loadRoom(store, token.rid);
  let now = deps.now();
  const op = body.op as LiveHostOp;
  if (op !== "state" && !isOpen(room, now)) throw new HttpError(410, "This room has ended. Create a new one.", "ended");

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
          : [...room.promptIds, ...pickPrompts(rounds - room.promptIds.length, deps.random, room.promptIds)];
      await change({
        promptIds,
        seconds: clampInt(body.seconds, SECOND_LIMITS.min, SECOND_LIMITS.max, room.seconds),
        teams: typeof body.teams === "boolean" ? body.teams : room.teams,
      });
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
      await change({ phase: "reveal" });
      await store.markRevealed(room.id, room.roundIndex, now);
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

    default:
      throw new HttpError(400, "Unknown host action.");
  }

  const { players, subs } = await roomData(store, room.id);
  const snapshot = buildSnapshot(room, players, subs, now);
  if (op !== "state") await deps.broadcaster().send(room.id, snapshot);
  return {
    hostToken: body.hostToken as string,
    snapshot,
    host: hostInfo(room, players, subs, await aiStatuses(room, subs, deps)),
    realtime: deps.broadcaster().realtimeFor(room.id),
  };
}

export async function join(body: Record<string, unknown>, deps: LiveDeps): Promise<LiveJoinResponse> {
  const code = normalizeRoomCode(body.code);
  if (!code) throw new HttpError(400, "Room codes are 4 letters.", "code");
  const nickname = cleanNickname(body.nickname);
  if (!nickname) throw new HttpError(400, "Pick a nickname first.", "nickname");

  const store = deps.store();
  const now = deps.now();
  const room = await store.findOpenRoom(code, now);
  if (!room) throw new HttpError(404, `No open room with code ${code}. Check the screen.`, "no_room");
  if (room.phase === "final") throw new HttpError(410, "That game has finished.", "ended");

  const existing = await store.listPlayers(room.id);
  if (existing.filter((p) => !p.kicked).length >= MAX_PLAYERS) throw new HttpError(409, "This room is full.", "full");
  const team = room.teams ? cleanTeamName(body.team) : null;
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
  const store = deps.store();
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
  const store = deps.store();
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
      const stored = await store.addSubmission({
        roomId: room.id,
        roundIndex: room.roundIndex,
        playerId: player.id,
        raw,
        canonical: result.answer.canonical,
        tier: result.answer.tier,
        points: pointsForTier(result.answer.tier),
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
  const store = deps.store();
  const [players, answered] = await Promise.all([store.listPlayers(room.id), store.answeredPlayerIds(room.id, room.roundIndex)]);
  const done = new Set(answered);
  const active = players.filter((p) => !p.kicked);
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
