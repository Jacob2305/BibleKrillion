import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BANK_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data", "prompts.json");

export function readBankJson(path: string = BANK_PATH): unknown {
  const text = readFileSync(path, "utf8");
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error(`✖ ${path} is not valid JSON: ${(e as Error).message}`);
    process.exit(1);
  }
}

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const red = paint("31");
export const yellow = paint("33");
export const green = paint("32");
export const cyan = paint("36");
export const dim = paint("2");
export const bold = paint("1");
