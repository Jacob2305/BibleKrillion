import { describe, expect, it } from "vitest";
import {
  buildMatcher,
  findFuzzyCollisions,
  isAccepted,
  matchAnswer,
  maxEditsFor,
  type MatchableAnswer,
  type MatchResult,
} from "../matching";

const apostles: MatchableAnswer[] = [
  { canonical: "Peter", aliases: ["Simon Peter", "Cephas"] },
  { canonical: "Andrew" },
  { canonical: "Matthew", aliases: ["Levi"] },
  { canonical: "Bartholomew", aliases: ["Nathanael"] },
  { canonical: "Thomas", aliases: ["Didymus", "Doubting Thomas"] },
  { canonical: "Judas Iscariot" },
];

const paulish: MatchableAnswer[] = [
  { canonical: "Paul", aliases: ["Saul of Tarsus", "Saul"] },
  { canonical: "Barnabas" },
  { canonical: "Silas" },
];

/** Canonical name of the accepted answer, or the result kind if not accepted. */
function outcome(result: MatchResult): string {
  if (result.kind === "exact" || result.kind === "fuzzy") return result.answer.canonical;
  return result.kind;
}

describe("exact and alias matching", () => {
  const match = buildMatcher(apostles);

  it.each([
    ["Peter", "Peter"],
    ["peter", "Peter"],
    ["  PETER!! ", "Peter"],
    ["Simon Peter", "Peter"],
    ["simon-peter", "Peter"],
    ["Cephas", "Peter"],
    ["St. Peter", "Peter"],
    ["Saint Peter", "Peter"],
    ["the apostle Peter", "Peter"],
    ["Levi", "Matthew"],
    ["Saint Matthew", "Matthew"],
    ["Nathanael", "Bartholomew"],
    ["Didymus", "Thomas"],
  ])("%j → %s", (input, expected) => {
    const result = match(input);
    expect(result.kind).toBe("exact");
    expect(outcome(result)).toBe(expected);
  });

  it("matches Saul of Tarsus to Paul", () => {
    expect(outcome(matchAnswer("Saul of Tarsus", paulish))).toBe("Paul");
    expect(outcome(matchAnswer("Apostle Paul", paulish))).toBe("Paul");
    expect(outcome(matchAnswer("saul", paulish))).toBe("Paul");
  });

  it("reports the index of the matched answer", () => {
    const result = match("Levi");
    expect(result.kind === "exact" && result.index).toBe(2);
  });
});

describe("fuzzy matching", () => {
  const match = buildMatcher(apostles);

  it.each([
    ["Petr", "Peter", 1], // 5-letter term: 1 edit allowed
    ["Pete", "Peter", 1],
    ["Mathew", "Matthew", 1],
    ["Bartholemew", "Bartholomew", 1],
    ["Bartolemew", "Bartholomew", 2], // long term: 2 edits allowed
    ["Tomas", "Thomas", 1],
    ["Judas Iscariott", "Judas Iscariot", 1],
    ["Cefas", "Peter", 2], // fuzzy against an alias (6-letter "cephas": 2 edits allowed)
  ])("%j → %s (distance %i)", (input, expected, distance) => {
    const result = match(input);
    expect(result.kind).toBe("fuzzy");
    expect(outcome(result)).toBe(expected);
    expect(result.kind === "fuzzy" && result.distance).toBe(distance);
  });

  it("allows ≤1 edit for terms of length ≤5 and ≤2 for longer terms", () => {
    expect(maxEditsFor("peter")).toBe(1);
    expect(maxEditsFor("levi")).toBe(1);
    expect(maxEditsFor("andrew")).toBe(2);
    expect(maxEditsFor("simon peter")).toBe(2);
  });

  it("rejects inputs that are too far off", () => {
    expect(match("Ptr").kind).toBe("no_match"); // 2 edits from a 5-letter term
    expect(match("Andrewsss").kind).toBe("no_match"); // 3 edits from a 6-letter term
    expect(match("Goliath").kind).toBe("no_match");
  });

  it("requires very short terms and inputs to match exactly", () => {
    const places: MatchableAnswer[] = [{ canonical: "Ai" }, { canonical: "Ur" }, { canonical: "Jericho" }];
    const m = buildMatcher(places);
    expect(outcome(m("Ai"))).toBe("Ai");
    expect(outcome(m("ai!"))).toBe("Ai");
    expect(m("Aj").kind).toBe("no_match");
    expect(m("a").kind).toBe("no_match");
    expect(m("U").kind).toBe("no_match");
    expect(maxEditsFor("ai")).toBe(0);
  });

  it("three-letter terms still allow one edit", () => {
    const tribes: MatchableAnswer[] = [{ canonical: "Dan" }, { canonical: "Gad" }, { canonical: "Asher" }];
    expect(outcome(matchAnswer("Dann", tribes))).toBe("Dan");
    expect(outcome(matchAnswer("Gadd", tribes))).toBe("Gad");
    expect(matchAnswer("Dad", tribes).kind).toBe("ambiguous"); // 1 edit from both Dan and Gad
  });

  it("fuzzy closeness to two terms of the SAME answer is not ambiguous", () => {
    const m = buildMatcher([{ canonical: "Mary Magdalene", aliases: ["Mary Magdalen"] }, { canonical: "Martha" }]);
    expect(outcome(m("Mary Magdalena"))).toBe("Mary Magdalene");
  });
});

describe("exact beats fuzzy", () => {
  it("an exact hit wins even when another answer is 1 edit away", () => {
    const kingsAndProphets: MatchableAnswer[] = [{ canonical: "Amos" }, { canonical: "Amon" }];
    expect(matchAnswer("Amon", kingsAndProphets)).toMatchObject({ kind: "exact", answer: { canonical: "Amon" } });
    expect(matchAnswer("Amos", kingsAndProphets)).toMatchObject({ kind: "exact", answer: { canonical: "Amos" } });
  });

  it("an exact alias hit wins over a fuzzy canonical hit", () => {
    const people: MatchableAnswer[] = [{ canonical: "Eli" }, { canonical: "Elon" }, { canonical: "Elijah", aliases: ["Elias"] }];
    expect(matchAnswer("Eli", people)).toMatchObject({ kind: "exact", answer: { canonical: "Eli" } });
    expect(matchAnswer("Elon", people)).toMatchObject({ kind: "exact", answer: { canonical: "Elon" } });
    expect(matchAnswer("Elias", people)).toMatchObject({ kind: "exact", answer: { canonical: "Elijah" } });
  });
});

describe("ambiguous fuzzy rejection", () => {
  it("rejects a typo that is equally close to two different answers", () => {
    const kings: MatchableAnswer[] = [{ canonical: "Ahab" }, { canonical: "Ahaz" }, { canonical: "Hezekiah" }];
    const result = matchAnswer("Ahas", kings);
    expect(result.kind).toBe("ambiguous");
    expect(isAccepted(result)).toBe(false);
    if (result.kind === "ambiguous") {
      expect(result.via).toBe("fuzzy");
      expect(result.candidates.map((c) => c.canonical).sort()).toEqual(["Ahab", "Ahaz"]);
    }
  });

  it("rejects Eli/Elon in-between typos", () => {
    const people: MatchableAnswer[] = [{ canonical: "Eli" }, { canonical: "Elon" }];
    expect(matchAnswer("Elo", people).kind).toBe("ambiguous");
  });

  describe("numbered books", () => {
    const books: MatchableAnswer[] = [
      { canonical: "1 Kings" },
      { canonical: "2 Kings" },
      { canonical: "1 John" },
      { canonical: "2 John" },
      { canonical: "3 John" },
      { canonical: "John" },
    ];
    const m = buildMatcher(books);

    it("ordinal spellings match exactly", () => {
      expect(m("First Kings")).toMatchObject({ kind: "exact", answer: { canonical: "1 Kings" } });
      expect(m("II Kings")).toMatchObject({ kind: "exact", answer: { canonical: "2 Kings" } });
      expect(m("3rd John")).toMatchObject({ kind: "exact", answer: { canonical: "3 John" } });
      expect(m("John")).toMatchObject({ kind: "exact", answer: { canonical: "John" } });
    });

    it("a bare 'Kings' must be more specific", () => {
      expect(m("Kings").kind).toBe("ambiguous");
      expect(m("3 Kings").kind).toBe("ambiguous");
    });

    it("a strictly closer answer wins over a farther one", () => {
      expect(m("1 King")).toMatchObject({ kind: "fuzzy", answer: { canonical: "1 Kings" }, distance: 1 });
      expect(m("1 Jon")).toMatchObject({ kind: "fuzzy", answer: { canonical: "1 John" }, distance: 1 });
      expect(m("Jon")).toMatchObject({ kind: "fuzzy", answer: { canonical: "John" }, distance: 1 });
    });
  });

  it("an exact term shared by two answers (a bank error) is ambiguous, not a coin flip", () => {
    const bad: MatchableAnswer[] = [
      { canonical: "James son of Zebedee", aliases: ["James"] },
      { canonical: "James son of Alphaeus", aliases: ["James"] },
    ];
    const result = matchAnswer("James", bad);
    expect(result).toMatchObject({ kind: "ambiguous", via: "exact" });
  });
});

describe("empty and junk input", () => {
  const match = buildMatcher(apostles);

  it.each(["", "   ", "!!!", "the"])("%j is not accepted", (input) => {
    expect(isAccepted(match(input))).toBe(false);
  });

  it("blank input is reported as empty", () => {
    expect(match("").kind).toBe("empty");
    expect(match(" ?! ").kind).toBe("empty");
  });

  it("handles an empty bank", () => {
    expect(matchAnswer("Peter", []).kind).toBe("no_match");
  });

  it("does not crash on very long input", () => {
    expect(match("x".repeat(10_000)).kind).toBe("no_match");
  });
});

describe("findFuzzyCollisions (validator helper)", () => {
  it("flags Eli vs Elon", () => {
    const collisions = findFuzzyCollisions([{ canonical: "Eli" }, { canonical: "Elon" }]);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]).toMatchObject({ a: "Eli", b: "Elon", distance: 2 });
  });

  it("does not flag clearly different names", () => {
    expect(findFuzzyCollisions([{ canonical: "Peter" }, { canonical: "Paul" }, { canonical: "Andrew" }])).toEqual([]);
  });

  it("ignores a single answer's own aliases", () => {
    expect(findFuzzyCollisions([{ canonical: "Mary Magdalene", aliases: ["Mary Magdalen"] }])).toEqual([]);
  });

  it("checks aliases across answers", () => {
    const collisions = findFuzzyCollisions([
      { canonical: "Uzziah", aliases: ["Azariah"] },
      { canonical: "Amaziah" },
    ]);
    expect(collisions.some((c) => c.termA === "azariah" && c.termB === "amaziah")).toBe(true);
  });

  it("ignores far-apart pairs a single typo can't realistically confuse", () => {
    // distance 3: only a precise 'midpoint' typo could tie them
    expect(findFuzzyCollisions([{ canonical: "Cephas" }, { canonical: "Caiaphas" }])).toEqual([]);
    expect(findFuzzyCollisions([{ canonical: "Abijah" }, { canonical: "Uzziah" }])).toEqual([]);
  });
});
