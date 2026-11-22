import { describe, expect, it } from "vitest";
import { dayKey, dayLabel, msUntilNextDay, shareText } from "../daily";

describe("daily helpers", () => {
  it("day label", () => {
    expect(dayLabel("2026-11-20")).toBe("Fri, Nov 20");
  });

  it("time until NY midnight", () => {
    // 2026-11-20 23:00:00 EST = 2026-11-21 04:00:00Z → 1 hour left
    expect(msUntilNextDay(Date.parse("2026-11-21T04:00:00Z"))).toBe(3_600_000);
    expect(dayKey(Date.parse("2026-11-21T04:00:00Z") + 3_600_000)).toBe("2026-11-21");
  });

  it("share text has one emoji per prompt, the depth, and no answers", () => {
    const text = shareText({
      day: "2026-11-20",
      tiers: ["plankton", "one_in_a_million", "rare", "miss", "schooler", "deep_cut", "too_clever"],
      total: 300,
      url: "https://example.com/daily",
    });
    expect(text).toBe("Bible Dive · Fri, Nov 20\n🦐💎🐙⬛🐟🦑🤓\n🕊️ 3,000 m · Rare\nhttps://example.com/daily");
  });
});
