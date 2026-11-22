/**
 * Every rejected answer is logged (prompt_id, raw text, timestamp) so the bank
 * can be improved later: one structured line in the function logs (Vercel →
 * Logs, search "rejected_answer") and, when Supabase is configured, a row in
 * the rejected_answers table. Logging never breaks gameplay.
 */
import { getServiceClient } from "./supabase.js";

export interface RejectedAnswer {
  promptId: string;
  raw: string;
  reason: "not_in_bank" | "ambiguous";
  mode: "practice" | "daily" | "live";
  at?: string;
}

export async function logRejectedAnswer(entry: RejectedAnswer): Promise<void> {
  const at = entry.at ?? new Date().toISOString();
  console.info(JSON.stringify({ event: "rejected_answer", ...entry, at }));
  const db = getServiceClient();
  if (!db) return;
  try {
    const { error } = await db.from("rejected_answers").insert({
      prompt_id: entry.promptId,
      raw_text: entry.raw.slice(0, 200),
      reason: entry.reason,
      mode: entry.mode,
      created_at: at,
    });
    if (error) console.error("[rejections] insert failed:", error.message);
  } catch (err) {
    console.error("[rejections] insert failed:", err);
  }
}
