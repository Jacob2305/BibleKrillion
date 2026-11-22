/**
 * npm run merge-approved            → copy host-approved AI answers into data/prompts.json
 * npm run merge-approved -- --dry-run → show what would change, write nothing
 *
 * Reads judge_cache rows with status "approved" from Supabase (keys from .env.local),
 * adds each as a Deep Cut answer marked needs_review (so it shows up in
 * `npm run review-bank`), re-validates the whole bank, then marks the rows "merged".
 * Nothing is written if the bank would fail validation.
 */
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "vite";
import { formatBank, validateBank, type Bank } from "../lib/game/bank.js";
import { SupabaseJudgeStore } from "../server/judge-store.js";
import { BANK_PATH, bold, dim, green, readBankJson, red, yellow } from "./bank-file.js";
import { mergeApproved, type ApprovedAnswer } from "./merge-lib.js";

const dryRun = process.argv.includes("--dry-run");
const env = loadEnv("development", process.cwd(), "");
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(red("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first."));
  process.exit(1);
}
const store = new SupabaseJudgeStore(createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }));

const rows = await store.listAccepted({ statuses: ["approved"] });
const grouped = new Map<string, ApprovedAnswer>();
for (const r of rows) {
  if (!r.canonical) continue;
  const key = `${r.promptId}|${r.canonical}`;
  const item = grouped.get(key) ?? { promptId: r.promptId, canonical: r.canonical, reference: r.reference ?? "", reason: r.reason ?? "", variants: [] };
  item.variants.push(r.raw);
  grouped.set(key, item);
}
if (grouped.size === 0) {
  console.log("No host-approved AI answers waiting. Approve some on /review or in the host console first.");
  process.exit(0);
}

const bank = readBankJson(BANK_PATH) as Bank;
const today = new Date().toISOString().slice(0, 10);
const result = mergeApproved(bank, [...grouped.values()], today);

for (const { promptId, answer } of result.added) {
  console.log(`${green("+")} ${bold(answer.canonical)} ${dim(`(${answer.reference})`)} → ${promptId}${answer.aliases.length ? dim(`  aliases: ${answer.aliases.join(", ")}`) : ""}`);
}
for (const item of result.alreadyPresent) console.log(`${dim("=")} ${item.canonical} ${dim(`already in ${item.promptId}`)}`);
for (const { item, why } of result.skipped) console.log(`${yellow("!")} ${item.canonical} ${dim(`(${item.promptId})`)}: ${why}`);

const validation = validateBank(result.bank);
if (validation.errors.length > 0) {
  console.error(red(`\nThe merged bank would have ${validation.errors.length} error(s); nothing was written:`));
  for (const e of validation.errors.slice(0, 20)) console.error(`  ${e}`);
  process.exit(1);
}

if (dryRun) {
  console.log(dim(`\nDry run: ${result.added.length} to add. Run without --dry-run to write data/prompts.json.`));
  process.exit(0);
}

if (result.added.length > 0) writeFileSync(BANK_PATH, formatBank(result.bank), "utf8");
const done = [...result.added.map((a) => ({ promptId: a.promptId, canonical: a.answer.canonical })), ...result.alreadyPresent];
for (const d of done) await store.setStatus(d.promptId, d.canonical, "merged", Date.now());
console.log(
  green(`\n✔ Added ${result.added.length} answer(s) to data/prompts.json`) +
    (result.added.length ? dim(" (marked needs_review: check them with `npm run review-bank`, then redeploy).") : ""),
);
