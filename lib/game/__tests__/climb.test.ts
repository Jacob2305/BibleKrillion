import { describe, expect, it } from "vitest";
import { ANSWER_TIERS } from "../scoring";
import { CLIMB_START, CLIMB_ZONES, climbDurationMs, climbTarget, easeClimb, highestTier, metersAtCamera } from "../climb";

describe("reveal climb", () => {
  it("has one zone per answer tier, in points order", () => {
    expect(CLIMB_ZONES.map((z) => z.tier)).toEqual([...ANSWER_TIERS]);
    expect(CLIMB_ZONES[0]!.place).toBe("The Sea");
    expect(CLIMB_ZONES.at(-1)!.place).toBe("The Cosmos");
  });

  it("climbs to the tier's zone; a miss stays in the water", () => {
    expect(climbTarget("plankton")).toBe(0);
    expect(climbTarget("one_in_a_million")).toBe(5);
    expect(climbTarget("miss")).toBe(CLIMB_START);
    expect(climbDurationMs("miss")).toBe(0);
    expect(climbDurationMs("one_in_a_million")).toBeGreaterThan(climbDurationMs("rare"));
  });

  it("reads each tier's metres on the altimeter when it lands", () => {
    expect(metersAtCamera(CLIMB_START)).toBe(0);
    expect(metersAtCamera(0)).toBe(100);
    expect(metersAtCamera(2)).toBe(300);
    expect(metersAtCamera(4)).toBe(850);
    expect(metersAtCamera(5)).toBe(1000);
    expect(metersAtCamera(9)).toBe(1000);
    expect(metersAtCamera(3.5)).toBe(725);
  });

  it("eases from 0 to 1", () => {
    expect(easeClimb(0)).toBe(0);
    expect(easeClimb(1)).toBe(1);
    expect(easeClimb(0.5)).toBeCloseTo(0.5);
    expect(easeClimb(2)).toBe(1);
  });

  it("finds the rarest tier the room reached", () => {
    expect(highestTier([])).toBeNull();
    expect(highestTier(["schooler", "deep_cut", "plankton"])).toBe("deep_cut");
  });
});
