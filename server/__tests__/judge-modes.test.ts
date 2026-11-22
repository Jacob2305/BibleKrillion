/** The AI judge inside each game mode, plus host review and merging approved answers into the bank. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnswerResponse, DailyFinishResponse, DiveStartResponse, PromptBeginResponse } from "../../lib/game/api-types";
import { validateBank, type Bank } from "../../lib/game/bank";
import type { LiveAnswerResponse, LiveHostResponse, LiveJoinResponse } from "../../lib/game/live-types";
import { mergeApproved } from "../../scripts/merge-lib";
import { allPrompts, getPrompt } from "../bank";
import { createDailyHandler } from "../daily";
import { dailyPromptIds, dayKey } from "../daily-schedule";
import { MemoryDailyStore } from "../daily-store";
import type { JudgeClient, JudgeDeps, Verdict } from "../judge";
import { MemoryJudgeStore } from "../judge-store";
import { createLiveHandler } from "../live";
import type { Broadcaster } from "../live-broadcast";
import { MemoryLiveStore } from "../live-store";
import { createPracticeHandler } from "../practice";
import { createReviewHandler } from "../review";
import { signToken } from "../tokens";

const T0 = Date.parse("2026-11-20T20:00:00Z");
const AI_ANSWER = "Zz Testperson";
const VALID: Verdict = { valid: true, canonical: AI_ANSWER, reference: "Genesis 1:1", reason: "Test verdict." };

function judgeDeps(clock: { t: number }, verdict: (answer: string) => Verdict | Promise<Verdict> = () => VALID) {
  const store = new MemoryJudgeStore();
  const calls: string[] = [];
  const client: JudgeClient = {
    judge: async ({ answer }) => {
      calls.push(answer);
      return verdict(answer);
    },
  };
  const deps: JudgeDeps = {
    config: () => ({ enabled: true, model: "test-model", perPrompt: 3, perDay: 1000 }),
    store: () => store,
    client: () => client,
    now: () => clock.t,
  };
  return { deps, store, calls };
}

const bankAnswer = (promptId: string) => getPrompt(promptId)!.answers.find((a) => !a.generic_for)!.canonical;

async function call<T>(handler: (r: Request) => Promise<Response>, body: unknown): Promise<{ status: number; data: T }> {
  const res = await handler(new Request("http://test/api", { method: "POST", body: JSON.stringify(body) }));
  return { status: res.status, data: (await res.json()) as T };
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.HOST_PIN;
  delete process.env.VERCEL_ENV;
});

describe("Practice", () => {
  const open = allPrompts().find((p) => !p.closed_set)!;
  const closed = allPrompts().find((p) => p.closed_set)!;

  it("accepts an AI-judged answer at Deep Cut, flagged", async () => {
    const clock = { t: T0 };
    const judge = judgeDeps(clock);
    const handler = createPracticeHandler({ now: () => clock.t, random: Math.random, judge: judge.deps });
    const promptToken = signToken({ k: "practice-prompt", pid: open.id, i: 0, dl: T0 + 25_000 });
    const { data } = await call<AnswerResponse>(handler, { action: "answer", promptToken, text: "zz testperson" });
    expect(data).toMatchObject({ status: "accepted", answer: { canonical: AI_ANSWER, tier: "deep_cut", points: 85, reference: "Genesis 1:1", aiJudged: true } });
  });

  it("never asks the AI about closed-set prompts", async () => {
    const clock = { t: T0 };
    const judge = judgeDeps(clock);
    const handler = createPracticeHandler({ now: () => clock.t, random: Math.random, judge: judge.deps });
    const promptToken = signToken({ k: "practice-prompt", pid: closed.id, i: 0, dl: T0 + 25_000 });
    expect((await call<AnswerResponse>(handler, { action: "answer", promptToken, text: "zz testperson" })).data.status).toBe("rejected");
    expect(judge.calls).toEqual([]);
  });

  it("works with no key at all (judge off)", async () => {
    const clock = { t: T0 };
    const handler = createPracticeHandler({ now: () => clock.t, random: Math.random });
    const promptToken = signToken({ k: "practice-prompt", pid: open.id, i: 0, dl: T0 + 25_000 });
    expect((await call<AnswerResponse>(handler, { action: "answer", promptToken, text: "zz testperson" })).data.status).toBe("rejected");
  });
});

describe("Daily", () => {
  it("saves an AI answer in the round, shows it on resume and in the results", async () => {
    const clock = { t: T0 };
    const judge = judgeDeps(clock);
    const store = new MemoryDailyStore();
    const handler = createDailyHandler({ now: () => clock.t, store: () => store, judge: judge.deps });
    const ids = dailyPromptIds(dayKey(T0));
    const aiIndex = ids.findIndex((id) => !getPrompt(id)!.closed_set);
    expect(aiIndex).toBeGreaterThanOrEqual(0);

    const { data: start } = await call<DiveStartResponse>(handler, { action: "start", deviceId: "device-judge-01", nickname: "Jo" });
    for (let i = 0; i < ids.length; i++) {
      const { data: b } = await call<PromptBeginResponse>(handler, { action: "begin", dive: start.dive, index: i });
      const text = i === aiIndex ? "zz testperson" : bankAnswer(ids[i]!);
      const { data: a } = await call<AnswerResponse>(handler, { action: "answer", promptToken: b.promptToken, text });
      expect(a.status).toBe("accepted");
      if (i === aiIndex) expect(a).toMatchObject({ answer: { canonical: AI_ANSWER, points: 85, aiJudged: true } });
      clock.t += 1000;
    }
    const { data: resumed } = await call<DiveStartResponse>(handler, { action: "start", deviceId: "device-judge-01", nickname: "Jo" });
    expect(resumed.completed![aiIndex]!.answer).toMatchObject({ canonical: AI_ANSWER, aiJudged: true });

    const { data: fin } = await call<DailyFinishResponse>(handler, { action: "finish", dive: start.dive });
    expect(fin.rounds[aiIndex]).toMatchObject({ tier: "deep_cut", answer: { canonical: AI_ANSWER } });
    expect(fin.distribution[aiIndex]!.answers).toContainEqual(expect.objectContaining({ canonical: AI_ANSWER, tier: "deep_cut", count: 1 }));
  });
});

describe("Live rooms", () => {
  async function liveSetup(verdict?: (answer: string) => Verdict | Promise<Verdict>) {
    const clock = { t: T0 };
    const judge = judgeDeps(clock, verdict);
    const store = new MemoryLiveStore();
    const broadcaster: Broadcaster = { realtimeFor: () => null, send: async () => {} };
    const handler = createLiveHandler({ now: () => clock.t, random: Math.random, store: () => store, broadcaster: () => broadcaster, sleep: async (ms) => void (clock.t += ms), judge: judge.deps });
    let { data: room } = await call<LiveHostResponse>(handler, { action: "create" });
    // Make sure prompt 1 is open-ended (the judge never runs on closed sets).
    while (getPrompt(room.host.prompts[0]!.id)!.closed_set) {
      room = (await call<LiveHostResponse>(handler, { action: "host", hostToken: room.hostToken, op: "swap", index: 0 })).data;
    }
    const ann = (await call<LiveJoinResponse>(handler, { action: "join", code: room.snapshot.code, nickname: "Ann" })).data;
    const bo = (await call<LiveJoinResponse>(handler, { action: "join", code: room.snapshot.code, nickname: "Bo" })).data;
    await call(handler, { action: "host", hostToken: room.hostToken, op: "start" });
    const host = (op: string, extra: Record<string, unknown> = {}) => call<LiveHostResponse>(handler, { action: "host", hostToken: room.hostToken, op, ...extra });
    const answer = (token: string, text: string) => call<LiveAnswerResponse>(handler, { action: "answer", playerToken: token, index: 0, text });
    return { clock, judge, store, room, ann, bo, host, answer };
  }

  it("locks an AI answer, shows it at the reveal with the host's review panel", async () => {
    const env = await liveSetup();
    expect((await env.answer(env.ann.playerToken, "zz testperson")).data).toEqual({ status: "locked", index: 0, canonical: AI_ANSWER });
    env.clock.t += 60_000;
    const { data } = await env.host("reveal");
    expect(data.snapshot.reveal!.reveal.answers).toContainEqual(expect.objectContaining({ canonical: AI_ANSWER, tier: "deep_cut", aiJudged: true }));
    expect(data.snapshot.reveal!.counts[AI_ANSWER]).toBe(1);
    expect(data.snapshot.leaderboard![0]).toMatchObject({ nickname: "Ann", total: 85 });
    expect(data.host.aiAnswers).toEqual([expect.objectContaining({ roundIndex: 0, canonical: AI_ANSWER, count: 1, status: "auto" })]);

    const { data: approved } = await env.host("ai_approve", { roundIndex: 0, canonical: AI_ANSWER });
    expect(approved.host.aiAnswers[0]!.status).toBe("approved");
    expect(approved.snapshot.leaderboard![0]!.total).toBe(85);
  });

  it("a host rejecting an AI answer takes the points away in the room", async () => {
    const env = await liveSetup();
    await env.answer(env.ann.playerToken, "zz testperson");
    env.clock.t += 60_000;
    await env.host("reveal");
    const { data } = await env.host("ai_reject", { roundIndex: 0, canonical: AI_ANSWER });
    expect(data.snapshot.leaderboard!.find((r) => r.nickname === "Ann")!.total).toBe(0);
    expect(data.snapshot.reveal!.counts[AI_ANSWER]).toBeUndefined();
    expect(data.host.aiAnswers).toEqual([]);
    expect((await env.judge.store.listAccepted())[0]!.status).toBe("rejected");
  });

  it("if the host reveals while the judge is thinking, the late answer doesn't sneak in", async () => {
    let env!: Awaited<ReturnType<typeof liveSetup>>;
    env = await liveSetup(async () => {
      const room = (await env.store.findOpenRoom(env.room.snapshot.code, env.clock.t))!;
      await env.store.updateRoom(room.id, room.version, { phase: "reveal" });
      return VALID;
    });
    const { data } = await env.answer(env.ann.playerToken, "zz testperson");
    expect(data).toMatchObject({ status: "too_late" });
    expect((await env.host("state")).data.host.aiAnswers).toEqual([]);
  });
});

describe("Host review page", () => {
  async function reviewSetup() {
    const clock = { t: T0 };
    const judge = judgeDeps(clock);
    const open = allPrompts().find((p) => !p.closed_set)!;
    for (const raw of ["zz testperson", "Zz  Test-person"]) {
      await (await import("../judge")).judgeUnlisted({ prompt: open, raw, callerKey: raw }, judge.deps);
    }
    return { handler: createReviewHandler(judge.deps), judge, open };
  }

  it("needs the PIN when one is set, and groups spellings of one answer", async () => {
    process.env.HOST_PIN = "2468";
    const { handler, open } = await reviewSetup();
    expect((await call(handler, { action: "list" })).status).toBe(401);
    expect((await call(handler, { action: "list", pin: "0000" })).status).toBe(401);
    const { data } = await call<{ items: { canonical: string; variants: string[]; status: string; promptId: string }[] }>(handler, { action: "list", pin: "2468" });
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({ canonical: AI_ANSWER, status: "auto", promptId: open.id });
    expect(data.items[0]!.variants.sort()).toEqual(["Zz  Test-person", "zz testperson"].sort());
  });

  it("approves or rejects every spelling at once", async () => {
    const { handler, judge, open } = await reviewSetup();
    const { data } = await call<{ changed: number }>(handler, { action: "review", promptId: open.id, canonical: AI_ANSWER, decision: "approve" });
    expect(data.changed).toBe(2);
    expect((await judge.store.listAccepted()).every((v) => v.status === "approved")).toBe(true);
    expect((await call(handler, { action: "review", promptId: open.id, canonical: "Nobody", decision: "reject" })).status).toBe(404);
  });

  it("refuses to run without a PIN on a real deployment", async () => {
    process.env.VERCEL_ENV = "production";
    const { handler } = await reviewSetup();
    expect((await call(handler, { action: "list" })).data).toMatchObject({ code: "no_pin" });
  });
});

describe("merge-approved", () => {
  const bank = structuredClone(allPrompts()) as Bank;
  const open = bank.find((p) => !p.closed_set)!;
  const closed = bank.find((p) => p.closed_set)!;
  const listed = open.answers.find((a) => !a.generic_for)!;

  it("adds approved answers as Deep Cut, needs_review, with useful spellings as aliases", () => {
    const result = mergeApproved(
      bank,
      [
        { promptId: open.id, canonical: AI_ANSWER, reference: "Genesis 1:1", reason: "Test.", variants: ["zz testperson", "Zz Test Person", listed.canonical] },
        { promptId: open.id, canonical: listed.canonical, reference: listed.reference, reason: "", variants: [] },
        { promptId: closed.id, canonical: "Something", reference: "Genesis 1:1", reason: "", variants: [] },
        { promptId: "gone", canonical: "X", reference: "Genesis 1:1", reason: "", variants: [] },
      ],
      "2026-11-20",
    );
    expect(result.added).toHaveLength(1);
    expect(result.added[0]!.answer).toMatchObject({ canonical: AI_ANSWER, tier: "deep_cut", reference: "Genesis 1:1", needs_review: true, aliases: ["Zz Test Person"] });
    expect(result.added[0]!.answer.review_note).toMatch(/host-approved 2026-11-20/);
    expect(result.alreadyPresent.map((a) => a.canonical)).toEqual([listed.canonical]);
    expect(result.skipped.map((s) => s.item.promptId)).toEqual([closed.id, "gone"]);
    expect(validateBank(result.bank).errors).toEqual([]);
    // The original bank is untouched.
    expect(bank.find((p) => p.id === open.id)!.answers.some((a) => a.canonical === AI_ANSWER)).toBe(false);
  });

  it("won't add near-duplicates of an existing answer", () => {
    const typo = listed.canonical.length > 5 ? listed.canonical.slice(0, -1) + "x" : listed.canonical + "x";
    const result = mergeApproved(bank, [{ promptId: open.id, canonical: typo, reference: "Genesis 1:1", reason: "", variants: [] }], "2026-11-20");
    expect(result.added).toHaveLength(0);
    expect(result.skipped[0]!.why).toMatch(/too close/);
  });
});
