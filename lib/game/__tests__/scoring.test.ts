import { describe, expect, it } from "vitest";
import {
  ANSWER_TIERS,
  DIVE_RATING_BANDS,
  PROMPTS_PER_DIVE,
  TIER_INFO,
  TIER_ORDER,
  depthMeters,
  diveRating,
  diveRatingLabel,
  isAnswerTier,
  isResultTier,
  maxDivePoints,
  pointsForTier,
  totalPoints,
  type ResultTier,
} from "../scoring";

describe("tier → points", () => {
  it.each([
    ["plankton", 10],
    ["too_clever", 15],
    ["schooler", 30],
    ["rare", 60],
    ["deep_cut", 85],
    ["one_in_a_million", 100],
    ["miss", 0],
  ] as const)("%s is worth %i", (tier, points) => {
    expect(pointsForTier(tier)).toBe(points);
  });

  it("labels match the game's names", () => {
    expect(TIER_ORDER.map((t) => TIER_INFO[t].label)).toEqual([
      "Plankton",
      "Too Clever",
      "Schooler",
      "Rare",
      "Deep Cut",
      "One in a Million",
      "Miss",
    ]);
  });

  it("every tier has a distinct share emoji", () => {
    const emojis = TIER_ORDER.map((t) => TIER_INFO[t].emoji);
    expect(new Set(emojis).size).toBe(emojis.length);
  });

  it("throws on an unknown tier instead of silently scoring 0", () => {
    expect(() => pointsForTier("gem" as ResultTier)).toThrow(/Unknown tier/);
  });

  it("type guards separate bank tiers from the miss outcome", () => {
    for (const t of ANSWER_TIERS) expect(isAnswerTier(t)).toBe(true);
    expect(isAnswerTier("miss")).toBe(false);
    expect(isResultTier("miss")).toBe(true);
    expect(isAnswerTier("gem")).toBe(false);
    expect(isAnswerTier("Plankton")).toBe(false);
    expect(isAnswerTier(10)).toBe(false);
    expect(isResultTier(undefined)).toBe(false);
  });
});

describe("dive totals and depth", () => {
  it("a standard dive is 7 prompts with a 700 point max", () => {
    expect(PROMPTS_PER_DIVE).toBe(7);
    expect(maxDivePoints()).toBe(700);
    expect(maxDivePoints(10)).toBe(1000);
  });

  it("sums a dive", () => {
    const dive: ResultTier[] = ["plankton", "too_clever", "schooler", "rare", "deep_cut", "one_in_a_million", "miss"];
    expect(totalPoints(dive)).toBe(10 + 15 + 30 + 60 + 85 + 100 + 0);
    expect(totalPoints([])).toBe(0);
    expect(totalPoints(Array(7).fill("one_in_a_million"))).toBe(700);
  });

  it("1 point = 10 m, max 7,000 m", () => {
    expect(depthMeters(0)).toBe(0);
    expect(depthMeters(85)).toBe(850);
    expect(depthMeters(700)).toBe(7000);
    expect(depthMeters(-5)).toBe(0);
  });
});

describe("dive rating bands", () => {
  it.each([
    [0, "plankton"],
    [70, "plankton"],
    [150, "plankton"],
    [151, "schooler"],
    [250, "schooler"],
    [251, "rare"],
    [350, "rare"],
    [351, "deep_cut"],
    [449, "deep_cut"],
    [450, "one_in_a_million"],
    [700, "one_in_a_million"],
  ] as const)("%i → %s", (total, rating) => {
    expect(diveRating(total)).toBe(rating);
  });

  it("bands are contiguous with no gaps or overlaps", () => {
    for (let i = 1; i < DIVE_RATING_BANDS.length; i++) {
      expect(DIVE_RATING_BANDS[i]!.min).toBe(DIVE_RATING_BANDS[i - 1]!.max + 1);
    }
  });

  it("every whole total from 0 to 700 gets a rating", () => {
    for (let t = 0; t <= 700; t++) expect(diveRating(t)).toBeTruthy();
  });

  it("handles garbage defensively", () => {
    expect(diveRating(-10)).toBe("plankton");
    expect(diveRating(Number.NaN)).toBe("plankton");
    expect(diveRating(150.5)).toBe("plankton");
  });

  it("has display labels", () => {
    expect(diveRatingLabel(100)).toBe("Plankton");
    expect(diveRatingLabel(400)).toBe("Deep Cut");
    expect(diveRatingLabel(500)).toBe("One in a Million");
  });
});
