/**
 * Load test: one live room with ~100 simulated phones.
 *
 *   npm run load-test                                   # 100 players, 3 rounds, against http://localhost:5173
 *   npm run load-test -- --base https://your-app.vercel.app --pin 1234 --realtime
 *   npm run load-test -- --players 150 --rounds 5 --seconds 20
 *
 * What it does, like a real event:
 *  - the host creates a room; every player joins within a few seconds (a QR-code rush);
 *  - each round, players answer at random moments: most give a right answer, some miss first,
 *    some make a typo and confirm the "Did you mean …?", a few never answer;
 *  - phones keep polling the room like the real app (every 3 s; every 30 s with --realtime,
 *    where each phone also listens on the room's Supabase broadcast channel);
 *  - the host reveals, shows the leaderboard, and finally ends the room.
 * It reports response times per call, errors, realtime delivery, and checks that every locked
 * answer was counted and every player is on the leaderboard. Exit code 1 if anything failed.
 *
 * Answers come from data/prompts.json (this script runs on your machine, not in a browser).
 * It creates a real room: against production, run it before the event, not during one.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { LiveAnswerResponse, LiveHostResponse, LiveJoinResponse, LiveSnapshot, LiveStateResponse } from "../lib/game/live-types.js";

// ───────────────────────── options ─────────────────────────

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : "true";
}
const BASE = (arg("base", process.env.LOAD_BASE ?? "http://localhost:5173") as string).replace(/\/+$/, "");
const PLAYERS = Math.max(1, Number(arg("players", "100")));
const ROUNDS = Math.min(12, Math.max(3, Number(arg("rounds", "3"))));
const SECONDS = Math.min(60, Math.max(10, Number(arg("seconds", "15"))));
const PIN = arg("pin", process.env.HOST_PIN);
const REALTIME = arg("realtime") === "true";
const TEAMS = arg("no-teams") !== "true";
const JOIN_SPREAD_MS = Number(arg("join-spread", "4000"));

interface BankAnswer {
  canonical: string;
  tier: string;
  generic_for?: string[];
}
const bank = JSON.parse(readFileSync(new URL("../data/prompts.json", import.meta.url), "utf8")) as { prompt: string; answers: BankAnswer[] }[];
const byText = new Map(bank.map((p) => [p.prompt, p]));

// ───────────────────────── measuring ─────────────────────────

const timings = new Map<string, number[]>();
const errors = new Map<string, number>();
const failures: string[] = [];
let requests = 0;
let listening = 0;
const outcomes = { confirmed: 0, missedFirst: 0, silent: 0 };

async function api<T>(label: string, body: Record<string, unknown>): Promise<T> {
  const t0 = performance.now();
  requests++;
  try {
    const res = await fetch(`${BASE}/api/live`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(`${res.status} ${data.error ?? ""}`.trim());
    return data;
  } catch (err) {
    errors.set(label, (errors.get(label) ?? 0) + 1);
    throw err;
  } finally {
    const list = timings.get(label) ?? [];
    list.push(performance.now() - t0);
    timings.set(label, list);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)]!;
const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};
function check(ok: boolean, what: string) {
  console.log(`  ${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures.push(what);
}

// ───────────────────────── players ─────────────────────────

interface Player {
  name: string;
  token: string;
  id: string;
  version: number;
  /** When each snapshot version first reached this phone over the socket. */
  socketVersions: Map<number, number>;
  locked: Set<number>;
  stop: () => void;
}

/** A one-letter typo the matcher should correct, if the answer is a single plain word. */
function typoOf(text: string): string | null {
  if (!/^[A-Za-z]{6,}$/.test(text)) return null;
  return text.slice(0, 3) + text.slice(4);
}

async function playRound(p: Player, snap: LiveSnapshot, deadlineLocal: number) {
  const q = snap.question!;
  const prompt = byText.get(q.prompt.prompt);
  const roll = Math.random();
  if (roll < 0.05 || !prompt) {
    outcomes.silent++;
    return; // never answers
  }
  const latest = deadlineLocal - Date.now() - 1500;
  await sleep(rand(800, Math.max(1000, latest)));
  const send = (text: string, confirm?: boolean) =>
    api<LiveAnswerResponse>("answer", { action: "answer", playerToken: p.token, index: q.index, text, confirm }).catch(() => null);

  const answers = prompt.answers.filter((a) => !a.generic_for);
  const right = pick(answers.length > 0 ? answers : prompt.answers).canonical;
  if (roll < 0.2) {
    outcomes.missedFirst++;
    await send("Zzyzx not an answer"); // a miss first, then the right one
    await sleep(rand(300, 1200));
  }
  const typo = roll >= 0.2 && roll < 0.35 ? typoOf(right) : null;
  let res = await send(typo ?? right);
  if (res?.status === "confirm") {
    outcomes.confirmed++;
    await sleep(rand(200, 700)); // reads "Did you mean …?" and presses Enter
    res = await send(typo ?? right, true);
  }
  if (res?.status === "locked") p.locked.add(q.index);
}

async function listen(p: Player, realtime: NonNullable<LiveJoinResponse["realtime"]>): Promise<void> {
  const client = createClient(realtime.url, realtime.key, { auth: { persistSession: false, autoRefreshToken: false } });
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 10_000);
    const channel = client
      .channel(realtime.topic, { config: { private: true } })
      .on("broadcast", { event: "state" }, ({ payload }) => {
        const v = (payload as LiveSnapshot).version;
        if (!p.socketVersions.has(v)) p.socketVersions.set(v, Date.now());
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          listening++;
          clearTimeout(timer);
          resolve();
        }
      });
    const prevStop = p.stop;
    p.stop = () => {
      prevStop();
      void client.removeChannel(channel);
    };
  });
}

// ───────────────────────── the event ─────────────────────────

async function main() {
  console.log(`Load test → ${BASE}: ${PLAYERS} players, ${ROUNDS} rounds × ${SECONDS}s${REALTIME ? ", realtime sockets" : ", polling"}\n`);

  const created = await api<LiveHostResponse>("create", { action: "create", pin: PIN, rounds: ROUNDS, seconds: SECONDS, teams: TEAMS, bots: false });
  const hostToken = created.hostToken;
  const host = (op: string) => api<LiveHostResponse>(`host:${op}`, { action: "host", hostToken, op });
  console.log(`Room ${created.snapshot.code} created.`);

  // Everyone scans the QR code within a few seconds.
  const players: Player[] = [];
  const t0 = Date.now();
  await Promise.all(
    Array.from({ length: PLAYERS }, async (_, i) => {
      await sleep(Math.random() * JOIN_SPREAD_MS);
      const name = `Load ${String(i + 1).padStart(3, "0")}`;
      try {
        const res = await api<LiveJoinResponse>("join", {
          action: "join",
          code: created.snapshot.code,
          nickname: name,
          team: TEAMS ? `Team ${(i % 8) + 1}` : undefined,
        });
        const p: Player = { name, token: res.playerToken, id: res.me.id, version: res.snapshot.version, socketVersions: new Map(), locked: new Set(), stop: () => {} };
        players.push(p);
        if (REALTIME && res.realtime) await listen(p, res.realtime);
      } catch (err) {
        console.log(`  join failed for ${name}: ${(err as Error).message}`);
      }
    }),
  );
  console.log(`${players.length} joined in ${((Date.now() - t0) / 1000).toFixed(1)}s${REALTIME ? `, ${listening} listening on the socket` : ""}.`);

  // Phones poll like the real app.
  let polling = true;
  const pollEvery = REALTIME ? 30_000 : 3000;
  const pollers = players.map(async (p) => {
    await sleep(Math.random() * pollEvery);
    while (polling) {
      const res = await api<LiveStateResponse>("state (poll)", { action: "state", playerToken: p.token }).catch(() => null);
      if (res) p.version = Math.max(p.version, res.snapshot.version);
      await sleep(pollEvery);
    }
  });

  const lobby = (await host("state")).snapshot;
  console.log("\nLobby");
  check(lobby.playerCount === players.length, `projector shows ${lobby.playerCount} of ${players.length} players`);

  const delivered: number[] = [];
  for (let r = 0; r < ROUNDS; r++) {
    console.log(`\nRound ${r + 1}`);
    const started = (await host("start")).snapshot;
    const deadline = Date.now() + (started.question!.deadline - started.serverNow);
    await Promise.all(players.map((p) => playRound(p, started, deadline)));
    await sleep(Math.max(0, deadline - Date.now()));
    const revealed = (await host("reveal")).snapshot;
    const lockedThisRound = players.filter((p) => p.locked.has(r)).length;
    check(revealed.reveal?.answered === lockedThisRound, `reveal counts ${revealed.reveal?.answered} answers; players locked ${lockedThisRound}`);
    const total = Object.values(revealed.reveal?.counts ?? {}).reduce((a, b) => a + b, 0);
    check(total === lockedThisRound, `answer counts add up (${total})`);
    if (REALTIME) {
      await sleep(1500);
      const got = players.filter((p) => p.socketVersions.has(revealed.version));
      delivered.push(got.length / Math.max(1, players.length));
      check(got.length === players.length, `reveal reached ${got.length}/${players.length} phones over the socket`);
    }
    const board = (await host("leaderboard")).snapshot;
    check((board.leaderboard?.length ?? 0) === players.length, `leaderboard lists all ${board.leaderboard?.length ?? 0} players`);
    const ranks = (board.leaderboard ?? []).map((row) => row.rank);
    check(ranks.every((x, i) => i === 0 || x >= ranks[i - 1]!), "leaderboard is in rank order");
  }

  const final = (await host("final")).snapshot;
  console.log("\nFinal");
  check((final.leaderboard?.length ?? 0) === players.length, "final podium lists everyone");
  await host("end").catch(() => {});
  polling = false;
  players.forEach((p) => p.stop());
  await Promise.race([Promise.all(pollers), sleep(pollEvery + 2000)]);

  // ───────────── report
  const seconds = (Date.now() - t0) / 1000;
  console.log(`\nResponse times (ms)          calls    p50    p95    max  errors`);
  for (const [label, list] of [...timings.entries()].sort()) {
    console.log(
      `  ${label.padEnd(26)} ${String(list.length).padStart(6)} ${pct(list, 50).toFixed(0).padStart(6)} ${pct(list, 95).toFixed(0).padStart(6)} ${Math.max(...list)
        .toFixed(0)
        .padStart(6)} ${String(errors.get(label) ?? 0).padStart(7)}`,
    );
  }
  console.log(`\nPlayers: ${outcomes.missedFirst} wrong first tries, ${outcomes.confirmed} "Did you mean …?" confirmations, ${outcomes.silent} skipped a prompt.`);
  console.log(`${requests} requests in ${seconds.toFixed(0)}s (${(requests / seconds).toFixed(1)}/s on average).`);
  if (REALTIME && delivered.length) {
    console.log(`Realtime: ${(Math.min(...delivered) * 100).toFixed(0)}% of phones got every reveal.`);
  }
  const errorCount = [...errors.values()].reduce((a, b) => a + b, 0);
  const slow = pct(timings.get("answer") ?? [], 95);
  if (errorCount > 0) failures.push(`${errorCount} request errors`);
  if (slow > 2500) failures.push(`answers are slow (p95 ${slow.toFixed(0)} ms)`);
  console.log(failures.length === 0 ? "\nPASS ✓" : `\nFAIL ✗\n  - ${failures.join("\n  - ")}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nLoad test stopped: ${(err as Error).message}`);
  process.exit(1);
});
