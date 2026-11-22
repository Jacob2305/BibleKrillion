import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnswerResponse, DailyFinishResponse, DiveStartResponse, PromptBeginResponse } from "../../lib/game/api-types";
import { allPrompts, getPrompt, matchPrompt } from "../bank";
import { SUBMIT_GRACE_MS } from "../config";
import { DAILY_MESSAGES, cleanNickname, createDailyHandler } from "../daily";
import { NO_REPEAT_DAYS, SCHEDULE_EPOCH, dailyPromptIds, dayKey, seededRandom } from "../daily-schedule";
import { MemoryDailyStore } from "../daily-store";

// 2026-11-20 15:00 New York (EST, UTC-5)
const T0 = Date.parse("2026-11-20T20:00:00Z");

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

function setup() {
  const clock = { t: T0 };
  const store = new MemoryDailyStore();
  const handler = createDailyHandler({ now: () => clock.t, store: () => store });
  async function call<T = unknown>(body: unknown): Promise<{ status: number; data: T }> {
    const res = await handler(new Request("http://test/api/daily", { method: "POST", body: JSON.stringify(body) }));
    return { status: res.status, data: (await res.json()) as T };
  }
  const startAs = (deviceId = "device-aaaa-1111", nickname = "Jo") => call<DiveStartResponse>({ action: "start", deviceId, nickname });
  const beginAt = (dive: string, index: number) => call<PromptBeginResponse>({ action: "begin", dive, index });
  const answer = (promptToken: string, text: string) => call<AnswerResponse>({ action: "answer", promptToken, text });
  return { clock, store, call, startAs, beginAt, answer };
}

/** An answer of the given tier for a prompt (or any answer). */
function answerFor(promptId: string, tier?: string): string {
  const p = getPrompt(promptId)!;
  return (p.answers.find((a) => a.tier === tier && !a.generic_for) ?? p.answers.find((a) => !a.generic_for)!).canonical;
}

/** Plays a whole dive: accepted answers everywhere except `missAt`. */
async function playDive(env: ReturnType<typeof setup>, deviceId: string, opts: { missAt?: number; tier?: string } = {}) {
  const { data: start } = await env.startAs(deviceId, `Diver ${deviceId.slice(-4)}`);
  const ids = dailyPromptIds(start.day!);
  for (let i = 0; i < start.count; i++) {
    const { data: b } = await env.beginAt(start.dive, i);
    if (i === opts.missAt) {
      env.clock.t = b.deadline + 1;
      await env.call({ action: "reveal", promptToken: b.promptToken });
    } else {
      const res = await env.answer(b.promptToken, answerFor(ids[i]!, opts.tier));
      expect(res.data.status).toBe("accepted");
    }
    env.clock.t += 1000;
  }
  return start;
}

beforeEach(() => vi.spyOn(console, "info").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe("daily schedule", () => {
  it("uses the New York calendar day, resetting at local midnight", () => {
    expect(dayKey(Date.parse("2026-11-20T04:59:59Z"))).toBe("2026-11-19"); // 11:59 PM EST
    expect(dayKey(Date.parse("2026-11-20T05:00:00Z"))).toBe("2026-11-20"); // midnight EST
    expect(dayKey(Date.parse("2026-07-04T03:59:59Z"))).toBe("2026-07-03"); // 11:59 PM EDT
    expect(dayKey(Date.parse("2026-07-04T04:00:00Z"))).toBe("2026-07-04"); // midnight EDT
  });

  it("is deterministic and gives 7 distinct prompts", () => {
    for (const day of ["2025-06-01", "2026-11-01", "2026-11-20", "2027-02-14", "2028-12-25"]) {
      const ids = dailyPromptIds(day);
      expect(dailyPromptIds(day)).toEqual(ids);
      expect(new Set(ids).size).toBe(7);
    }
  });

  it("mixes categories: at least 5 different ones every day, 7 on most days", () => {
    let allSeven = 0;
    for (let d = 0; d < 365; d++) {
      const day = new Date(Date.parse(`${SCHEDULE_EPOCH}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
      const cats = new Set(dailyPromptIds(day).map((id) => getPrompt(id)!.category)).size;
      expect(cats).toBeGreaterThanOrEqual(5);
      if (cats === 7) allSeven++;
    }
    expect(allSeven).toBeGreaterThan(365 * 0.6);
  });

  it("orders each day easy → hard", () => {
    const rank = { easy: 0, medium: 1, hard: 2 } as const;
    const ranks = dailyPromptIds("2026-12-03").map((id) => rank[getPrompt(id)!.difficulty ?? "medium"]);
    expect([...ranks].sort()).toEqual(ranks);
  });

  it(`never repeats a prompt within ${NO_REPEAT_DAYS} consecutive days`, () => {
    const start = Date.parse(`${SCHEDULE_EPOCH}T00:00:00Z`);
    for (let d = 0; d < 365; d++) {
      const window = new Set<string>();
      let total = 0;
      for (let k = 0; k < NO_REPEAT_DAYS; k++) {
        const day = new Date(start + (d + k) * 86_400_000).toISOString().slice(0, 10);
        for (const id of dailyPromptIds(day)) window.add(id);
        total += 7;
      }
      expect(window.size).toBe(total);
    }
  });

  it("uses every prompt in the bank over a few weeks", () => {
    const used = new Set<string>();
    for (let d = 0; d < 21; d++) {
      const day = new Date(Date.parse("2026-11-01T00:00:00Z") + d * 86_400_000).toISOString().slice(0, 10);
      dailyPromptIds(day).forEach((id) => used.add(id));
    }
    expect(used.size).toBe(allPrompts().length);
  });

  it("seeded random is stable", () => {
    const a = seededRandom("x");
    const b = seededRandom("x");
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("daily: start", () => {
  it("gives every device the same prompts today", async () => {
    const env = setup();
    const a = await env.startAs("device-aaaa-1111");
    const b = await env.startAs("device-bbbb-2222");
    const pa = await env.beginAt(a.data.dive, 0);
    const pb = await env.beginAt(b.data.dive, 0);
    expect(a.data).toMatchObject({ day: "2026-11-20", count: 7, completed: [], finished: false });
    expect(pa.data.prompt.id).toBe(pb.data.prompt.id);
    expect(pa.data.prompt.id).toBe(dailyPromptIds("2026-11-20")[0]);
  });

  it("asks to confirm a corrected spelling before locking the round", async () => {
    const env = setup();
    const { data: start } = await env.startAs("device-typo-1111");
    let found: { i: number; typo: string; canonical: string } | null = null;
    for (let i = 0; i < 7 && !found; i++) {
      try {
        found = { i, ...typoFor(dailyPromptIds(start.day!)[i]!) };
      } catch {
        /* this prompt has no simple one-word answer; try the next */
      }
    }
    const { data: b } = await env.beginAt(start.dive, found!.i);
    expect((await env.answer(b.promptToken, found!.typo)).data).toEqual({ status: "confirm", suggestion: found!.canonical });
    // Not locked: a different answer still counts...
    const confirmed = await env.call<AnswerResponse>({ action: "answer", promptToken: b.promptToken, text: found!.typo, confirm: true });
    expect(confirmed.data).toMatchObject({ status: "accepted", answer: { canonical: found!.canonical } });
  });

  it("validates device id and nickname", async () => {
    const env = setup();
    expect((await env.call({ action: "start", deviceId: "x", nickname: "Jo" })).status).toBe(400);
    expect((await env.call({ action: "start", deviceId: "device-aaaa-1111", nickname: "   " })).status).toBe(400);
    expect(cleanNickname("  Mary\u0000  Ann  ")).toBe("Mary Ann");
    expect(cleanNickname("x".repeat(40))).toHaveLength(24);
  });

  it("resumes the same attempt on the same device (refresh)", async () => {
    const env = setup();
    const first = await env.startAs();
    const b = await env.beginAt(first.data.dive, 0);
    await env.answer(b.data.promptToken, answerFor(b.data.prompt.id));
    const again = await env.startAs();
    expect(again.data.completed).toHaveLength(1);
    expect(again.data.completed![0]!.prompt.id).toBe(b.data.prompt.id);
  });
});

describe("daily: one shot per prompt", () => {
  it("re-beginning a prompt keeps the original deadline (no fresh clock)", async () => {
    const env = setup();
    const { data: s } = await env.startAs();
    const first = await env.beginAt(s.dive, 0);
    env.clock.t += 20_000;
    const again = await env.beginAt(s.dive, 0);
    expect(again.data.deadline).toBe(first.data.deadline);
  });

  it("can't skip ahead, and can't replay a finished prompt after seeing its answers", async () => {
    const env = setup();
    const { data: s } = await env.startAs();
    expect((await env.beginAt(s.dive, 1)).status).toBe(409);
    const b0 = await env.beginAt(s.dive, 0);
    env.clock.t = b0.data.deadline + 1;
    const rev = await env.call<{ reveal: unknown }>({ action: "reveal", promptToken: b0.data.promptToken });
    expect(rev.status).toBe(200);
    expect((await env.beginAt(s.dive, 0)).status).toBe(409);
    const late = await env.answer(b0.data.promptToken, answerFor(b0.data.prompt.id, "one_in_a_million"));
    expect(late.data.status).toBe("too_late");
  });

  it("locks the first accepted answer", async () => {
    const env = setup();
    const { data: s } = await env.startAs();
    const b = await env.beginAt(s.dive, 0);
    const id = b.data.prompt.id;
    const first = await env.answer(b.data.promptToken, answerFor(id, "plankton"));
    const second = await env.answer(b.data.promptToken, answerFor(id, "one_in_a_million"));
    expect(first.data).toMatchObject({ status: "accepted", answer: { tier: "plankton" } });
    expect(second.data).toMatchObject({ status: "accepted", answer: { tier: "plankton" } });
  });

  it("rejections don't lock, and keep the answers hidden", async () => {
    const env = setup();
    const { data: s } = await env.startAs();
    const b = await env.beginAt(s.dive, 0);
    expect((await env.answer(b.data.promptToken, "qqqq zzzz")).data).toEqual({ status: "rejected", message: DAILY_MESSAGES.rejected });
    expect((await env.answer(b.data.promptToken, answerFor(b.data.prompt.id))).data.status).toBe("accepted");
  });

  it("counts answers within the grace window, not after", async () => {
    const env = setup();
    const { data: s } = await env.startAs();
    const b = await env.beginAt(s.dive, 0);
    env.clock.t = b.data.deadline + SUBMIT_GRACE_MS;
    expect((await env.answer(b.data.promptToken, answerFor(b.data.prompt.id))).data.status).toBe("accepted");

    const env2 = setup();
    const { data: s2 } = await env2.startAs();
    const b2 = await env2.beginAt(s2.dive, 0);
    env2.clock.t = b2.data.deadline + SUBMIT_GRACE_MS + 1;
    expect((await env2.answer(b2.data.promptToken, answerFor(b2.data.prompt.id))).data.status).toBe("too_late");
  });

  it("refuses an early reveal", async () => {
    const env = setup();
    const { data: s } = await env.startAs();
    const b = await env.beginAt(s.dive, 0);
    expect((await env.call({ action: "reveal", promptToken: b.data.promptToken })).status).toBe(403);
  });
});

describe("daily: finish", () => {
  it("refuses to finish early", async () => {
    const env = setup();
    const { data: s } = await env.startAs();
    expect((await env.call({ action: "finish", dive: s.dive })).status).toBe(409);
  });

  it("scores from server-side records, then reports standing and distribution", async () => {
    const env = setup();
    await playDive(env, "device-aaaa-1111", { tier: "plankton" });
    await playDive(env, "device-bbbb-2222", { tier: "plankton", missAt: 2 });
    const me = await playDive(env, "device-cccc-3333", { tier: "one_in_a_million" });
    const { status, data } = await env.call<DailyFinishResponse>({ action: "finish", dive: me.dive });
    expect(status).toBe(200);
    expect(data.total).toBe(700);
    expect(data.rating).toBe("one_in_a_million");
    expect(data.rounds.map((r) => r.tier)).toEqual(Array(7).fill("one_in_a_million"));
    // The first two finish lazily here too, so count only finished ones: only "me" finished via API so far.
    expect(data.players).toBe(1);

    const others = await Promise.all(
      ["device-aaaa-1111", "device-bbbb-2222"].map(async (id) => {
        const { data: s } = await env.startAs(id);
        return env.call<DailyFinishResponse>({ action: "finish", dive: s.dive });
      }),
    );
    expect(others.map((o) => o.data.total)).toEqual([70, 60]);
    const again = await env.call<DailyFinishResponse>({ action: "finish", dive: me.dive });
    expect(again.data).toMatchObject({ players: 3, shallower: 2 });
    const third = again.data.distribution[2]!;
    expect(third.players).toBe(3);
    expect(third.answers.reduce((n, a) => n + a.count, 0)).toBe(3);
    expect(third.answers.find((a) => a.canonical === null)).toMatchObject({ tier: "miss", count: 1, points: 0 });
  });

  it("one official attempt per device: starting again after finishing returns the finished dive", async () => {
    const env = setup();
    const s = await playDive(env, "device-aaaa-1111");
    await env.call({ action: "finish", dive: s.dive });
    const again = await env.startAs("device-aaaa-1111");
    expect(again.data.finished).toBe(true);
    expect(again.data.completed).toHaveLength(7);
    expect((await env.beginAt(again.data.dive, 0)).status).toBe(409);
  });

  it("a new day brings new prompts and a fresh attempt", async () => {
    const env = setup();
    await playDive(env, "device-aaaa-1111");
    env.clock.t = Date.parse("2026-11-21T15:00:00Z");
    const next = await env.startAs("device-aaaa-1111");
    expect(next.data).toMatchObject({ day: "2026-11-21", finished: false, completed: [] });
    expect(dailyPromptIds("2026-11-21")).not.toEqual(dailyPromptIds("2026-11-20"));
  });
});
