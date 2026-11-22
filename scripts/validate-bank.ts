/**
 * npm run validate-bank [-- --quiet] [-- path/to/prompts.json]
 *
 * Fails (exit 1) on schema errors. Fuzzy collisions and other soft issues are warnings.
 * --quiet hides the warning details (still prints the count).
 */
import { validateBank, type BankIssue } from "../lib/game/bank.js";
import { BANK_PATH, bold, cyan, dim, green, readBankJson, red, yellow } from "./bank-file.js";

const args = process.argv.slice(2);
const quiet = args.includes("--quiet");
const path = args.find((a) => !a.startsWith("--")) ?? BANK_PATH;

const { errors, warnings, stats } = validateBank(readBankJson(path));

function printGrouped(issues: BankIssue[], color: (s: string) => string, symbol: string) {
  const groups = new Map<string, BankIssue[]>();
  for (const issue of issues) {
    const key = issue.promptId ?? "(bank)";
    groups.set(key, [...(groups.get(key) ?? []), issue]);
  }
  for (const [promptId, list] of groups) {
    console.log(`  ${cyan(promptId)}`);
    for (const issue of list) {
      console.log(`    ${color(symbol)} ${issue.answer ? bold(issue.answer) + ": " : ""}${issue.message}`);
    }
  }
}

console.log(bold(`Validating ${path}`));
console.log(
  dim(
    `  ${stats.prompts} prompts (${stats.closedSet} closed-set) · ${stats.answers} answers · ${stats.gems} gems · ` +
      `${stats.needsReview} need review\n` +
      `  testament: OT ${stats.byTestament.OT}, NT ${stats.byTestament.NT}, both ${stats.byTestament.both} · ` +
      `difficulty: easy ${stats.byDifficulty.easy}, medium ${stats.byDifficulty.medium}, hard ${stats.byDifficulty.hard}` +
      (stats.byDifficulty.unset ? `, unset ${stats.byDifficulty.unset}` : ""),
  ),
);

if (warnings.length) {
  console.log(yellow(`\n${warnings.length} warning(s)`) + (quiet ? dim(" (details hidden by --quiet)") : ""));
  if (!quiet) printGrouped(warnings, yellow, "⚠");
}
if (errors.length) {
  console.log(red(`\n${errors.length} error(s)`));
  printGrouped(errors, red, "✖");
  process.exit(1);
}
console.log(green(`\n✔ Bank is valid.`));
