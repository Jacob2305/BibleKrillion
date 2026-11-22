/**
 * npm run check-supabase — is the Supabase project ready for Bible Dive?
 *
 * Checks (using the keys in .env.local; prints no secrets):
 *   • the server (service-role key) can reach every table and helper function
 *   • the browser (anon key) can NOT read or write any table
 *   • phones can receive a private room broadcast, and can't send one
 * Leaves no data behind.
 */
import { loadEnv } from "vite";
import { createClient } from "@supabase/supabase-js";
import * as c from "./bank-file.js";

const env = loadEnv("development", process.cwd(), "");
const url = env.SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = env.SUPABASE_ANON_KEY;
if (!url || !serviceKey || !anonKey) {
  console.error(c.red("Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.local first (see README → Supabase setup)."));
  process.exit(1);
}

const server = createClient(url, serviceKey, { auth: { persistSession: false } });
const browser = createClient(url, anonKey, { auth: { persistSession: false } });
let failures = 0;
const ok = (msg: string) => console.log(`${c.green("✓")} ${msg}`);
const bad = (msg: string, hint?: string) => {
  failures++;
  console.log(`${c.red("✗")} ${msg}${hint ? `\n    ${c.dim(hint)}` : ""}`);
};

const TABLES = ["daily_results", "rejected_answers", "rooms", "players", "rounds", "submissions", "judge_cache", "judge_calls"];
const RERUN = "Run the migration files in supabase/migrations/ again (SQL Editor → paste → Run).";

for (const table of TABLES) {
  // A real (zero-row) select: head-only requests report a missing table as success.
  const { error } = await server.from(table).select("*").limit(0);
  if (error) bad(`server can read ${table}`, `${error.message || "permission denied"} — ${RERUN}`);
  else ok(`server can read ${table}`);
}

{
  const { error } = await server.from("submissions").select("ai, reference").limit(0);
  if (error) bad("submissions has the AI-judge columns", `${error.message} — run supabase/migrations/0003_judge.sql.`);
  else ok("submissions has the AI-judge columns");
}
{
  const key = `check:${Math.random().toString(36).slice(2, 10)}`;
  const { data, error } = await server.rpc("judge_take_call", { p_key: key, p_limit: 1 });
  if (error || data !== true) bad("server can call judge_take_call()", `${error?.message ?? "unexpected result"} — run supabase/migrations/0003_judge.sql.`);
  else ok("server can call judge_take_call()");
  await server.from("judge_calls").delete().eq("key", key);
}

const today = new Date().toISOString().slice(0, 10);
for (const [fn, args] of [
  ["daily_distribution", { p_day: today }],
  ["daily_standing", { p_day: today, p_total: 0 }],
] as const) {
  const { error } = await server.rpc(fn, args);
  if (error) bad(`server can call ${fn}()`, `${error.message} — ${RERUN}`);
  else ok(`server can call ${fn}()`);
}

for (const table of TABLES) {
  const { data, error } = await browser.from(table).select("*").limit(1);
  if (error || (data ?? []).length === 0) ok(`browsers can't read ${table}`);
  else bad(`browsers CAN read ${table}`, "Row Level Security must be on with no public policies. Re-run the migrations.");
}
{
  const { error } = await browser.from("rooms").insert({ code: "BBBB", prompt_ids: [], seconds: 25 });
  if (error) ok("browsers can't write rooms");
  else bad("browsers CAN write rooms", "Re-run supabase/migrations/0002_live.sql.");
}
{
  const { error } = await browser.rpc("daily_distribution", { p_day: today });
  if (error) ok("browsers can't call daily_distribution()");
  else bad("browsers CAN call daily_distribution()", "Re-run supabase/migrations/0001_daily.sql.");
}

// Realtime: a private room channel a phone can hear but not talk on.
const topic = `room:check-${Math.random().toString(36).slice(2, 10)}`;
let heard: unknown = null;
let spoofHeard = false;
const listener = browser.channel(topic, { config: { private: true } }).on("broadcast", { event: "state" }, ({ payload }) => {
  if ((payload as { from?: string }).from === "phone") spoofHeard = true;
  else heard = payload;
});
const status = await new Promise<string>((resolve) => {
  const timer = setTimeout(() => resolve("timed out"), 10_000);
  listener.subscribe((s, err) => {
    if (s === "SUBSCRIBED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT") {
      clearTimeout(timer);
      resolve(s === "SUBSCRIBED" ? s : `${s}${err ? `: ${err.message}` : ""}`);
    }
  });
});
if (status !== "SUBSCRIBED") {
  bad("phones can listen on private room channels", `${status} — re-run supabase/migrations/0002_live.sql (it adds the listen policy).`);
} else {
  ok("phones can listen on private room channels");
  try {
    await server.channel(topic, { config: { private: true } }).httpSend("state", { from: "server" });
  } catch (err) {
    bad("server can broadcast", err instanceof Error ? err.message : String(err));
  }
  await listener.send({ type: "broadcast", event: "state", payload: { from: "phone" } }).catch(() => "error");
  await new Promise((r) => setTimeout(r, 2000));
  if (heard) ok("phones receive server broadcasts");
  else bad("phones receive server broadcasts", "Nothing arrived within 2 s. Check Realtime is enabled for the project.");
  if (spoofHeard) bad("phones CAN broadcast to a room", "Re-run 0002_live.sql; there must be no INSERT policy on realtime.messages.");
  else ok("phones can't broadcast to a room");
}
// Public channels should be off so nobody can open an unauthenticated channel.
{
  const pub = browser.channel(`check-public-${Math.random().toString(36).slice(2, 8)}`);
  const s = await new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve("timed out"), 8000);
    pub.subscribe((st) => {
      if (st === "SUBSCRIBED" || st === "CHANNEL_ERROR" || st === "TIMED_OUT") {
        clearTimeout(timer);
        resolve(st);
      }
    });
  });
  if (s === "SUBSCRIBED") console.log(`${c.yellow("!")} public channels are allowed ${c.dim("— optional hardening: Realtime → Settings → turn off “Allow public access”.")}`);
  else ok("public channels are off");
  await browser.removeChannel(pub);
}
await browser.removeAllChannels();

console.log(failures === 0 ? c.green("\nSupabase is ready for Bible Dive.") : c.red(`\n${failures} check(s) failed.`));
process.exit(failures === 0 ? 0 : 1);
