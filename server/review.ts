/**
 * /review: a host looks over answers the AI judge accepted (from any mode) and
 * approves or overrules them. Approved answers can be merged into the bank with
 * `npm run merge-approved`. Protected by HOST_PIN (required once deployed).
 *
 *   list   { pin }                                  → accepted answers grouped by prompt + answer
 *   review { pin, promptId, canonical, decision }   → decision: "approve" | "reject"
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { getPrompt } from "./bank.js";
import { isDeployed } from "./config.js";
import { HttpError, json, readJsonBody, withErrors } from "./http.js";
import { defaultJudgeDeps, type JudgeDeps } from "./judge.js";
import type { VerdictStatus } from "./judge-store.js";

export interface ReviewItem {
  promptId: string;
  prompt: string;
  canonical: string;
  reference: string;
  reason: string;
  /** What players actually typed (different spellings of the same answer). */
  variants: string[];
  status: VerdictStatus;
  firstSeen: number;
}

export interface ReviewListResponse {
  judgeEnabled: boolean;
  model: string;
  items: ReviewItem[];
}

function requirePin(given: unknown): void {
  const pin = process.env.HOST_PIN;
  if (!pin) {
    if (isDeployed()) throw new HttpError(403, "Set HOST_PIN in the Vercel environment variables to use the review page.", "no_pin");
    return; // local dev without a PIN
  }
  const a = createHash("sha256").update(typeof given === "string" ? given.trim() : "").digest();
  const b = createHash("sha256").update(pin.trim()).digest();
  if (!timingSafeEqual(a, b)) throw new HttpError(401, given ? "That PIN isn't right." : "Enter the host PIN.", "pin");
}

/** One row per prompt + answer; a host decision on any spelling applies to all of them. */
const STATUS_RANK: Record<VerdictStatus, number> = { auto: 0, approved: 2, merged: 3, rejected: 1 };

export async function list(body: Record<string, unknown>, judge: JudgeDeps): Promise<ReviewListResponse> {
  requirePin(body.pin);
  const verdicts = await judge.store().listAccepted();
  const groups = new Map<string, ReviewItem>();
  for (const v of verdicts) {
    if (!v.canonical) continue;
    const key = `${v.promptId}|${v.canonical}`;
    const item = groups.get(key);
    if (item) {
      if (!item.variants.includes(v.raw)) item.variants.push(v.raw);
      if (STATUS_RANK[v.status] > STATUS_RANK[item.status]) item.status = v.status;
      item.firstSeen = Math.min(item.firstSeen, v.createdAt);
      continue;
    }
    groups.set(key, {
      promptId: v.promptId,
      prompt: getPrompt(v.promptId)?.prompt ?? v.promptId,
      canonical: v.canonical,
      reference: v.reference ?? "",
      reason: v.reason ?? "",
      variants: [v.raw],
      status: v.status,
      firstSeen: v.createdAt,
    });
  }
  const config = judge.config();
  // Undecided first, then newest.
  const items = [...groups.values()].sort((a, b) => Number(a.status !== "auto") - Number(b.status !== "auto") || b.firstSeen - a.firstSeen);
  return { judgeEnabled: config.enabled, model: config.model, items };
}

export async function review(body: Record<string, unknown>, judge: JudgeDeps): Promise<{ changed: number }> {
  requirePin(body.pin);
  const { promptId, canonical, decision } = body;
  if (typeof promptId !== "string" || !getPrompt(promptId) || typeof canonical !== "string" || (decision !== "approve" && decision !== "reject")) {
    throw new HttpError(400, "Which answer, and approve or reject?");
  }
  const changed = await judge.store().setStatus(promptId, canonical, decision === "approve" ? "approved" : "rejected", judge.now());
  if (changed === 0) throw new HttpError(404, "That answer isn't in the judge's records.");
  return { changed };
}

export function createReviewHandler(judge: JudgeDeps = defaultJudgeDeps) {
  return withErrors(async (request) => {
    const body = await readJsonBody(request);
    switch (body.action) {
      case "list":
        return json(await list(body, judge));
      case "review":
        return json(await review(body, judge));
      default:
        throw new HttpError(400, 'Unknown action. Use "list" or "review".');
    }
  });
}
