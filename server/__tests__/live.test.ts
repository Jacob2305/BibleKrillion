import { MemoryTierStore, type TierStore } from "../tier-store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveAnswerResponse, LiveHostResponse, LiveJoinResponse, LiveSnapshot, LiveStateResponse } from "../../lib/game/live-types";
import { pointsForTier } from "../../lib/game/scoring";
import { getPrompt, matchPrompt } from "../bank";
import { SUBMIT_GRACE_MS } from "../config";
import { EVENT_PROMPT_IDS } from "../event-set";
import { LIVE_MESSAGES, MAX_PLAYERS, createLiveHandler } from "../live";
import { BOT_NAMES, botPick, visibleSubs } from "../live-bots";
import type { Broadcaster } from "../live-broadcast";
import { MemoryLiveStore } from "../live-store";

const T0 = Date.parse("2026-11-20T23:00:00Z");

/** A one-letter typo of some answer that the matcher corrects (a "fuzzy" match). */
function typoFor(promptId: string): { typo: string; canonical: string } {
  const p = getPrompt(promptId)!;
  for (const a of p.answers) {
    if (a.canonical.length < 6 || !/^[A-Za-z]+$/.test(a.canonical)) continue;
    const typo = a.canonical.slice(0, 3) + a.canonical.slice(4);
    const m = matchPrompt(p, typo);
    if (m.kind === "fuzzy" && m.answer.canonical === a.canonical) return { typo, canonical: a.canonical };
  }
  throw new Error(`no typo-able answer for ${promptId}`);
}

function setup(opts: { bots?: number; tiers?: TierStore } = {}) {
  const clock = { t: T0 };
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const store = new MemoryLiveStore();
  const sent: { roomId: string; snapshot: LiveSnapshot }[] = [];
  const broadcaster: Broadcaster = {
    realtimeFor: (roomId) => ({ url: "https://example.supabase.co", key: "anon", topic: `room:${roomId}` }),
    send: async (roomId, snapshot) => void sent.push({ roomId, snapshot: structuredClone(snapshot) }),
  };
  const sleeps: number[] = [];
  const handler = createLiveHandler({
    now: () => clock.t,
    random,
    store: () => store,
    broadcaster: () => broadcaster,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.t += ms;
    },
    bots: opts.bots,
    tiers: opts.tiers ? () => opts.tiers! : undefined,
  });
  async function call<T = unknown>(body: unknown): Promise<{ status: number; data: T }> {
    const res = await handler(new Request("http://test/api/live", { method: "POST", body: JSON.stringify(body) }));
    return { status: res.status, data: (await res.json()) as T };
  }
  const create = (extra: Record<string, unknown> = {}) => call<LiveHostResponse>({ action: "create", ...extra });
  const hostOp = (hostToken: string, op: string, extra: Record<string, unknown> = {}) =>
    call<LiveHostResponse>({ action: "host", hostToken, op, ...extra });
  const join = (code: string, nickname: string, team?: string) => call<LiveJoinResponse>({ action: "join", code, nickname, team });
  const answer = (playerToken: string, index: number, text: string) => call<LiveAnswerResponse>({ action: "answer", playerToken, index, text });
  const stateOf = (playerToken: string) => call<LiveStateResponse>({ action: "state", playerToken });
  return { clock, store, sent, sleeps, call, create, hostOp, join, answer, stateOf };
}

/** A non-generic bank answer of the given tier (or any) for a prompt. */
function answerFor(promptId: string, tier?: string): { text: string; points: number } {
  const p = getPrompt(promptId)!;
  const a = p.answers.find((x) => x.tier === tier && !x.generic_for) ?? p.answers.find((x) => !x.generic_for)!;
  return { text: a.canonical, points: pointsForTier(a.tier) };
}

/** Room with three players, already started on prompt 0. */
async function startedRoom(env: ReturnType<typeof setup>, extra: Record<string, unknown> = {}) {
  const { data: room } = await env.create(extra);
  const players = [];
  for (const name of ["Ann", "Bo", "Cy"]) players.push((await env.join(room.snapshot.code, name, `${name} team`)).data);
  const { data: started } = await env.hostOp(room.hostToken, "start");
  return { room, players, started, promptIds: started.host.prompts.map((p) => p.id) };
}

/** Keys that would leak the answer bank. */
function leaksAnswers(value: unknown): boolean {
  return /"(answers|canonical|reference|gemNote|counts|finders)"/.test(JSON.stringify(value));
}

beforeEach(() => vi.spyOn(console, "info").mockImplementation(() => {}));
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.HOST_PIN;
});

describe("creating a room", () => {
  it("returns a host token, a 4-letter code and the event's 12 prompts in order", async () => {
    const env = setup();
    const { status, data } = await env.create();
    expect(status).toBe(200);
    expect(data.snapshot.code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(data.snapshot).toMatchObject({ phase: "lobby", roundIndex: -1, roundCount: 12, playerCount: 0, closed: false });
    expect(data.host.prompts.map((p) => p.id)).toEqual([...EVENT_PROMPT_IDS]);
    expect(data.realtime?.topic).toMatch(/^room:/);
  });

  it("every event prompt exists in the bank, with no repeats", () => {
    expect(EVENT_PROMPT_IDS).toHaveLength(12);
    expect(new Set(EVENT_PROMPT_IDS).size).toBe(12);
    for (const id of EVENT_PROMPT_IDS) expect(getPrompt(id), id).toBeDefined();
  });

  it("fewer rounds play the first N event prompts", async () => {
    const env = setup();
    const { data } = await env.create({ rounds: 5 });
    expect(data.host.prompts.map((p) => p.id)).toEqual(EVENT_PROMPT_IDS.slice(0, 5));
  });

  it("clamps the settings", async () => {
    const env = setup();
    const { data } = await env.create({ rounds: 50, seconds: 2, teams: true });
    expect(data.snapshot).toMatchObject({ roundCount: 12, seconds: 10, teams: true });
  });

  it("allows up to 120 seconds a prompt", async () => {
    const env = setup();
    expect((await env.create({ seconds: 120 })).data.snapshot.seconds).toBe(120);
    expect((await env.create({ seconds: 500 })).data.snapshot.seconds).toBe(120);
  });

  it("requires HOST_PIN when one is set", async () => {
    const env = setup();
    process.env.HOST_PIN = "4821";
    expect((await env.create()).status).toBe(401);
    expect((await env.create({ pin: "1111" })).data).toMatchObject({ code: "pin" });
    expect((await env.create({ pin: " 4821 " })).status).toBe(200);
  });

  it("never hands out the same open code twice", async () => {
    const env = setup();
    const codes = new Set<string>();
    for (let i = 0; i < 60; i++) codes.add((await env.create()).data.snapshot.code);
    expect(codes.size).toBe(60);
  });
});

describe("joining", () => {
  it("accepts lower-case codes and shows the player in the lobby", async () => {
    const env = setup();
    const { data: room } = await env.create();
    const { status, data } = await env.join(room.snapshot.code.toLowerCase(), "  Deep Sea Deb ");
    expect(status).toBe(200);
    expect(data.me).toMatchObject({ nickname: "Deep Sea Deb", team: null, kicked: false, current: null });
    expect(data.snapshot.players?.map((p) => p.nickname)).toEqual(["Deep Sea Deb"]);
    const { data: host } = await env.hostOp(room.hostToken, "state");
    expect(host.snapshot.playerCount).toBe(1);
  });

  it("rejects bad codes, unknown rooms and taken names", async () => {
    const env = setup();
    const { data: room } = await env.create();
    expect((await env.join("AB", "Jo")).status).toBe(400);
    expect((await env.join(room.snapshot.code === "BBBB" ? "CCCC" : "BBBB", "Jo")).status).toBe(404);
    expect((await env.join(room.snapshot.code, "")).status).toBe(400);
    await env.join(room.snapshot.code, "Sam");
    const taken = await env.join(room.snapshot.code, " SAM ");
    expect(taken.status).toBe(409);
    expect(taken.data).toMatchObject({ code: "name_taken" });
  });

  it("keeps team names only when the host turned teams on", async () => {
    const env = setup();
    const off = (await env.create()).data;
    expect((await env.join(off.snapshot.code, "A", "Lions")).data.me.team).toBeNull();
    const on = (await env.create({ teams: true })).data;
    expect((await env.join(on.snapshot.code, "A", "  Lions ")).data.me.team).toBe("Lions");
  });

  it(`caps a room at ${MAX_PLAYERS} players`, async () => {
    const env = setup();
    const { data: room } = await env.create();
    for (let i = 0; i < MAX_PLAYERS; i++) expect((await env.join(room.snapshot.code, `P${i}`)).status).toBe(200);
    expect((await env.join(room.snapshot.code, "One too many")).data).toMatchObject({ code: "full" });
  });

  it("lets late joiners in mid-game but not after the final", async () => {
    const env = setup();
    const { room } = await startedRoom(env);
    const late = await env.join(room.snapshot.code, "Late");
    expect(late.status).toBe(200);
    expect(late.data.snapshot.phase).toBe("question");
    await env.hostOp(room.hostToken, "reveal");
    await env.hostOp(room.hostToken, "final");
    expect((await env.join(room.snapshot.code, "Later")).status).toBe(410);
  });
});

describe("a full game", () => {
  it("never sends answers before the reveal", async () => {
    const env = setup();
    const { room, players, started } = await startedRoom(env);
    expect(leaksAnswers(room)).toBe(false);
    expect(leaksAnswers(players)).toBe(false);
    expect(leaksAnswers(started.snapshot)).toBe(false);
    expect(started.snapshot.question?.prompt.prompt).toBeTruthy();
    expect(leaksAnswers(env.sent.map((s) => s.snapshot))).toBe(false);
    expect(leaksAnswers((await env.stateOf(players[0]!.playerToken)).data.snapshot)).toBe(false);
  });

  it("asks to confirm a corrected spelling and locks nothing until then", async () => {
    const env = setup();
    const { players, promptIds } = await startedRoom(env);
    const t = typoFor(promptIds[0]!); // the test room's prompts are seeded, so this is stable
    expect((await env.answer(players[0]!.playerToken, 0, t.typo)).data).toEqual({ status: "confirm", suggestion: t.canonical });
    const confirmed = await env.call<LiveAnswerResponse>({ action: "answer", playerToken: players[0]!.playerToken, index: 0, text: t.typo, confirm: true });
    expect(confirmed.data).toEqual({ status: "locked", index: 0, canonical: t.canonical });
  });

  it("locks the first accepted answer, scores it at reveal, and ranks players", async () => {
    const env = setup();
    const { room, players, promptIds } = await startedRoom(env);
    const [ann, bo] = players;
    const deep = answerFor(promptIds[0]!, "deep_cut");
    const easy = answerFor(promptIds[0]!, "plankton");

    expect((await env.answer(ann!.playerToken, 0, "zzzz not a real answer")).data).toEqual({ status: "rejected", message: LIVE_MESSAGES.rejected });
    expect((await env.answer(ann!.playerToken, 0, deep.text)).data).toEqual({ status: "locked", index: 0, canonical: deep.text });
    // A second answer can't replace the first.
    expect((await env.answer(ann!.playerToken, 0, easy.text)).data).toMatchObject({ status: "locked", canonical: deep.text });
    await env.answer(bo!.playerToken, 0, easy.text);

    const mid = (await env.stateOf(ann!.playerToken)).data;
    expect(mid.me?.current).toEqual({ index: 0, canonical: deep.text });
    expect(mid.snapshot.answeredCount).toBe(2);

    env.clock.t += 30_000;
    const { data: revealed } = await env.hostOp(room.hostToken, "reveal");
    const snap = revealed.snapshot;
    expect(snap.phase).toBe("reveal");
    expect(snap.reveal?.counts).toEqual({ [deep.text]: 1, [easy.text]: 1 });
    expect(snap.reveal).toMatchObject({ answered: 2, players: 3 });
    expect(snap.reveal?.finders[deep.text]).toEqual(["Ann"]);
    expect(snap.leaderboard?.map((r) => [r.nickname, r.total, r.last])).toEqual([
      ["Ann", deep.points, deep.points],
      ["Bo", easy.points, easy.points],
      ["Cy", 0, null],
    ]);

    await env.hostOp(room.hostToken, "leaderboard");
    const { data: second } = await env.hostOp(room.hostToken, "start");
    expect(second.snapshot).toMatchObject({ phase: "question", roundIndex: 1 });
    expect(second.snapshot.leaderboard).toBeUndefined();
    expect((await env.stateOf(ann!.playerToken)).data.me?.current).toBeNull();
  });

  it("refuses answers after the deadline (with a short network grace) or for another prompt", async () => {
    const env = setup();
    const { players, promptIds, started } = await startedRoom(env);
    const text = answerFor(promptIds[0]!).text;
    expect((await env.answer(players[0]!.playerToken, 1, text)).data.status).toBe("too_late");
    env.clock.t = started.snapshot.question!.deadline + SUBMIT_GRACE_MS - 1;
    expect((await env.answer(players[0]!.playerToken, 0, text)).data.status).toBe("locked");
    env.clock.t += 2;
    expect((await env.answer(players[1]!.playerToken, 0, text)).data).toEqual({ status: "too_late", message: LIVE_MESSAGES.over });
  });

  it("reveals as soon as every real player has locked in (bots don't count)", async () => {
    const env = setup({ bots: 2 });
    const { room, players, promptIds } = await startedRoom(env);
    const text = answerFor(promptIds[0]!).text;
    const before = env.sent.length;
    await env.answer(players[0]!.playerToken, 0, text);
    await env.answer(players[1]!.playerToken, 0, text);
    expect(env.sent.length).toBe(before);
    env.clock.t += 4000;
    await env.answer(players[2]!.playerToken, 0, text);
    expect(env.sent.length).toBe(before + 1);
    const revealed = env.sent.at(-1)!.snapshot;
    expect(revealed.phase).toBe("reveal");
    expect(revealed.view).toBe("climb");
    expect(revealed.question!.deadline).toBe(env.clock.t);
    expect(revealed.reveal!.answered).toBe(5); // three players and the two bots
    // The host's reveal button is now a no-op, and doesn't broadcast again.
    const { data } = await env.hostOp(room.hostToken, "reveal");
    expect(data.snapshot.phase).toBe("reveal");
    expect(env.sent.length).toBe(before + 1);
  });

  it("reveals by itself once time is up, on whichever request comes next, exactly once", async () => {
    const env = setup();
    const { room, players } = await startedRoom(env);
    const before = env.sent.length;
    // Still within the grace window: nothing happens yet.
    env.clock.t += 25_000 + SUBMIT_GRACE_MS - 1;
    expect((await env.stateOf(players[0]!.playerToken)).data.snapshot.phase).toBe("question");
    expect(env.sent.length).toBe(before);

    env.clock.t += 1;
    const results = await Promise.all([
      env.stateOf(players[0]!.playerToken),
      env.stateOf(players[1]!.playerToken),
      env.call<LiveStateResponse>({ action: "state", code: room.snapshot.code }),
      env.hostOp(room.hostToken, "state"),
    ]);
    for (const r of results) expect(r.data.snapshot.phase).toBe("reveal");
    expect(env.sent.length).toBe(before + 1);
    expect(env.sent.at(-1)!.snapshot.phase).toBe("reveal");

    // A late answer gets "too late", not a second reveal.
    expect((await env.answer(players[2]!.playerToken, 0, "Anything")).data.status).toBe("too_late");
    expect(env.sent.length).toBe(before + 1);
  });

  it("a late answer is what triggers the reveal when nobody else asked", async () => {
    const env = setup();
    const { players } = await startedRoom(env);
    const before = env.sent.length;
    env.clock.t += 60_000;
    expect((await env.answer(players[0]!.playerToken, 0, "Anything")).data.status).toBe("too_late");
    expect(env.sent.length).toBe(before + 1);
    expect(env.sent.at(-1)!.snapshot.phase).toBe("reveal");
  });

  it("revealing early closes the prompt and waits out the grace period first", async () => {
    const env = setup();
    const { room } = await startedRoom(env);
    env.clock.t += 5000;
    const { data } = await env.hostOp(room.hostToken, "reveal");
    expect(env.sleeps).toEqual([SUBMIT_GRACE_MS]);
    expect(data.snapshot.phase).toBe("reveal");
    expect(data.snapshot.question!.deadline).toBe(T0 + 5000);
  });

  it("enforces the phase order and ends with the final standings", async () => {
    const env = setup();
    const { room, players, promptIds } = await startedRoom(env, { rounds: 3 });
    expect((await env.hostOp(room.hostToken, "start")).status).toBe(409); // still answering
    expect((await env.hostOp(room.hostToken, "leaderboard")).status).toBe(409);
    for (let i = 0; i < 3; i++) {
      if (i > 0) await env.hostOp(room.hostToken, "start");
      await env.answer(players[0]!.playerToken, i, answerFor(promptIds[i]!).text);
      env.clock.t += 30_000;
      await env.hostOp(room.hostToken, "reveal");
    }
    expect((await env.hostOp(room.hostToken, "start")).data).toMatchObject({ code: "bad_phase" });
    const { data: final } = await env.hostOp(room.hostToken, "final");
    expect(final.snapshot.phase).toBe("final");
    expect(final.snapshot.leaderboard?.[0]?.nickname).toBe("Ann");
    expect(final.snapshot.teamBoard).toBeUndefined();
  });

  it("broadcasts every host action, versions increasing", async () => {
    const env = setup();
    const { room } = await startedRoom(env);
    env.clock.t += 30_000;
    await env.hostOp(room.hostToken, "reveal");
    await env.hostOp(room.hostToken, "state"); // no broadcast
    const versions = env.sent.map((s) => s.snapshot.version);
    expect(versions.length).toBe(2);
    expect(versions[1]!).toBeGreaterThan(versions[0]!);
    expect(new Set(env.sent.map((s) => s.roomId)).size).toBe(1);
  });

  it("logs rejected live answers for bank review", async () => {
    const env = setup();
    const info = vi.mocked(console.info);
    const { players, promptIds } = await startedRoom(env);
    await env.answer(players[0]!.playerToken, 0, "Definitely Not Biblical");
    const logged = info.mock.calls.map((c) => JSON.parse(String(c[0])));
    expect(logged).toContainEqual(expect.objectContaining({ event: "rejected_answer", promptId: promptIds[0], mode: "live", reason: "not_in_bank" }));
  });
});

describe("team standings", () => {
  it("appear when teams are on", async () => {
    const env = setup();
    const { room, players, promptIds } = await startedRoom(env, { teams: true });
    await env.answer(players[0]!.playerToken, 0, answerFor(promptIds[0]!).text);
    env.clock.t += 30_000;
    const { data } = await env.hostOp(room.hostToken, "reveal");
    expect(data.snapshot.teamBoard?.map((t) => t.team)).toEqual(["Ann team", "Bo team", "Cy team"]);
  });
});

describe("host tools", () => {
  it("changes settings and swaps prompts in the lobby", async () => {
    const env = setup();
    const { data: room } = await env.create({ rounds: 7 });
    const { data: s } = await env.hostOp(room.hostToken, "settings", { rounds: 9, seconds: 40, teams: true });
    expect(s.snapshot).toMatchObject({ roundCount: 9, seconds: 40, teams: true });
    // Growing the list continues the event set in order.
    expect(s.host.prompts.map((p) => p.id)).toEqual(EVENT_PROMPT_IDS.slice(0, 9));

    const { data: swapped } = await env.hostOp(room.hostToken, "swap", { index: 2 });
    expect(swapped.host.prompts[2]!.id).not.toBe(s.host.prompts[2]!.id);
    expect(new Set(swapped.host.prompts.map((p) => p.id)).size).toBe(9);
    expect(swapped.host.prompts.filter((_, i) => i !== 2).map((p) => p.id)).toEqual(s.host.prompts.filter((_, i) => i !== 2).map((p) => p.id));
  });

  it("can't swap a prompt that's already been played", async () => {
    const env = setup();
    const { room } = await startedRoom(env);
    expect((await env.hostOp(room.hostToken, "swap", { index: 0 })).status).toBe(400);
    expect((await env.hostOp(room.hostToken, "swap", { index: 1 })).status).toBe(200);
    expect((await env.hostOp(room.hostToken, "settings", { rounds: 5 })).status).toBe(409);
  });

  it("removes a player: no answering, off the boards and counts", async () => {
    const env = setup();
    const { room, players, promptIds } = await startedRoom(env);
    const text = answerFor(promptIds[0]!).text;
    await env.answer(players[2]!.playerToken, 0, text);
    const { data: kicked } = await env.hostOp(room.hostToken, "kick", { playerId: players[2]!.me.id });
    expect(kicked.snapshot.playerCount).toBe(2);
    expect(kicked.snapshot.removed).toEqual([players[2]!.me.id]);
    expect(kicked.snapshot.answeredCount).toBe(0);
    expect(kicked.host.players.find((p) => p.id === players[2]!.me.id)?.kicked).toBe(true);
    expect((await env.answer(players[2]!.playerToken, 0, text)).data).toMatchObject({ code: "kicked" });
    expect((await env.stateOf(players[2]!.playerToken)).data.me?.kicked).toBe(true);

    env.clock.t += 30_000;
    const { data } = await env.hostOp(room.hostToken, "reveal");
    expect(data.snapshot.reveal?.counts).toEqual({});
    expect(data.snapshot.leaderboard?.map((r) => r.nickname)).toEqual(["Ann", "Bo"]);

    const { data: back } = await env.hostOp(room.hostToken, "unkick", { playerId: players[2]!.me.id });
    expect(back.snapshot.leaderboard?.map((r) => r.nickname)).toContain("Cy");
  });

  it("ends the room: no joining, no answering", async () => {
    const env = setup();
    const { room, players, promptIds } = await startedRoom(env);
    const { data } = await env.hostOp(room.hostToken, "end");
    expect(data.snapshot.closed).toBe(true);
    expect((await env.join(room.snapshot.code, "Zed")).status).toBe(404);
    expect((await env.answer(players[0]!.playerToken, 0, answerFor(promptIds[0]!).text)).data).toEqual({
      status: "too_late",
      message: LIVE_MESSAGES.ended,
    });
    expect((await env.hostOp(room.hostToken, "start")).status).toBe(410);
    // Phones can still load the final state.
    expect((await env.stateOf(players[0]!.playerToken)).data.snapshot.closed).toBe(true);
  });

  it("rejects forged or swapped tokens", async () => {
    const env = setup();
    const { room, players } = await startedRoom(env);
    expect((await env.hostOp("not-a-token", "start")).status).toBe(401);
    // A player token is not a host token, and vice versa.
    expect((await env.hostOp(players[0]!.playerToken, "start")).status).toBe(401);
    expect((await env.stateOf(room.hostToken)).status).toBe(401);
  });

  it("frees a stale code after 12 hours", async () => {
    const env = setup();
    const { data: room } = await env.create();
    env.clock.t += 13 * 60 * 60 * 1000;
    expect((await env.join(room.snapshot.code, "Late")).status).toBe(404);
    expect((await env.hostOp(room.hostToken, "start")).status).toBe(410);
  });
});

describe("test bots", () => {
  it("join every room (unless turned off) and are marked as bots for the host", async () => {
    const env = setup({ bots: 2 });
    const { data } = await env.create();
    expect(data.snapshot.playerCount).toBe(2);
    expect(data.snapshot.players?.map((p) => p.nickname)).toEqual([...BOT_NAMES]);
    expect(data.host.players.every((p) => p.bot)).toBe(true);
    expect((await env.create({ bots: false })).data.snapshot.playerCount).toBe(0);
  });

  it("lock a random answer the instant a prompt opens, and score at the reveal", async () => {
    const env = setup({ bots: 2 });
    const { data: room } = await env.create({ seconds: 30 });
    const ann = (await env.join(room.snapshot.code, "Ann")).data;
    const { data: started } = await env.hostOp(room.hostToken, "start");
    expect(started.host.players.find((p) => p.nickname === "Ann")!.bot).toBeUndefined();

    const roomId = (await env.store.findOpenRoom(room.snapshot.code, env.clock.t))!.id;
    const subs = await env.store.listSubmissions(roomId);
    expect(subs.length).toBeGreaterThan(0);
    for (const s of subs) expect(s.ms).toBe(0); // locked as the prompt opens…
    expect(started.snapshot.answeredCount).toBe(subs.length); // …and shown as locked in straight away

    env.clock.t += 30_000;
    expect((await env.stateOf(ann.playerToken)).data.snapshot.answeredCount).toBe(subs.length);
    const { data: revealed } = await env.hostOp(room.hostToken, "reveal");
    expect(revealed.snapshot.reveal!.answered).toBe(subs.length);
    const botRows = revealed.snapshot.leaderboard!.filter((r) => r.nickname.startsWith("Bot "));
    expect(botRows).toHaveLength(2);
    for (const s of subs) expect(botRows.find((r) => r.id === s.playerId)!.total).toBe(s.points);
  });

  it("don't hold the timer open: it closes once every real player has answered", async () => {
    const env = setup({ bots: 2 });
    const { data: room } = await env.create();
    const ann = (await env.join(room.snapshot.code, "Ann")).data;
    const { data: started } = await env.hostOp(room.hostToken, "start");
    env.clock.t += 1000;
    await env.answer(ann.playerToken, 0, answerFor(started.host.prompts[0]!.id).text);
    expect(env.sent.at(-1)!.snapshot.question!.deadline).toBe(env.clock.t);
  });

  it("pick right answers across many tiers, and sometimes miss", () => {
    const prompt = getPrompt("foreign-rulers")!;
    let seed = 11;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const picks = Array.from({ length: 400 }, () => botPick(prompt, random));
    const misses = picks.filter((p) => p === null).length;
    expect(misses).toBeGreaterThan(20);
    expect(misses).toBeLessThan(120);
    const tiers = new Set(picks.filter((p) => p !== null).map((p) => p!.tier));
    expect(tiers.size).toBe(new Set(prompt.answers.map((a) => a.tier)).size);
    for (const p of picks) if (p) expect(prompt.answers).toContain(p);
  });

  it("visibleSubs hides a bot's answer until its time, but only during the open prompt", () => {
    const players = [{ id: "b", roomId: "r", nickname: "Bot", nameKey: "bot", team: null, kicked: false, joinedAt: 0, bot: true }];
    const sub = { roomId: "r", roundIndex: 0, playerId: "b", raw: "x", canonical: "x", tier: "rare" as const, points: 60, ms: 5000, ai: false, reference: null };
    expect(visibleSubs([sub], players, { phase: "question", roundIndex: 0, openedAt: 1000 }, 3000)).toEqual([]);
    expect(visibleSubs([sub], players, { phase: "question", roundIndex: 0, openedAt: 1000 }, 6000)).toHaveLength(1);
    expect(visibleSubs([sub], players, { phase: "reveal", roundIndex: 0, openedAt: 1000 }, 3000)).toHaveLength(1);
  });
});

describe("host answer list and re-tiering", () => {
  it("shows every answer for a prompt to the host only, grouped by this room's tiers", async () => {
    const env = setup();
    const { data: room } = await env.create();
    const { data } = await env.hostOp(room.hostToken, "answers", { index: 1 });
    const prompt = getPrompt(EVENT_PROMPT_IDS[1]!)!;
    expect(data.host.answers).toMatchObject({ index: 1, promptId: prompt.id, prompt: prompt.prompt });
    expect(data.host.answers!.answers).toHaveLength(prompt.answers.length);
    expect(leaksAnswers(data.snapshot)).toBe(false);
    // Reading answers is not an action: nothing is broadcast.
    expect(env.sent).toHaveLength(0);
    expect((await env.hostOp(room.hostToken, "answers", { index: 99 })).status).toBe(400);
  });

  it("moving an answer to another tier changes its points, the reveal and the leaderboard, even after answering", async () => {
    const env = setup();
    const { room, players, promptIds } = await startedRoom(env);
    const easy = answerFor(promptIds[0]!, "plankton");
    await env.answer(players[0]!.playerToken, 0, easy.text);

    const { data: moved } = await env.hostOp(room.hostToken, "retier", { index: 0, canonical: easy.text, tier: "deep_cut" });
    const row = moved.host.answers!.answers.find((a) => a.canonical === easy.text)!;
    expect(row).toMatchObject({ tier: "deep_cut", baseTier: "plankton", points: pointsForTier("deep_cut"), count: 1 });
    // Players and the projector never get the list mid-prompt.
    expect(leaksAnswers(env.sent.at(-1)!.snapshot)).toBe(false);

    env.clock.t += 30_000;
    const { data: revealed } = await env.hostOp(room.hostToken, "reveal");
    const shown = revealed.snapshot.reveal!.reveal.answers.find((a) => a.canonical === easy.text)!;
    expect(shown).toMatchObject({ tier: "deep_cut", points: pointsForTier("deep_cut") });
    expect(revealed.snapshot.reveal!.finders[easy.text]).toEqual(["Ann"]);
    expect(revealed.snapshot.leaderboard![0]).toMatchObject({ nickname: "Ann", total: pointsForTier("deep_cut") });

    // Moving it back to its bank tier removes the override.
    const { data: back } = await env.hostOp(room.hostToken, "retier", { index: 0, canonical: easy.text, tier: "plankton" });
    expect(back.snapshot.leaderboard![0]).toMatchObject({ nickname: "Ann", total: easy.points });
    expect((await env.store.getRoom((await env.store.findOpenRoom(room.snapshot.code, env.clock.t))!.id))!.tierOverrides).toEqual({});
  });

  it("answers given after a move score at the new tier", async () => {
    const env = setup();
    const { room, players, promptIds } = await startedRoom(env);
    const easy = answerFor(promptIds[0]!, "plankton");
    await env.hostOp(room.hostToken, "retier", { index: 0, canonical: easy.text, tier: "rare" });
    await env.answer(players[1]!.playerToken, 0, easy.text);
    env.clock.t += 30_000;
    const { data } = await env.hostOp(room.hostToken, "reveal");
    expect(data.snapshot.leaderboard!.find((r) => r.nickname === "Bo")!.total).toBe(pointsForTier("rare"));
  });

  it("a move is permanent: saved to the shared tier list and used by the next room", async () => {
    const tiers = new MemoryTierStore();
    const env = setup({ tiers });
    const first = await startedRoom(env);
    const easy = answerFor(first.promptIds[0]!, "plankton");
    await env.hostOp(first.room.hostToken, "retier", { index: 0, canonical: easy.text, tier: "rare" });
    expect(await tiers.all()).toEqual({ [first.promptIds[0]!]: { [easy.text]: "rare" } });
    await env.hostOp(first.room.hostToken, "end");

    // A brand-new room (same prompt list) scores it at the new tier from the start.
    const second = await startedRoom(env);
    expect(second.promptIds[0]).toBe(first.promptIds[0]);
    const { data: listed } = await env.hostOp(second.room.hostToken, "answers", { index: 0 });
    expect(listed.host.answers!.answers.find((a) => a.canonical === easy.text)).toMatchObject({ tier: "rare", baseTier: "plankton" });
    await env.answer(second.players[0]!.playerToken, 0, easy.text);
    env.clock.t += 30_000;
    const { data } = await env.hostOp(second.room.hostToken, "reveal");
    expect(data.snapshot.leaderboard![0]).toMatchObject({ nickname: "Ann", total: pointsForTier("rare") });

    // Moving it back to the bank's tier clears the saved change.
    await env.hostOp(second.room.hostToken, "retier", { index: 0, canonical: easy.text, tier: "plankton" });
    expect(await tiers.all()).toEqual({});
  });

  it("rejects unknown answers and tiers", async () => {
    const env = setup();
    const { data: room } = await env.create();
    expect((await env.hostOp(room.hostToken, "retier", { index: 0, canonical: "Nobody at all", tier: "rare" })).status).toBe(404);
    expect((await env.hostOp(room.hostToken, "retier", { index: 0, canonical: "x", tier: "legendary" })).status).toBe(400);
  });
});

describe("teams", () => {
  it("players make or join teams; matching names join the same team; the snapshot lists them", async () => {
    const env = setup();
    const { data: room } = await env.create({ teams: true });
    await env.join(room.snapshot.code, "Ann", "Table 4");
    const { data: bo } = await env.join(room.snapshot.code, "Bo", "table 4 ");
    expect(bo.me.team).toBe("Table 4");
    const { data: cy } = await env.join(room.snapshot.code, "Cy", "Fishers");
    expect(cy.snapshot.teamNames).toEqual(["Fishers", "Table 4"]);
  });

  it("bots play as their own team in team rooms", async () => {
    const env = setup({ bots: 2 });
    const { data: room } = await env.create({ teams: true });
    expect(room.host.players.filter((p) => p.bot).map((p) => p.team)).toEqual(["Bots", "Bots"]);
  });

  it("the host can move a player to another team, a new team, or none, and the team board follows", async () => {
    const env = setup();
    const { room, players, promptIds } = await startedRoom(env, { teams: true });
    const ann = players[0]!;
    const easy = answerFor(promptIds[0]!, "plankton");
    await env.answer(ann.playerToken, 0, easy.text);

    await env.hostOp(room.hostToken, "team", { playerId: ann.me.id, team: "Bo team" });
    const { data: moved } = await env.hostOp(room.hostToken, "team", { playerId: players[2]!.me.id, team: "Brand New" });
    expect(moved.host.players.find((p) => p.id === ann.me.id)!.team).toBe("Bo team");
    expect(moved.snapshot.teamNames).toEqual(["Bo team", "Brand New"]);

    env.clock.t += 30_000;
    const { data } = await env.hostOp(room.hostToken, "reveal");
    const bo = data.snapshot.teamBoard!.find((t) => t.team === "Bo team")!;
    expect(bo.members).toBe(2);
    expect(bo.total).toBe(easy.points);

    const { data: none } = await env.hostOp(room.hostToken, "team", { playerId: ann.me.id, team: null });
    expect(none.host.players.find((p) => p.id === ann.me.id)!.team).toBeNull();
    expect((await env.hostOp(room.hostToken, "team", { playerId: "nobody", team: "X" })).status).toBe(404);
  });
});


describe("projector view after a reveal", () => {
  it("starts on the climb; the host switches to the answers, the leaderboard, and back", async () => {
    const env = setup();
    const { room } = await startedRoom(env);
    env.clock.t += 30_000;
    const { data: revealed } = await env.hostOp(room.hostToken, "reveal");
    expect(revealed.snapshot.view).toBe("climb");

    const { data: answers } = await env.hostOp(room.hostToken, "view", { view: "answers" });
    expect(answers.snapshot).toMatchObject({ phase: "reveal", view: "answers" });
    expect(answers.snapshot.reveal).toBeDefined();

    const { data: board } = await env.hostOp(room.hostToken, "leaderboard");
    expect(board.snapshot.phase).toBe("leaderboard");
    expect(board.snapshot.view).toBeUndefined();

    const { data: back } = await env.hostOp(room.hostToken, "view", { view: "climb" });
    expect(back.snapshot).toMatchObject({ phase: "reveal", view: "climb" });
    expect(back.snapshot.reveal!.reveal.answers.length).toBeGreaterThan(0);

    // The next reveal starts on the climb again.
    await env.hostOp(room.hostToken, "view", { view: "answers" });
    await env.hostOp(room.hostToken, "start");
    env.clock.t += 30_000;
    expect((await env.hostOp(room.hostToken, "reveal")).data.snapshot.view).toBe("climb");
  });

  it("only works after a reveal, with a known view", async () => {
    const env = setup();
    const { room } = await startedRoom(env);
    expect((await env.hostOp(room.hostToken, "view", { view: "answers" })).status).toBe(409);
    env.clock.t += 30_000;
    await env.hostOp(room.hostToken, "reveal");
    expect((await env.hostOp(room.hostToken, "view", { view: "podium" })).status).toBe(400);
  });
});
