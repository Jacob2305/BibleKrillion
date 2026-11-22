/**
 * npm run format-bank  -> rewrites data/prompts.json in the standard layout
 * (one answer per line, stable key order). Run after hand edits for clean diffs.
 */
import { writeFileSync } from "node:fs";
import { formatBank, type Bank } from "../lib/game/bank.js";
import { BANK_PATH, green, readBankJson } from "./bank-file.js";

const bank = readBankJson(BANK_PATH);
if (!Array.isArray(bank)) {
  console.error("Bank must be a JSON array.");
  process.exit(1);
}
writeFileSync(BANK_PATH, formatBank(bank as Bank), "utf8");
console.log(green(`✔ Formatted ${BANK_PATH}`));
