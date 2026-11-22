import { describe, expect, it } from "vitest";
import { normalizeAnswer } from "../normalize";
import { levenshtein } from "../levenshtein";

describe("normalizeAnswer", () => {
  it.each([
    ["Peter", "peter"],
    ["  PETER  ", "peter"],
    ["Peter!!!", "peter"],
    ["Abél", "abel"],
    ["Zürich-ish Noé", "zurich ish noe"],
    ["Jacob's", "jacobs"],
    ["Jacob’s", "jacobs"],
    ["Simon-Peter", "simon peter"],
    ["Simon   Peter", "simon peter"],
    ["Mary (mother of Jesus)", "mary mother of jesus"],
    ["Song of Songs", "song of songs"],
  ])("%j → %j", (raw, expected) => {
    expect(normalizeAnswer(raw)).toBe(expected);
  });

  it.each([
    ["The Exodus", "exodus"],
    ["St. Peter", "peter"],
    ["St Peter", "peter"],
    ["St.Peter", "peter"],
    ["Saint Matthew", "matthew"],
    ["King David", "david"],
    ["Prophet Elijah", "elijah"],
    ["the prophet Elijah", "elijah"],
    ["The Apostle Paul", "paul"],
    ["Apostle Saint Paul", "paul"],
  ])("drops leading honorifics: %j → %j", (raw, expected) => {
    expect(normalizeAnswer(raw)).toBe(expected);
  });

  it("only drops honorifics at the start, and only whole words", () => {
    expect(normalizeAnswer("David the King")).toBe("david the king");
    expect(normalizeAnswer("Kingdom")).toBe("kingdom");
    expect(normalizeAnswer("Theophilus")).toBe("theophilus");
    expect(normalizeAnswer("Stephen")).toBe("stephen");
  });

  it("never drops the last remaining word", () => {
    expect(normalizeAnswer("The")).toBe("the");
    expect(normalizeAnswer("King")).toBe("king");
    expect(normalizeAnswer("the king")).toBe("king");
  });

  it.each([
    ["1 Kings", "1 kings"],
    ["1st Kings", "1 kings"],
    ["First Kings", "1 kings"],
    ["I Kings", "1 kings"],
    ["II Samuel", "2 samuel"],
    ["2nd Samuel", "2 samuel"],
    ["Second Samuel", "2 samuel"],
    ["III John", "3 john"],
    ["Third John", "3 john"],
    ["3rd John", "3 john"],
  ])("canonicalizes a leading ordinal: %j → %j", (raw, expected) => {
    expect(normalizeAnswer(raw)).toBe(expected);
  });

  it("leaves a lone ordinal-like word alone", () => {
    expect(normalizeAnswer("First")).toBe("first");
    expect(normalizeAnswer("I")).toBe("i");
  });

  it("only converts ordinals in front of numbered-book names", () => {
    expect(normalizeAnswer("I am the bread of life")).toBe("i am the bread of life");
    expect(normalizeAnswer("First fruits")).toBe("first fruits");
    expect(normalizeAnswer("1st Cor")).toBe("1 cor");
    expect(normalizeAnswer("II Tim")).toBe("2 tim");
    expect(normalizeAnswer("First Peter")).toBe("1 peter");
  });

  it("returns empty string for blank or punctuation-only input", () => {
    expect(normalizeAnswer("")).toBe("");
    expect(normalizeAnswer("   ")).toBe("");
    expect(normalizeAnswer("?!.,")).toBe("");
    expect(normalizeAnswer(undefined as unknown as string)).toBe("");
  });
});

describe("levenshtein", () => {
  it.each([
    ["", "", 0],
    ["abc", "", 3],
    ["", "abc", 3],
    ["peter", "peter", 0],
    ["peter", "petr", 1],
    ["matthew", "mathew", 1],
    ["kitten", "sitting", 3],
    ["jehoshaphat", "jehoshafat", 2],
  ] as const)("%j vs %j = %i", (a, b, d) => {
    expect(levenshtein(a, b)).toBe(d);
    expect(levenshtein(b, a)).toBe(d);
  });

  it("stops early and returns max + 1 when over the bound", () => {
    expect(levenshtein("kitten", "sitting", 1)).toBe(2);
    expect(levenshtein("a", "abcdefgh", 2)).toBe(3);
    expect(levenshtein("peter", "petr", 1)).toBe(1);
  });

  it("counts an astral character as one edit", () => {
    expect(levenshtein("a😀", "ab", 5)).toBe(1);
  });
});
