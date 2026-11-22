/**
 * Where AI-judge verdicts and rate-limit counters live: Supabase in production,
 * in memory for tests and local dev without Supabase.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isDeployed } from "./config.js";
import { getServiceClient } from "./supabase.js";

export type VerdictStatus = "auto" | "approved" | "rejected" | "merged";

export interface CachedVerdict {
  promptId: string;
  normalized: string;
  raw: string;
  valid: boolean;
  canonical: string | null;
  reference: string | null;
  reason: string | null;
  model: string | null;
  status: VerdictStatus;
  createdAt: number;
}

export interface JudgeStore {
  get(promptId: string, normalized: string): Promise<CachedVerdict | null>;
  /** Saves a verdict; if another request saved one first, that one is kept and returned. */
  put(verdict: CachedVerdict): Promise<CachedVerdict>;
  /** Counts one call against `key`; false once `limit` calls have been made. */
  takeCall(key: string, limit: number): Promise<boolean>;
  /** Valid (AI-accepted) verdicts, newest first, optionally for some prompts / statuses. */
  listAccepted(filter?: { promptIds?: string[]; statuses?: VerdictStatus[] }): Promise<CachedVerdict[]>;
  /** Sets the status of every accepted verdict for this answer; returns how many changed. */
  setStatus(promptId: string, canonical: string, status: VerdictStatus, now: number): Promise<number>;
}

// ───────────────────────── in-memory ─────────────────────────

export class MemoryJudgeStore implements JudgeStore {
  private verdicts = new Map<string, CachedVerdict>();
  private calls = new Map<string, number>();

  async get(promptId: string, normalized: string) {
    const v = this.verdicts.get(`${promptId}\u0000${normalized}`);
    return v ? { ...v } : null;
  }

  async put(verdict: CachedVerdict) {
    const key = `${verdict.promptId}\u0000${verdict.normalized}`;
    const existing = this.verdicts.get(key);
    if (existing) return { ...existing };
    this.verdicts.set(key, { ...verdict });
    return { ...verdict };
  }

  async takeCall(key: string, limit: number) {
    const n = (this.calls.get(key) ?? 0) + 1;
    this.calls.set(key, n);
    return n <= limit;
  }

  async listAccepted(filter: { promptIds?: string[]; statuses?: VerdictStatus[] } = {}) {
    return [...this.verdicts.values()]
      .filter((v) => v.valid && (!filter.promptIds || filter.promptIds.includes(v.promptId)) && (!filter.statuses || filter.statuses.includes(v.status)))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((v) => ({ ...v }));
  }

  async setStatus(promptId: string, canonical: string, status: VerdictStatus, _now?: number) {
    let n = 0;
    for (const v of this.verdicts.values()) {
      if (v.valid && v.promptId === promptId && v.canonical === canonical) {
        v.status = status;
        n++;
      }
    }
    return n;
  }
}

// ───────────────────────── Supabase ─────────────────────────

interface Row {
  prompt_id: string;
  normalized: string;
  raw_text: string;
  valid: boolean;
  canonical: string | null;
  reference: string | null;
  reason: string | null;
  model: string | null;
  status: VerdictStatus;
  created_at: string;
}

const toVerdict = (r: Row): CachedVerdict => ({
  promptId: r.prompt_id,
  normalized: r.normalized,
  raw: r.raw_text,
  valid: r.valid,
  canonical: r.canonical,
  reference: r.reference,
  reason: r.reason,
  model: r.model,
  status: r.status,
  createdAt: Date.parse(r.created_at),
});

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what} failed: ${error.message}`);
}

export class SupabaseJudgeStore implements JudgeStore {
  constructor(private readonly db: SupabaseClient) {}

  async get(promptId: string, normalized: string) {
    const { data, error } = await this.db.from("judge_cache").select("*").eq("prompt_id", promptId).eq("normalized", normalized).maybeSingle();
    if (error) fail("judge_cache read", error);
    return data ? toVerdict(data as Row) : null;
  }

  async put(v: CachedVerdict) {
    const { error } = await this.db.from("judge_cache").insert({
      prompt_id: v.promptId,
      normalized: v.normalized,
      raw_text: v.raw.slice(0, 200),
      valid: v.valid,
      canonical: v.canonical,
      reference: v.reference,
      reason: v.reason,
      model: v.model,
      status: v.status,
      created_at: new Date(v.createdAt).toISOString(),
    });
    if (!error) return v;
    if (error.code !== "23505") fail("judge_cache insert", error);
    return (await this.get(v.promptId, v.normalized)) ?? v; // someone else judged it a moment earlier
  }

  async takeCall(key: string, limit: number) {
    const { data, error } = await this.db.rpc("judge_take_call", { p_key: key, p_limit: limit });
    if (error) fail("judge_take_call", error);
    return data === true;
  }

  async listAccepted(filter: { promptIds?: string[]; statuses?: VerdictStatus[] } = {}) {
    let q = this.db.from("judge_cache").select("*").eq("valid", true).order("created_at", { ascending: false }).limit(500);
    if (filter.promptIds) q = q.in("prompt_id", filter.promptIds);
    if (filter.statuses) q = q.in("status", filter.statuses);
    const { data, error } = await q;
    if (error) fail("judge_cache list", error);
    return ((data ?? []) as Row[]).map(toVerdict);
  }

  async setStatus(promptId: string, canonical: string, status: VerdictStatus, now: number) {
    const { data, error } = await this.db
      .from("judge_cache")
      .update({ status, reviewed_at: new Date(now).toISOString() })
      .eq("prompt_id", promptId)
      .eq("canonical", canonical)
      .eq("valid", true)
      .select("normalized");
    if (error) fail("judge_cache review", error);
    return (data ?? []).length;
  }
}

let defaultStore: JudgeStore | undefined;

export function getJudgeStore(): JudgeStore {
  if (defaultStore) return defaultStore;
  const db = getServiceClient();
  if (db) return (defaultStore = new SupabaseJudgeStore(db));
  if (isDeployed()) throw new Error("The AI judge needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the Vercel environment variables.");
  return (defaultStore = new MemoryJudgeStore());
}
