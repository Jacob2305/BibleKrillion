/**
 * Persistence for Live Event Rooms. Supabase in production; in memory for tests
 * and for local dev without Supabase.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LivePhase, LiveRevealView } from "../lib/game/live-types.js";
import type { AnswerTier } from "../lib/game/scoring.js";
import { isDeployed } from "./config.js";
import { HttpError } from "./http.js";
import { getServiceClient } from "./supabase.js";

/** Rooms older than this are treated as over (and their code can be reused). */
export const ROOM_TTL_MS = 12 * 60 * 60 * 1000;

export interface LiveRoom {
  id: string;
  code: string;
  phase: LivePhase;
  roundIndex: number;
  promptIds: string[];
  seconds: number;
  teams: boolean;
  version: number;
  /** Current prompt's open time and deadline (epoch ms). */
  openedAt: number | null;
  deadline: number | null;
  createdAt: number;
  endedAt: number | null;
  /** Host re-tiering for this room: promptId → canonical → tier. Applied wherever points are computed. */
  tierOverrides: TierOverrides;
  /** Reveal phase: what the projector shows (the host picks). */
  revealView: LiveRevealView;
}

export type TierOverrides = Record<string, Record<string, AnswerTier>>;

export interface LivePlayer {
  id: string;
  roomId: string;
  nickname: string;
  nameKey: string;
  team: string | null;
  kicked: boolean;
  joinedAt: number;
  /** A test bot the server answers for (see server/live-bots.ts). */
  bot: boolean;
}

export interface LiveSubmission {
  roomId: string;
  roundIndex: number;
  playerId: string;
  raw: string;
  canonical: string;
  tier: AnswerTier;
  points: number;
  ms: number;
  /** Accepted by the AI judge (not in the bank); `reference` is the verse it cited. */
  ai: boolean;
  reference: string | null;
}

export interface LiveRoundRecord {
  roomId: string;
  index: number;
  promptId: string;
  openedAt: number;
  deadline: number;
}

export type RoomPatch = Partial<
  Pick<LiveRoom, "phase" | "roundIndex" | "promptIds" | "seconds" | "teams" | "openedAt" | "deadline" | "endedAt" | "tierOverrides" | "revealView">
>;

export interface NewPlayer {
  roomId: string;
  nickname: string;
  nameKey: string;
  team: string | null;
  now: number;
  bot?: boolean;
}

export interface LiveStore {
  /** Creates the room, or returns null if that code is in use by an open room. */
  createRoom(input: { code: string; promptIds: string[]; seconds: number; teams: boolean; now: number }): Promise<LiveRoom | null>;
  getRoom(id: string): Promise<LiveRoom | null>;
  /** The open room with this code (not ended, not older than ROOM_TTL_MS). */
  findOpenRoom(code: string, now: number): Promise<LiveRoom | null>;
  /** Applies the patch and bumps the version, only if the version still matches (else null). */
  updateRoom(id: string, expectedVersion: number, patch: RoomPatch): Promise<LiveRoom | null>;
  saveRound(round: LiveRoundRecord): Promise<void>;
  markRevealed(roomId: string, index: number, now: number): Promise<void>;

  /** Adds the player, or returns "name_taken". */
  addPlayer(input: NewPlayer): Promise<LivePlayer | "name_taken">;
  getPlayer(id: string): Promise<LivePlayer | null>;
  listPlayers(roomId: string): Promise<LivePlayer[]>;
  setKicked(roomId: string, playerId: string, kicked: boolean): Promise<void>;
  /** The host moved a player to another team (null = no team). */
  setTeam(roomId: string, playerId: string, team: string | null): Promise<void>;

  /** Records a locked answer; if the player already locked one this round, returns that one instead. */
  addSubmission(sub: LiveSubmission): Promise<LiveSubmission>;
  listSubmissions(roomId: string): Promise<LiveSubmission[]>;
  /** A host overruled the AI: those answers no longer count. Returns how many were removed. */
  deleteAiSubmissions(roomId: string, roundIndex: number, canonical: string): Promise<number>;
  /** Who has locked an answer for this prompt. */
  answeredPlayerIds(roomId: string, roundIndex: number): Promise<string[]>;
}

// ───────────────────────── in-memory ─────────────────────────

export class MemoryLiveStore implements LiveStore {
  private rooms = new Map<string, LiveRoom>();
  private players = new Map<string, LivePlayer>();
  private rounds = new Map<string, LiveRoundRecord & { revealedAt: number | null }>();
  private subs: LiveSubmission[] = [];

  private isOpen(room: LiveRoom, now: number) {
    return room.endedAt === null && now - room.createdAt < ROOM_TTL_MS;
  }

  async createRoom(input: { code: string; promptIds: string[]; seconds: number; teams: boolean; now: number }) {
    for (const r of this.rooms.values()) {
      if (r.code === input.code && r.endedAt === null) {
        if (this.isOpen(r, input.now)) return null;
        r.endedAt = input.now; // stale room: free its code
      }
    }
    const room: LiveRoom = {
      id: randomUUID(),
      code: input.code,
      phase: "lobby",
      roundIndex: -1,
      promptIds: [...input.promptIds],
      seconds: input.seconds,
      teams: input.teams,
      version: 0,
      openedAt: null,
      deadline: null,
      createdAt: input.now,
      endedAt: null,
      tierOverrides: {},
      revealView: "climb",
    };
    this.rooms.set(room.id, room);
    return structuredClone(room);
  }

  async getRoom(id: string) {
    const r = this.rooms.get(id);
    return r ? structuredClone(r) : null;
  }

  async findOpenRoom(code: string, now: number) {
    for (const r of this.rooms.values()) if (r.code === code && this.isOpen(r, now)) return structuredClone(r);
    return null;
  }

  async updateRoom(id: string, expectedVersion: number, patch: RoomPatch) {
    const r = this.rooms.get(id);
    if (!r || r.version !== expectedVersion) return null;
    Object.assign(r, structuredClone(patch), { version: r.version + 1 });
    return structuredClone(r);
  }

  async saveRound(round: LiveRoundRecord) {
    this.rounds.set(`${round.roomId}:${round.index}`, { ...round, revealedAt: null });
  }

  async markRevealed(roomId: string, index: number, now: number) {
    const r = this.rounds.get(`${roomId}:${index}`);
    if (r && r.revealedAt === null) r.revealedAt = now;
  }

  async addPlayer(input: NewPlayer) {
    for (const p of this.players.values()) if (p.roomId === input.roomId && p.nameKey === input.nameKey) return "name_taken" as const;
    const player: LivePlayer = {
      id: randomUUID(),
      roomId: input.roomId,
      nickname: input.nickname,
      nameKey: input.nameKey,
      team: input.team,
      kicked: false,
      joinedAt: input.now,
      bot: input.bot === true,
    };
    this.players.set(player.id, player);
    return { ...player };
  }

  async getPlayer(id: string) {
    const p = this.players.get(id);
    return p ? { ...p } : null;
  }

  async listPlayers(roomId: string) {
    return [...this.players.values()].filter((p) => p.roomId === roomId).sort((a, b) => a.joinedAt - b.joinedAt).map((p) => ({ ...p }));
  }

  async setKicked(roomId: string, playerId: string, kicked: boolean) {
    const p = this.players.get(playerId);
    if (p && p.roomId === roomId) p.kicked = kicked;
  }

  async setTeam(roomId: string, playerId: string, team: string | null) {
    const p = this.players.get(playerId);
    if (p && p.roomId === roomId) p.team = team;
  }

  async addSubmission(sub: LiveSubmission) {
    const existing = this.subs.find((s) => s.roomId === sub.roomId && s.roundIndex === sub.roundIndex && s.playerId === sub.playerId);
    if (existing) return { ...existing };
    this.subs.push({ ...sub });
    return { ...sub };
  }

  async listSubmissions(roomId: string) {
    return this.subs.filter((s) => s.roomId === roomId).map((s) => ({ ...s }));
  }

  async deleteAiSubmissions(roomId: string, roundIndex: number, canonical: string) {
    const before = this.subs.length;
    this.subs = this.subs.filter((s) => !(s.roomId === roomId && s.roundIndex === roundIndex && s.canonical === canonical && s.ai));
    return before - this.subs.length;
  }

  async answeredPlayerIds(roomId: string, roundIndex: number) {
    return this.subs.filter((s) => s.roomId === roomId && s.roundIndex === roundIndex).map((s) => s.playerId);
  }
}

// ───────────────────────── Supabase ─────────────────────────

interface RoomRow {
  id: string;
  code: string;
  phase: LivePhase;
  round_index: number;
  prompt_ids: string[];
  seconds: number;
  teams: boolean;
  version: number;
  opened_at: string | null;
  deadline: string | null;
  created_at: string;
  ended_at: string | null;
  /** Added by migration 0004 (absent before it runs). */
  tier_overrides?: TierOverrides | null;
  /** Added by migration 0006 (absent before it runs). */
  reveal_view?: LiveRevealView | null;
}

interface PlayerRow {
  id: string;
  room_id: string;
  nickname: string;
  name_key: string;
  team: string | null;
  kicked: boolean;
  joined_at: string;
  /** Added by migration 0004 (absent before it runs). */
  is_bot?: boolean | null;
}

interface SubmissionRow {
  room_id: string;
  round_idx: number;
  player_id: string;
  raw_text: string;
  canonical: string;
  tier: AnswerTier;
  points: number;
  ms: number;
  ai: boolean | null;
  reference: string | null;
}

const ms = (iso: string | null): number | null => (iso === null ? null : Date.parse(iso));
const iso = (epoch: number | null | undefined): string | null => (epoch === null || epoch === undefined ? null : new Date(epoch).toISOString());

const toRoom = (r: RoomRow): LiveRoom => ({
  id: r.id,
  code: r.code,
  phase: r.phase,
  roundIndex: r.round_index,
  promptIds: r.prompt_ids,
  seconds: r.seconds,
  teams: r.teams,
  version: r.version,
  openedAt: ms(r.opened_at),
  deadline: ms(r.deadline),
  createdAt: Date.parse(r.created_at),
  endedAt: ms(r.ended_at),
  tierOverrides: r.tier_overrides ?? {},
  revealView: r.reveal_view === "answers" ? "answers" : "climb",
});

const toPlayer = (p: PlayerRow): LivePlayer => ({
  id: p.id,
  roomId: p.room_id,
  nickname: p.nickname,
  nameKey: p.name_key,
  team: p.team,
  kicked: p.kicked,
  joinedAt: Date.parse(p.joined_at),
  bot: p.is_bot === true,
});

const toSubmission = (s: SubmissionRow): LiveSubmission => ({
  roomId: s.room_id,
  roundIndex: s.round_idx,
  playerId: s.player_id,
  raw: s.raw_text,
  canonical: s.canonical,
  tier: s.tier,
  points: s.points,
  ms: s.ms,
  ai: s.ai === true,
  reference: s.reference ?? null,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(what: string, error: { message: string }): never {
  if (/reveal_view/.test(error.message)) {
    throw new HttpError(503, "Projector views need a database update: run supabase/migrations/0006_reveal_view.sql in the Supabase SQL Editor.", "migration");
  }
  if (/tier_overrides|is_bot/.test(error.message)) {
    throw new HttpError(503, "Host tools need a database update: run supabase/migrations/0004_host_tools.sql in the Supabase SQL Editor.", "migration");
  }
  throw new Error(`${what} failed: ${error.message}`);
}

export class SupabaseLiveStore implements LiveStore {
  constructor(private readonly db: SupabaseClient) {}

  async createRoom(input: { code: string; promptIds: string[]; seconds: number; teams: boolean; now: number }) {
    // Free the code if an old room still holds it.
    const stale = await this.db
      .from("rooms")
      .update({ ended_at: iso(input.now) })
      .eq("code", input.code)
      .is("ended_at", null)
      .lt("created_at", iso(input.now - ROOM_TTL_MS));
    if (stale.error) fail("rooms cleanup", stale.error);

    const { data, error } = await this.db
      .from("rooms")
      .insert({ code: input.code, prompt_ids: input.promptIds, seconds: input.seconds, teams: input.teams, created_at: iso(input.now) })
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") return null;
      fail("rooms insert", error);
    }
    return toRoom(data as RoomRow);
  }

  async getRoom(id: string) {
    if (!UUID.test(id)) return null;
    const { data, error } = await this.db.from("rooms").select("*").eq("id", id).maybeSingle();
    if (error) fail("rooms read", error);
    return data ? toRoom(data as RoomRow) : null;
  }

  async findOpenRoom(code: string, now: number) {
    const { data, error } = await this.db
      .from("rooms")
      .select("*")
      .eq("code", code)
      .is("ended_at", null)
      .gte("created_at", iso(now - ROOM_TTL_MS))
      .maybeSingle();
    if (error) fail("rooms lookup", error);
    return data ? toRoom(data as RoomRow) : null;
  }

  async updateRoom(id: string, expectedVersion: number, patch: RoomPatch) {
    const row: Record<string, unknown> = { version: expectedVersion + 1 };
    if (patch.phase !== undefined) row.phase = patch.phase;
    if (patch.roundIndex !== undefined) row.round_index = patch.roundIndex;
    if (patch.promptIds !== undefined) row.prompt_ids = patch.promptIds;
    if (patch.seconds !== undefined) row.seconds = patch.seconds;
    if (patch.teams !== undefined) row.teams = patch.teams;
    if (patch.openedAt !== undefined) row.opened_at = iso(patch.openedAt);
    if (patch.deadline !== undefined) row.deadline = iso(patch.deadline);
    if (patch.endedAt !== undefined) row.ended_at = iso(patch.endedAt);
    if (patch.tierOverrides !== undefined) row.tier_overrides = patch.tierOverrides;
    if (patch.revealView !== undefined) row.reveal_view = patch.revealView;
    const { data, error } = await this.db.from("rooms").update(row).eq("id", id).eq("version", expectedVersion).select("*").maybeSingle();
    if (error) fail("rooms update", error);
    return data ? toRoom(data as RoomRow) : null;
  }

  async saveRound(round: LiveRoundRecord) {
    const { error } = await this.db.from("rounds").upsert({
      room_id: round.roomId,
      idx: round.index,
      prompt_id: round.promptId,
      opened_at: iso(round.openedAt),
      deadline: iso(round.deadline),
      revealed_at: null,
    });
    if (error) fail("rounds upsert", error);
  }

  async markRevealed(roomId: string, index: number, now: number) {
    const { error } = await this.db.from("rounds").update({ revealed_at: iso(now) }).eq("room_id", roomId).eq("idx", index).is("revealed_at", null);
    if (error) fail("rounds reveal", error);
  }

  async addPlayer(input: NewPlayer) {
    const row: Record<string, unknown> = { room_id: input.roomId, nickname: input.nickname, name_key: input.nameKey, team: input.team, joined_at: iso(input.now) };
    // Only bots send is_bot, so phones can still join before migration 0004 has run.
    if (input.bot) row.is_bot = true;
    const { data, error } = await this.db
      .from("players")
      .insert(row)
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") return "name_taken" as const;
      fail("players insert", error);
    }
    return toPlayer(data as PlayerRow);
  }

  async getPlayer(id: string) {
    if (!UUID.test(id)) return null;
    const { data, error } = await this.db.from("players").select("*").eq("id", id).maybeSingle();
    if (error) fail("players read", error);
    return data ? toPlayer(data as PlayerRow) : null;
  }

  async listPlayers(roomId: string) {
    const { data, error } = await this.db.from("players").select("*").eq("room_id", roomId).order("joined_at").limit(1000);
    if (error) fail("players list", error);
    return ((data ?? []) as PlayerRow[]).map(toPlayer);
  }

  async setKicked(roomId: string, playerId: string, kicked: boolean) {
    if (!UUID.test(playerId)) return;
    const { error } = await this.db.from("players").update({ kicked }).eq("id", playerId).eq("room_id", roomId);
    if (error) fail("players kick", error);
  }

  async setTeam(roomId: string, playerId: string, team: string | null) {
    if (!UUID.test(playerId)) return;
    const { error } = await this.db.from("players").update({ team }).eq("id", playerId).eq("room_id", roomId);
    if (error) fail("players team", error);
  }

  async addSubmission(sub: LiveSubmission) {
    const { error } = await this.db.from("submissions").insert({
      room_id: sub.roomId,
      round_idx: sub.roundIndex,
      player_id: sub.playerId,
      raw_text: sub.raw.slice(0, 200),
      canonical: sub.canonical,
      tier: sub.tier,
      points: sub.points,
      ms: sub.ms,
      ai: sub.ai,
      reference: sub.reference,
    });
    if (!error) return sub;
    if (error.code !== "23505") fail("submissions insert", error);
    // Already locked (double tap, two tabs): the first answer stands.
    const { data, error: readError } = await this.db
      .from("submissions")
      .select("room_id, round_idx, player_id, raw_text, canonical, tier, points, ms, ai, reference")
      .eq("room_id", sub.roomId)
      .eq("round_idx", sub.roundIndex)
      .eq("player_id", sub.playerId)
      .single();
    if (readError) fail("submissions read", readError);
    return toSubmission(data as SubmissionRow);
  }

  async listSubmissions(roomId: string) {
    const { data, error } = await this.db
      .from("submissions")
      .select("room_id, round_idx, player_id, raw_text, canonical, tier, points, ms, ai, reference")
      .eq("room_id", roomId)
      .limit(10000);
    if (error) fail("submissions list", error);
    return ((data ?? []) as SubmissionRow[]).map(toSubmission);
  }

  async deleteAiSubmissions(roomId: string, roundIndex: number, canonical: string) {
    const { data, error } = await this.db
      .from("submissions")
      .delete()
      .eq("room_id", roomId)
      .eq("round_idx", roundIndex)
      .eq("canonical", canonical)
      .eq("ai", true)
      .select("id");
    if (error) fail("submissions delete", error);
    return (data ?? []).length;
  }

  async answeredPlayerIds(roomId: string, roundIndex: number) {
    const { data, error } = await this.db.from("submissions").select("player_id").eq("room_id", roomId).eq("round_idx", roundIndex).limit(10000);
    if (error) fail("submissions answered", error);
    return ((data ?? []) as { player_id: string }[]).map((r) => r.player_id);
  }
}

// ───────────────────────── selection ─────────────────────────

let defaultStore: LiveStore | undefined;

export function getLiveStore(): LiveStore {
  if (defaultStore) return defaultStore;
  const db = getServiceClient();
  if (db) return (defaultStore = new SupabaseLiveStore(db));
  if (isDeployed()) throw new Error("Live rooms need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the Vercel environment variables.");
  console.warn("[live] Supabase isn't configured; using an in-memory store (rooms vanish when the dev server restarts).");
  return (defaultStore = new MemoryLiveStore());
}
