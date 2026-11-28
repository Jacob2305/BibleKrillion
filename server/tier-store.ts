/**
 * Permanent tier changes made by the host ("move this answer to Rare").
 *
 * One shared list, not per room: set them up before the event and every new
 * room, Practice and the Daily use them. Supabase in production (table
 * `answer_tiers`, migration 0005), in memory for tests and local dev without
 * Supabase. `npm run merge-tiers` copies them into data/prompts.json.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAnswerTier, type AnswerTier } from "../lib/game/scoring.js";
import { isDeployed } from "./config.js";
import { HttpError } from "./http.js";
import { getServiceClient } from "./supabase.js";

/** { "<prompt id>": { "<canonical answer>": "<tier>" } } */
export type TierOverrides = Record<string, Record<string, AnswerTier>>;

export interface TierStore {
  all(): Promise<TierOverrides>;
  /** Sets the tier for one answer; null removes the change (back to the bank's tier). */
  set(promptId: string, canonical: string, tier: AnswerTier | null, now: number): Promise<void>;
}

export class MemoryTierStore implements TierStore {
  private map: TierOverrides = {};

  async all() {
    return structuredClone(this.map);
  }

  async set(promptId: string, canonical: string, tier: AnswerTier | null, _now?: number) {
    const forPrompt = { ...(this.map[promptId] ?? {}) };
    if (tier) forPrompt[canonical] = tier;
    else delete forPrompt[canonical];
    if (Object.keys(forPrompt).length) this.map[promptId] = forPrompt;
    else delete this.map[promptId];
  }
}

/** Reads are cached briefly per warm instance; a write on this instance refreshes at once. */
const CACHE_MS = 5_000;
const MISSING_TABLE = /answer_tiers|does not exist|schema cache/i;

export class SupabaseTierStore implements TierStore {
  private cache: { at: number; value: TierOverrides } | null = null;
  private warned = false;

  constructor(private db: SupabaseClient) {}

  async all() {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return structuredClone(this.cache.value);
    const { data, error } = await this.db.from("answer_tiers").select("prompt_id, canonical, tier");
    if (error) {
      // Before migration 0005 is run, play on with the bank's tiers.
      if (!this.warned) console.warn(`[tiers] couldn't read answer_tiers (run migration 0005?): ${error.message}`);
      this.warned = true;
      return {};
    }
    const value: TierOverrides = {};
    for (const row of (data ?? []) as { prompt_id: string; canonical: string; tier: string }[]) {
      if (!isAnswerTier(row.tier)) continue;
      (value[row.prompt_id] ??= {})[row.canonical] = row.tier;
    }
    this.cache = { at: Date.now(), value };
    return structuredClone(value);
  }

  async set(promptId: string, canonical: string, tier: AnswerTier | null, now: number) {
    const { error } = tier
      ? await this.db
          .from("answer_tiers")
          .upsert({ prompt_id: promptId, canonical, tier, updated_at: new Date(now).toISOString() }, { onConflict: "prompt_id,canonical" })
      : await this.db.from("answer_tiers").delete().eq("prompt_id", promptId).eq("canonical", canonical);
    if (error) {
      if (MISSING_TABLE.test(error.message)) {
        throw new HttpError(503, "Saving tier changes needs a database update: run supabase/migrations/0005_answer_tiers.sql in the Supabase SQL Editor.", "migration");
      }
      throw new Error(`answer_tiers: ${error.message}`);
    }
    this.cache = null;
  }
}

let defaultStore: TierStore | undefined;

export function getTierStore(): TierStore {
  if (defaultStore) return defaultStore;
  const db = getServiceClient();
  if (db) return (defaultStore = new SupabaseTierStore(db));
  if (isDeployed()) throw new Error("Tier changes need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the Vercel environment variables.");
  return (defaultStore = new MemoryTierStore());
}
