/**
 * npm run merge-tiers              → copy the host's saved tier changes into data/prompts.json
 * npm run merge-tiers -- --dry-run → show what would change, write nothing
 *
 * Reads the answer_tiers table from Supabase (keys from .env.local), applies each
 * change to the bank, re-validates the whole bank, writes it, then clears the rows
 * it merged (the bank now holds those tiers). Nothing is written if the bank would
 * fail validation, e.g. a second One in a Million answer, or a gem without a note.
 */
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "vite";
import { formatBank, validateBank, type Bank } from "../lib/game/bank.js";
import { TIER_INFO } from "../lib/game/scoring.js";
import { SupabaseTierStore } from "../server/tier-store.js";
import { BANK_PATH, bold, dim, green, readBankJson, red, yellow } from "./bank-file.js";

const dryRun = process.argv.includes("--dry-run");
const env = loadEnv("development", process.cwd(), "");
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(red("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first."));
  process.exit(1);
}
const store = new SupabaseTierStore(createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }));

const overrides = await store.all();
const bank = readBankJson(BANK_PATH) as Bank;
const merged: { promptId: string; canonical: string }[] = [];
let skipped = 0;

for (const [promptId, changes] of Object.entries(overrides)) {
  const prompt = bank.find((p) => p.id === promptId);
  for (const [canonical, tier] of Object.entries(changes)) {
    const answer = prompt?.answers.find((a) => a.canonical === canonical);
    if (!prompt || !answer) {
      // e.g. an AI-judged answer that isn't in the bank yet: merge-approved adds it first.
      console.log(`${yellow("!")} ${canonical} ${dim(`(${promptId})`)}: not in the bank; kept in the database.`);
      skipped++;
      continue;
    }
    if (answer.tier === tier) {
      merged.push({ promptId, canonical });
      continue;
    }
    if (tier === "one_in_a_million" && !answer.gem_note) {
      console.log(`${yellow("!")} ${canonical} ${dim(`(${promptId})`)}: One in a Million needs a gem_note. Add one in data/prompts.json, then re-run.`);
      skipped++;
      continue;
    }
    console.log(`${green("~")} ${bold(canonical)} ${dim(`(${promptId})`)}: ${TIER_INFO[answer.tier].label} → ${TIER_INFO[tier].label}`);
    answer.tier = tier;
    if (tier !== "one_in_a_million") delete answer.gem_note;
    merged.push({ promptId, canonical });
  }
}

if (merged.length === 0) {
  console.log(skipped ? "Nothing to merge." : "No saved tier changes. Move answers in the host console first.");
  process.exit(0);
}

const validation = validateBank(bank);
if (validation.errors.length > 0) {
  console.error(red(`\nThe bank would have ${validation.errors.length} error(s); nothing was written:`));
  for (const e of validation.errors.slice(0, 20)) console.error(`  ${e.promptId ?? ""} ${e.answer ?? ""} ${e.message}`);
  process.exit(1);
}

if (dryRun) {
  console.log(dim(`\nDry run: ${merged.length} change(s). Run without --dry-run to write data/prompts.json.`));
  process.exit(0);
}

writeFileSync(BANK_PATH, formatBank(bank), "utf8");
for (const m of merged) await store.set(m.promptId, m.canonical, null, Date.now());
console.log(green(`\n✔ Merged ${merged.length} tier change(s) into data/prompts.json and cleared them from the database.`) + dim(" Commit and redeploy."));
