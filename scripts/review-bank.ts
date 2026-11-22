/**
 * npm run review-bank                  -> every answer marked needs_review, with why
 * npm run review-bank -- --all         -> the whole bank, grouped by prompt and tier
 * npm run review-bank -- --prompt ID   -> limit to one prompt (works with --all)
 * npm run review-bank -- --gems        -> every gem and its gem_note
 */
import type { Bank, BankAnswer } from "../lib/game/bank.js";
import { TIER_INFO, TIER_ORDER } from "../lib/game/scoring.js";
import { BANK_PATH, bold, cyan, dim, readBankJson, yellow } from "./bank-file.js";

const args = process.argv.slice(2);
const all = args.includes("--all");
const gemsOnly = args.includes("--gems");
const promptFlag = args.indexOf("--prompt");
const onlyPrompt = promptFlag >= 0 ? args[promptFlag + 1] : undefined;

const bank = readBankJson(BANK_PATH) as Bank;
if (!Array.isArray(bank)) {
  console.error("Bank is not an array; run npm run validate-bank first.");
  process.exit(1);
}

function line(a: BankAnswer): string {
  const tier = TIER_INFO[a.tier]?.label ?? a.tier;
  const aliases = a.aliases?.length ? dim(` (aka ${a.aliases.join(", ")})`) : "";
  const generic = a.generic_for ? dim(` [generic for: ${a.generic_for.join(", ")}]`) : "";
  const flag = a.needs_review ? yellow(" ⚑") : "";
  let out = `    ${bold(a.canonical)}${aliases}${generic} — ${tier} — ${a.reference}${flag}`;
  if (a.review_note) out += `\n      ${yellow("why:")} ${a.review_note}`;
  if (a.gem_note && (gemsOnly || all)) out += `\n      ${cyan("gem:")} ${a.gem_note}`;
  return out;
}

let shown = 0;
for (const prompt of bank) {
  if (onlyPrompt && prompt.id !== onlyPrompt) continue;
  let answers = prompt.answers ?? [];
  if (gemsOnly) answers = answers.filter((a) => a.tier === "one_in_a_million");
  else if (!all) answers = answers.filter((a) => a.needs_review);
  if (answers.length === 0) continue;

  const kind = prompt.closed_set ? "closed set" : "open set";
  console.log(`\n${cyan(prompt.id)} ${dim(`· ${prompt.testament} · ${kind} · ${prompt.difficulty ?? "?"}`)}\n  ${bold(prompt.prompt)}`);
  if (all) {
    const sorted = [...answers].sort((x, y) => TIER_ORDER.indexOf(x.tier) - TIER_ORDER.indexOf(y.tier));
    for (const a of sorted) console.log(line(a));
  } else {
    for (const a of answers) console.log(line(a));
  }
  shown += answers.length;
}

const what = gemsOnly ? "gem(s)" : all ? "answer(s)" : "answer(s) marked needs_review";
console.log(`\n${shown} ${what}${onlyPrompt ? ` in ${onlyPrompt}` : ""}.`);
if (!all && !gemsOnly) {
  console.log(dim("When you've checked one, delete its needs_review/review_note (or fix it), then run npm run validate-bank."));
}
