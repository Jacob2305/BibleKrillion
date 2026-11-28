import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnswerResponse, DiveStartResponse, PromptBeginResponse } from "../../lib/game/api-types";
import { normalizeAnswer } from "../../lib/game/normalize";
import { allPrompts, getPrompt, pickRandomPromptIds } from "../bank";
import { SUBMIT_GRACE_MS } from "../config";
import { MESSAGES, createPracticeHandler } from "../practice";
import { MemoryTierStore, type TierStore } from "../tier-store";
import { signToken, verifyToken } from "../tokens";

const T0 = 1_800_000_000_000;

function setup(tiers: TierStore = new MemoryTierStore()) {
  const clock = { t: T0 };
  const handler = createPracticeHandler({ now: () => clock.t, random: Math.random, tiers: () => tiers });
  async function call<T = unknown>(body: unknown): Promise<{ status: number; data: T }> {
    const res = await handler(
      new Request("http://test/api/practice", {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
    return { status: res.status, data: (await res.json()) as T };
  }
  return { clock, call };
}

/** A dive token over specific prompts, signed like the server does. */
function diveFor(ids: string[]): string {
  return signToken({ k: "practice-dive", ids, iat: T0, s: 25 });
}

async function beginPrompt(call: ReturnType<typeof setup>["call"], promptId: string) {
  const { data } = await call<PromptBeginResponse>({ action: "begin", dive: diveFor([promptId]), index: 0 });
  return data;
}

afterEach(() => vi.restoreAllMocks());

describe("permanent tier changes", () => {
  it("score answers at the host's tier, in the result and the reveal", async () => {
    const tiers = new MemoryTierStore();
    const p = getPrompt("the-twelve")!;
    const a = p.answers.find((x) => x.tier === "plankton" && !x.generic_for)!;
    await tiers.set(p.id, a.canonical, "deep_cut", T0);
    const { call } = setup(tiers);
    const { promptToken } = await beginPrompt(call, p.id);
    const { data } = await call<AnswerResponse>({ action: "answer", promptToken, text: a.canonical });
    expect(data).toMatchObject({ status: "accepted", answer: { canonical: a.canonical, tier: "deep_cut", points: 85 } });
    if (data.status !== "accepted") throw new Error("not accepted");
    expect(data.reveal.answers.find((x) => x.canonical === a.canonical)).toMatchObject({ tier: "deep_cut" });
  });
});

describe("tokens", () => {
  it("round-trips", () => {
    expect(verifyToken(signToken({ a: 1 }, "secret"), "secret")).toEqual({ a: 1 });
  });

  it("rejects a different secret, tampering, and garbage", () => {
    const token = signToken({ a: 1 }, "secret");
    expect(verifyToken(token, "other-secret")).toBeNull();
    const bytes = Buffer.from(token, "base64url");
    bytes[14]! ^= 1; // flip one ciphertext bit
    expect(verifyToken(bytes.toString("base64url"), "secret")).toBeNull();
    expect(verifyToken(token.slice(0, -2), "secret")).toBeNull();
    expect(verifyToken("garbage", "secret")).toBeNull();
    expect(verifyToken("a.b", "secret")).toBeNull();
    expect(verifyToken(42, "secret")).toBeNull();
  });

  it("is unreadable: upcoming prompt ids can't be decoded from a dive token", () => {
    const token = signToken({ ids: ["the-twelve", "dreamers"] }, "secret");
    expect(Buffer.from(token, "base64url").toString("latin1")).not.toMatch(/twelve|dreamers/);
    expect(token).not.toBe(signToken({ ids: ["the-twelve", "dreamers"] }, "secret")); // random IV
  });
});

describe("practice: start", () => {
  it("returns an opaque dive of 7 prompts and no prompt text or answers", async () => {
    const { call } = setup();
    const { status, data } = await call<DiveStartResponse>({ action: "start" });
    expect(status).toBe(200);
    expect(data.count).toBe(7);
    expect(data.seconds).toBe(25);
    expect(Object.keys(data).sort()).toEqual(["count", "dive", "seconds"]);
  });

  it("picks 7 distinct prompts from 7 different categories", () => {
    for (let run = 0; run < 50; run++) {
      const ids = pickRandomPromptIds(7);
      expect(new Set(ids).size).toBe(7);
      expect(new Set(ids.map((id) => getPrompt(id)!.category)).size).toBe(7);
    }
  });
});

describe("practice: begin never leaks answers", () => {
  it.each(allPrompts().map((p) => [p.id]))("%s", async (id) => {
    const { call } = setup();
    const data = await beginPrompt(call, id);
    const prompt = getPrompt(id)!;
    expect(data.prompt).toEqual({
      id,
      prompt: prompt.prompt,
      category: prompt.category,
      testament: prompt.testament,
      closedSet: prompt.closed_set,
    });
    expect(data.deadline).toBe(T0 + 25_000);
    // No answer name may appear in the payload, unless it's literally a word of the prompt text itself.
    const payload = normalizeAnswer(JSON.stringify({ ...data, promptToken: undefined }));
    const promptWords = normalizeAnswer(prompt.prompt + " " + prompt.category);
    for (const a of prompt.answers) {
      const name = normalizeAnswer(a.canonical);
      if (promptWords.includes(name)) continue;
      expect(payload.includes(` ${name} `), `leaked "${a.canonical}"`).toBe(false);
    }
  });

  it("rejects a bad index or a forged dive", async () => {
    const { call } = setup();
    expect((await call({ action: "begin", dive: diveFor(["the-twelve"]), index: 3 })).status).toBe(400);
    const forged = signToken({ k: "practice-dive", ids: ["the-twelve"], iat: T0, s: 999 }, "attacker-secret");
    expect((await call({ action: "begin", dive: forged, index: 0 })).status).toBe(400);
  });

  it("expires old dives", async () => {
    const { call, clock } = setup();
    clock.t = T0 + 7 * 60 * 60 * 1000;
    expect((await call({ action: "begin", dive: diveFor(["the-twelve"]), index: 0 })).status).toBe(410);
  });
});

describe("practice: answer", () => {
  it("accepts a bank answer and returns its tier plus the full reveal", async () => {
    const { call } = setup();
    const { promptToken } = await beginPrompt(call, "the-twelve");
    const { data } = await call<AnswerResponse>({ action: "answer", promptToken, text: "st. matthias" });
    expect(data.status).toBe("accepted");
    if (data.status !== "accepted") return;
    expect(data.answer).toMatchObject({ canonical: "Matthias", tier: "one_in_a_million", points: 100 });
    expect(data.answer.gemNote).toMatch(/lots/);
    expect(data.reveal.answers[0]!.points).toBe(100); // deepest first
    expect(data.reveal.answers.length).toBe(getPrompt("the-twelve")!.answers.length);
  });

  it("forgives typos and rewards specificity", async () => {
    const { call } = setup();
    const { promptToken } = await beginPrompt(call, "the-twelve");
    const generic = await call<AnswerResponse>({ action: "answer", promptToken, text: "James" });
    expect(generic.data).toMatchObject({ status: "accepted", answer: { canonical: "James", points: 10 } });
    // A typo first asks "Did you mean …?" (no tier, nothing locked), then counts once confirmed.
    const typo = await call<AnswerResponse>({ action: "answer", promptToken, text: "James the Les" });
    expect(typo.data).toEqual({ status: "confirm", suggestion: "James son of Alphaeus" });
    const confirmed = await call<AnswerResponse>({ action: "answer", promptToken, text: "James the Les", confirm: true });
    expect(confirmed.data).toMatchObject({ status: "accepted", answer: { canonical: "James son of Alphaeus", points: 85 } });
  });

  it("accepts exact spellings and listed alternatives without asking", async () => {
    const { call } = setup();
    const { promptToken } = await beginPrompt(call, "the-twelve");
    const { data } = await call<AnswerResponse>({ action: "answer", promptToken, text: "  JAMES  " });
    expect(data).toMatchObject({ status: "accepted" });
  });

  it("rejects unlisted answers without revealing anything, and logs them", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { call } = setup();
    const { promptToken } = await beginPrompt(call, "the-twelve");
    const { data } = await call<AnswerResponse>({ action: "answer", promptToken, text: "Goliath" });
    expect(data).toEqual({ status: "rejected", message: MESSAGES.rejected });
    const logged = JSON.parse(info.mock.calls[0]![0] as string);
    expect(logged).toMatchObject({ event: "rejected_answer", promptId: "the-twelve", raw: "Goliath", reason: "not_in_bank" });
    expect(logged.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("asks for specificity on a fuzzy tie without naming the candidates", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { call } = setup();
    const { promptToken } = await beginPrompt(call, "judges-of-israel");
    const { data } = await call<AnswerResponse>({ action: "answer", promptToken, text: "Elo" });
    expect(data).toEqual({ status: "ambiguous", message: MESSAGES.ambiguous });
  });

  it("treats blank input as empty, not as a rejection", async () => {
    const { call } = setup();
    const { promptToken } = await beginPrompt(call, "the-twelve");
    expect((await call<AnswerResponse>({ action: "answer", promptToken, text: "  " })).data.status).toBe("empty");
  });

  it("counts a submission that arrives within the grace window after the deadline", async () => {
    const { call, clock } = setup();
    const { promptToken, deadline } = await beginPrompt(call, "the-twelve");
    clock.t = deadline + SUBMIT_GRACE_MS;
    expect((await call<AnswerResponse>({ action: "answer", promptToken, text: "Peter" })).data.status).toBe("accepted");
  });

  it("refuses answers after the grace window and returns the reveal instead", async () => {
    const { call, clock } = setup();
    const { promptToken, deadline } = await beginPrompt(call, "the-twelve");
    clock.t = deadline + SUBMIT_GRACE_MS + 1;
    const { data } = await call<AnswerResponse>({ action: "answer", promptToken, text: "Peter" });
    expect(data.status).toBe("too_late");
  });

  it("rejects a forged prompt token", async () => {
    const { call } = setup();
    const forged = signToken({ k: "practice-prompt", pid: "the-twelve", i: 0, dl: T0 + 9e9 }, "attacker-secret");
    expect((await call({ action: "answer", promptToken: forged, text: "Peter" })).status).toBe(400);
  });
});

describe("practice: reveal", () => {
  it("is refused while the prompt is running, allowed after", async () => {
    const { call, clock } = setup();
    const { promptToken, deadline } = await beginPrompt(call, "plagues-of-egypt");
    const early = await call<{ error: string }>({ action: "reveal", promptToken });
    expect(early.status).toBe(403);
    expect(JSON.stringify(early.data)).not.toMatch(/Frogs/i);
    clock.t = deadline;
    const late = await call<{ reveal: { answers: { canonical: string }[] } }>({ action: "reveal", promptToken });
    expect(late.status).toBe(200);
    expect(late.data.reveal.answers.map((a) => a.canonical)).toContain("Frogs");
  });
});

describe("practice: request handling", () => {
  it("rejects unknown actions and non-JSON bodies", async () => {
    const { call } = setup();
    expect((await call({ action: "peek" })).status).toBe(400);
    expect((await call("not json")).status).toBe(400);
    expect((await call("[1,2]")).status).toBe(400);
  });
});
