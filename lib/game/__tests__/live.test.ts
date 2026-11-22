import { describe, expect, it } from "vitest";
import {
  MAX_FINDERS_SHOWN,
  ROOM_CODE_ALPHABET,
  computeLeaderboard,
  computeTeamBoard,
  nameKey,
  normalizeRoomCode,
  randomRoomCode,
  revealCounts,
  type StandingPlayer,
  type StandingSubmission,
} from "../live";

describe("room codes", () => {
  it("are 4 consonants, so they never spell a word", () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < 2000; i++) {
      const code = randomRoomCode(random);
      expect(code).toMatch(/^[A-Z]{4}$/);
      for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
    }
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[AEIOUY]/);
  });

  it("normalizes what people type", () => {
    expect(normalizeRoomCode("bcdf")).toBe("BCDF");
    expect(normalizeRoomCode(" b-c d f ")).toBe("BCDF");
    expect(normalizeRoomCode("BCD")).toBeNull();
    expect(normalizeRoomCode("BCDFG")).toBeNull();
    expect(normalizeRoomCode("ABCD")).toBeNull(); // A is never used
    expect(normalizeRoomCode(42)).toBeNull();
  });
});

describe("nameKey", () => {
  it("ignores case and spacing", () => {
    expect(nameKey("  Deep  Sea Deb ")).toBe(nameKey("deep sea deb"));
    expect(nameKey("Sam")).not.toBe(nameKey("Samuel"));
  });
});

const player = (id: string, joinedAt: number, extra: Partial<StandingPlayer> = {}): StandingPlayer => ({
  id,
  nickname: id.toUpperCase(),
  team: null,
  kicked: false,
  joinedAt,
  ...extra,
});
const sub = (playerId: string, roundIndex: number, points: number, ms = 1000, canonical = `ans-${points}`): StandingSubmission => ({
  playerId,
  roundIndex,
  points,
  ms,
  canonical,
  tier: points >= 100 ? "one_in_a_million" : points >= 85 ? "deep_cut" : points >= 60 ? "rare" : points >= 30 ? "schooler" : "plankton",
});

describe("computeLeaderboard", () => {
  const players = [player("a", 1), player("b", 2), player("c", 3), player("d", 4)];

  it("ranks by total over revealed rounds only", () => {
    const subs = [sub("a", 0, 10), sub("b", 0, 60), sub("a", 1, 100), sub("c", 1, 30)];
    const r0 = computeLeaderboard(players, subs, (i) => i <= 0, 0);
    expect(r0.map((r) => [r.id, r.total, r.last])).toEqual([
      ["b", 60, 60],
      ["a", 10, 10],
      ["c", 0, null],
      ["d", 0, null],
    ]);
    const r1 = computeLeaderboard(players, subs, (i) => i <= 1, 1);
    expect(r1[0]).toMatchObject({ id: "a", total: 110, last: 100, rank: 1 });
    expect(r1.find((r) => r.id === "b")).toMatchObject({ total: 60, last: null });
  });

  it("breaks ties by total answer time, then join order", () => {
    const subs = [sub("a", 0, 30, 9000), sub("b", 0, 30, 2000), sub("c", 0, 30, 2000)];
    expect(computeLeaderboard(players, subs, () => true, 0).map((r) => r.id)).toEqual(["b", "c", "a", "d"]);
  });

  it("leaves removed players out", () => {
    const kicked = [player("a", 1, { kicked: true }), player("b", 2)];
    const board = computeLeaderboard(kicked, [sub("a", 0, 100), sub("b", 0, 10)], () => true, 0);
    expect(board.map((r) => r.id)).toEqual(["b"]);
    expect(board[0]!.rank).toBe(1);
  });
});

describe("computeTeamBoard", () => {
  it("ranks teams by points per member and merges case variants", () => {
    const players = [
      player("a", 1, { team: "Lions" }),
      player("b", 2, { team: "lions" }),
      player("c", 3, { team: "Eagles" }),
      player("d", 4),
    ];
    const subs = [sub("a", 0, 100), sub("b", 0, 10), sub("c", 0, 60), sub("d", 0, 100)];
    const teams = computeTeamBoard(computeLeaderboard(players, subs, () => true, 0));
    expect(teams).toEqual([
      { rank: 1, team: "Eagles", members: 1, total: 60, average: 60 },
      { rank: 2, team: "Lions", members: 2, total: 110, average: 55 },
    ]);
  });
});

describe("revealCounts", () => {
  it("counts answers and names the finders of deep ones, fastest first", () => {
    const names = new Map([
      ["a", "Ann"],
      ["b", "Bo"],
      ["c", "Cy"],
    ]);
    const subs = [sub("b", 0, 100, 5000, "Obadiah"), sub("a", 0, 100, 3000, "Obadiah"), sub("c", 0, 10, 1000, "Jonah"), sub("x", 0, 10, 1, "Jonah")];
    const r = revealCounts(subs, names);
    expect(r.counts).toEqual({ Obadiah: 2, Jonah: 1 }); // "x" was removed from the room
    expect(r.answered).toBe(3);
    expect(r.finders).toEqual({ Obadiah: ["Ann", "Bo"] });
  });

  it("caps the finder list", () => {
    const names = new Map(Array.from({ length: 10 }, (_, i) => [`p${i}`, `P${i}`] as [string, string]));
    const subs = [...names.keys()].map((id, i) => sub(id, 0, 85, i, "Hophni"));
    expect(revealCounts(subs, names).finders.Hophni).toHaveLength(MAX_FINDERS_SHOWN);
  });
});
