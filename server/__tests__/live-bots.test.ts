import { describe, expect, it } from "vitest";
import { getPrompt } from "../bank";
import { BOT_NAMES, BOT_TEAM, BOT_TEAMS, addBots, botPick } from "../live-bots";
import { MemoryLiveStore } from "../live-store";

function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

describe("bot crowd", () => {
  it("has 27 unique, short names", () => {
    expect(BOT_NAMES).toHaveLength(27);
    expect(new Set(BOT_NAMES.map((n) => n.toLowerCase())).size).toBe(27);
    for (const n of BOT_NAMES) {
      expect(n.startsWith("Bot ")).toBe(true);
      expect(n.length).toBeLessThanOrEqual(24);
    }
  });

  it("answers like a room: familiar tiers most, rare ones less, the odd gem, some misses", () => {
    const prompt = getPrompt("fire-stories")!;
    const random = seeded(5);
    const picks = Array.from({ length: 2000 }, () => botPick(prompt, random));
    const tally = (tier: string) => picks.filter((p) => p?.tier === tier).length;
    const misses = picks.filter((p) => p === null).length;
    expect(misses / picks.length).toBeGreaterThan(0.08);
    expect(misses / picks.length).toBeLessThan(0.16);
    expect(tally("plankton")).toBeGreaterThan(tally("rare"));
    expect(tally("schooler")).toBeGreaterThan(tally("deep_cut"));
    expect(tally("one_in_a_million")).toBeGreaterThan(0);
    expect(tally("one_in_a_million")).toBeLessThan(tally("rare"));
  });

  it("piles onto popular answers, so a 27-bot reveal shows ×N counts", () => {
    const prompt = getPrompt("el-names")!;
    const random = seeded(9);
    const counts = new Map<string, number>();
    for (let i = 0; i < 27; i++) {
      const p = botPick(prompt, random);
      if (p) counts.set(p.canonical, (counts.get(p.canonical) ?? 0) + 1);
    }
    expect(Math.max(...counts.values())).toBeGreaterThanOrEqual(3);
  });

  it("splits into bot teams in team rooms; a couple of bots stay one team", async () => {
    const store = new MemoryLiveStore();
    const room = (await store.createRoom({ code: "BCDF", promptIds: ["fire-stories"], seconds: 30, teams: true, now: 0 }))!;
    await addBots(store, room.id, 0, BOT_NAMES.length, BOT_TEAM);
    const teams = (await store.listPlayers(room.id)).map((p) => p.team);
    expect(new Set(teams)).toEqual(new Set(BOT_TEAMS));
    for (const t of BOT_TEAMS) expect(teams.filter((x) => x === t).length).toBeGreaterThanOrEqual(6);

    const small = (await store.createRoom({ code: "GHJK", promptIds: ["fire-stories"], seconds: 30, teams: true, now: 0 }))!;
    await addBots(store, small.id, 0, 2, BOT_TEAM);
    expect((await store.listPlayers(small.id)).map((p) => p.team)).toEqual([BOT_TEAM, BOT_TEAM]);

    const solo = (await store.createRoom({ code: "LMNP", promptIds: ["fire-stories"], seconds: 30, teams: false, now: 0 }))!;
    await addBots(store, solo.id, 0, BOT_NAMES.length, null);
    expect((await store.listPlayers(solo.id)).every((p) => p.team === null)).toBe(true);
  });
});
