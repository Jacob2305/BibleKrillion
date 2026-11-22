/**
 * Persistence for Daily Dive attempts. Supabase in production; an in-memory
 * stand-in for tests and for local dev before Supabase is set up.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResultTier } from "../lib/game/scoring.js";
import { isDeployed } from "./config.js";
import { getServiceClient } from "./supabase.js";

export interface DailyRound {
  promptId: string;
  /** Server epoch ms when this prompt's time runs out. */
  deadline: number;
  /** Set once the round is over (accepted answer, or "miss"). */
  tier?: ResultTier;
  canonical?: string | null;
  /** Accepted by the AI judge (not in the bank), with the verse it cited. */
  ai?: boolean;
  reference?: string;
  doneAt?: number;
}

export interface DailyAttempt {
  id: string;
  day: string;
  deviceId: string;
  nickname: string;
  promptIds: string[];
  rounds: DailyRound[];
  total: number | null;
  finished: boolean;
}

export interface DistributionRow {
  promptId: string;
  canonical: string | null;
  tier: ResultTier;
  n: number;
}

export interface DailyStore {
  /** Returns the device's attempt for that day, creating it if needed. */
  getOrCreateAttempt(input: { day: string; deviceId: string; nickname: string; promptIds: string[] }): Promise<DailyAttempt>;
  getAttempt(id: string): Promise<DailyAttempt | null>;
  saveRounds(id: string, rounds: DailyRound[]): Promise<void>;
  finish(id: string, total: number): Promise<void>;
  distribution(day: string): Promise<DistributionRow[]>;
  standing(day: string, total: number): Promise<{ players: number; shallower: number }>;
}

// ───────────────────────── in-memory ─────────────────────────

export class MemoryDailyStore implements DailyStore {
  private attempts = new Map<string, DailyAttempt>();

  private clone(a: DailyAttempt): DailyAttempt {
    return structuredClone(a);
  }

  async getOrCreateAttempt(input: { day: string; deviceId: string; nickname: string; promptIds: string[] }) {
    for (const a of this.attempts.values()) {
      if (a.day === input.day && a.deviceId === input.deviceId) return this.clone(a);
    }
    const attempt: DailyAttempt = { id: randomUUID(), ...input, rounds: [], total: null, finished: false };
    this.attempts.set(attempt.id, attempt);
    return this.clone(attempt);
  }

  async getAttempt(id: string) {
    const a = this.attempts.get(id);
    return a ? this.clone(a) : null;
  }

  async saveRounds(id: string, rounds: DailyRound[]) {
    const a = this.attempts.get(id);
    if (a) a.rounds = structuredClone(rounds);
  }

  async finish(id: string, total: number) {
    const a = this.attempts.get(id);
    if (a && !a.finished) Object.assign(a, { finished: true, total });
  }

  async distribution(day: string) {
    const counts = new Map<string, DistributionRow>();
    for (const a of this.attempts.values()) {
      if (a.day !== day || !a.finished) continue;
      for (const r of a.rounds) {
        const key = `${r.promptId}\u0000${r.canonical ?? ""}\u0000${r.tier}`;
        const row = counts.get(key) ?? { promptId: r.promptId, canonical: r.canonical ?? null, tier: r.tier ?? "miss", n: 0 };
        row.n++;
        counts.set(key, row);
      }
    }
    return [...counts.values()];
  }

  async standing(day: string, total: number) {
    const finished = [...this.attempts.values()].filter((a) => a.day === day && a.finished);
    return { players: finished.length, shallower: finished.filter((a) => (a.total ?? 0) < total).length };
  }
}

// ───────────────────────── Supabase ─────────────────────────

interface DailyRow {
  id: string;
  day: string;
  device_id: string;
  nickname: string;
  prompt_ids: string[];
  rounds: DailyRound[];
  total: number | null;
  finished_at: string | null;
}

const toAttempt = (row: DailyRow): DailyAttempt => ({
  id: row.id,
  day: row.day,
  deviceId: row.device_id,
  nickname: row.nickname,
  promptIds: row.prompt_ids,
  rounds: row.rounds ?? [],
  total: row.total,
  finished: row.finished_at !== null,
});

export class SupabaseDailyStore implements DailyStore {
  constructor(private readonly db: SupabaseClient) {}

  private async find(day: string, deviceId: string): Promise<DailyAttempt | null> {
    const { data, error } = await this.db.from("daily_results").select("*").eq("day", day).eq("device_id", deviceId).maybeSingle();
    if (error) throw new Error(`daily_results lookup failed: ${error.message}`);
    return data ? toAttempt(data as DailyRow) : null;
  }

  async getOrCreateAttempt(input: { day: string; deviceId: string; nickname: string; promptIds: string[] }) {
    const existing = await this.find(input.day, input.deviceId);
    if (existing) return existing;
    const { data, error } = await this.db
      .from("daily_results")
      .insert({ day: input.day, device_id: input.deviceId, nickname: input.nickname, prompt_ids: input.promptIds })
      .select("*")
      .single();
    if (error) {
      // Two tabs racing to start: the unique (day, device_id) constraint picks one.
      if (error.code === "23505") {
        const raced = await this.find(input.day, input.deviceId);
        if (raced) return raced;
      }
      throw new Error(`daily_results insert failed: ${error.message}`);
    }
    return toAttempt(data as DailyRow);
  }

  async getAttempt(id: string) {
    const { data, error } = await this.db.from("daily_results").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`daily_results read failed: ${error.message}`);
    return data ? toAttempt(data as DailyRow) : null;
  }

  async saveRounds(id: string, rounds: DailyRound[]) {
    const { error } = await this.db.from("daily_results").update({ rounds }).eq("id", id).is("finished_at", null);
    if (error) throw new Error(`daily_results update failed: ${error.message}`);
  }

  async finish(id: string, total: number) {
    const { error } = await this.db
      .from("daily_results")
      .update({ total, finished_at: new Date().toISOString() })
      .eq("id", id)
      .is("finished_at", null);
    if (error) throw new Error(`daily_results finish failed: ${error.message}`);
  }

  async distribution(day: string) {
    const { data, error } = await this.db.rpc("daily_distribution", { p_day: day });
    if (error) throw new Error(`daily_distribution failed: ${error.message}`);
    return ((data ?? []) as { prompt_id: string; canonical: string | null; tier: ResultTier; n: number | string }[]).map((r) => ({
      promptId: r.prompt_id,
      canonical: r.canonical,
      tier: r.tier ?? "miss",
      n: Number(r.n),
    }));
  }

  async standing(day: string, total: number) {
    const { data, error } = await this.db.rpc("daily_standing", { p_day: day, p_total: total });
    if (error) throw new Error(`daily_standing failed: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as { players: number | string; shallower: number | string } | undefined;
    return { players: Number(row?.players ?? 0), shallower: Number(row?.shallower ?? 0) };
  }
}

// ───────────────────────── selection ─────────────────────────

let defaultStore: DailyStore | undefined;

/**
 * Supabase when configured. Local dev without Supabase gets an in-memory store
 * (resets when the server restarts). A real deployment without Supabase fails loudly.
 */
export function getDailyStore(): DailyStore {
  if (defaultStore) return defaultStore;
  const db = getServiceClient();
  if (db) return (defaultStore = new SupabaseDailyStore(db));
  if (isDeployed()) throw new Error("Daily Dive needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the Vercel environment variables.");
  console.warn("[daily] Supabase isn't configured; using an in-memory store (results reset when the dev server restarts).");
  return (defaultStore = new MemoryDailyStore());
}
