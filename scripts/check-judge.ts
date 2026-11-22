/**
 * npm run check-judge — is the AI judge working? Sends two sample answers to
 * Gemini using GEMINI_API_KEY / JUDGE_MODEL from .env.local and prints the verdicts.
 * Uses 2 of the day's free requests. Saves nothing.
 */
import { loadEnv } from "vite";
import { getPrompt } from "../server/bank.js";
import { checkVerdict, geminiClient, judgeConfigFromEnv } from "../server/judge.js";
import { dim, green, red } from "./bank-file.js";

Object.assign(process.env, loadEnv("development", process.cwd(), ""));
const config = judgeConfigFromEnv();
if (!process.env.GEMINI_API_KEY) {
  console.log("The AI judge is off: no GEMINI_API_KEY in .env.local. Get a free key at https://aistudio.google.com/apikey");
  process.exit(0);
}
const prompt = getPrompt("judges-of-israel")!;
const client = geminiClient(process.env.GEMINI_API_KEY, config.model);
console.log(dim(`Model: ${config.model} · prompt: "${prompt.prompt}"`));

let failures = 0;
for (const [answer, expected] of [["Shamgar son of Anath", true], ["Gandalf the Grey", false]] as const) {
  const started = Date.now();
  try {
    const v = checkVerdict(await client.judge({ prompt, answer }));
    const okay = v.valid === expected;
    if (!okay) failures++;
    console.log(`${okay ? green("✓") : red("✗")} "${answer}" → ${v.valid ? "valid" : "not valid"} ${dim(`(${Date.now() - started} ms)`)}`);
    console.log(dim(`    ${[v.canonical, v.reference, v.reason].filter(Boolean).join(" · ")}`));
  } catch (err) {
    failures++;
    console.log(`${red("✗")} "${answer}" → ${err instanceof Error ? err.message : String(err)}`);
  }
}
console.log(failures === 0 ? green("\nThe AI judge is working.") : red(`\n${failures} check(s) failed.`));
process.exit(failures === 0 ? 0 : 1);
