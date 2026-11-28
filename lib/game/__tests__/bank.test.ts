import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildPromptMatcher, formatBank, validateBank, type Bank, type BankAnswer, type BankPrompt } from "../bank";
import { checkReference } from "../books";

function answer(canonical: string, tier: BankAnswer["tier"] = "rare", extra: Partial<BankAnswer> = {}): BankAnswer {
  return { canonical, aliases: [], tier, reference: "Genesis 1:1", ...extra };
}

function prompt(id: string, answers: BankAnswer[], extra: Partial<BankPrompt> = {}): BankPrompt {
  return { id, prompt: `Prompt ${id}`, category: "Test", testament: "OT", closed_set: true, answers, ...extra };
}

/** A valid prompt with 8 answers incl. one gem; override pieces per test. */
function goodPrompt(id = "p1", extra: Partial<BankPrompt> = {}): BankPrompt {
  const answers = ["Alpha", "Bravo", "Charlie", "Delta", "Foxtrot", "Golfer", "Hotel"].map((n) => answer(n));
  answers.push(answer("Juliett", "one_in_a_million", { gem_note: "A gem." }));
  return prompt(id, answers, extra);
}

const sevenPrompts = (): Bank => Array.from({ length: 7 }, (_, i) => goodPrompt(`p${i + 1}`));
const messages = (issues: { message: string }[]) => issues.map((i) => i.message).join("\n");

describe("validateBank", () => {
  it("accepts a well-formed bank", () => {
    const { errors, stats } = validateBank(sevenPrompts());
    expect(errors).toEqual([]);
    expect(stats).toMatchObject({ prompts: 7, answers: 56, gems: 7 });
  });

  it("rejects a non-array bank and too few prompts", () => {
    expect(messages(validateBank({}).errors)).toMatch(/JSON array/);
    expect(messages(validateBank([goodPrompt()]).errors)).toMatch(/at least 7/);
  });

  it("requires ≥8 answers and ≥1 gem per prompt", () => {
    const bank = sevenPrompts();
    bank[0]!.answers = bank[0]!.answers.slice(0, 7); // drops the gem too
    const text = messages(validateBank(bank).errors);
    expect(text).toMatch(/needs at least 8/);
    expect(text).toMatch(/at least one gem/);
  });

  it("rejects invalid tiers and missing references", () => {
    const bank = sevenPrompts();
    bank[0]!.answers[0] = { ...answer("Alpha"), tier: "legendary" as BankAnswer["tier"] };
    bank[0]!.answers[1] = { ...answer("Bravo"), reference: "" };
    bank[0]!.answers[2] = { ...answer("Charlie"), reference: "Hezekiah 3:16" };
    const text = messages(validateBank(bank).errors);
    expect(text).toMatch(/Invalid tier "legendary"/);
    expect(text).toMatch(/missing reference/);
    expect(text).toMatch(/66-book canon/);
  });

  it("allows exactly one gem per prompt", () => {
    const bank = sevenPrompts();
    bank[0]!.answers[0] = answer("Alpha", "one_in_a_million", { gem_note: "Another gem." });
    expect(messages(validateBank(bank).errors)).toMatch(/Has 2 gems: exactly one gem/);
  });

  it("requires a gem_note on gems", () => {
    const bank = sevenPrompts();
    delete bank[0]!.answers[7]!.gem_note;
    expect(messages(validateBank(bank).errors)).toMatch(/need a gem_note/);
  });

  it("checks schema fields", () => {
    const bank = sevenPrompts() as unknown as Record<string, unknown>[];
    bank[0] = { ...bank[0], testament: "Apocrypha", closed_set: "yes", id: "Bad Id" };
    const text = messages(validateBank(bank).errors);
    expect(text).toMatch(/testament must be/);
    expect(text).toMatch(/closed_set must be/);
    expect(text).toMatch(/kebab-case/);
  });

  it("rejects duplicate prompt ids", () => {
    const bank = sevenPrompts();
    bank[1]!.id = "p1";
    expect(messages(validateBank(bank).errors)).toMatch(/Duplicate prompt id/);
  });

  it("rejects an alias that appears in two answers, even after normalization", () => {
    const bank = sevenPrompts();
    bank[0]!.answers[0]!.aliases = ["Simon"];
    bank[0]!.answers[1]!.aliases = ["St. Simon"];
    expect(messages(validateBank(bank).errors)).toMatch(/"simon" appears in more than one answer/);
  });

  it("warns (does not fail) on fuzzy collisions like Eli vs Elon", () => {
    const bank = sevenPrompts();
    bank[0]!.answers[0] = answer("Eli");
    bank[0]!.answers[1] = answer("Elon");
    const { errors, warnings } = validateBank(bank);
    expect(errors).toEqual([]);
    expect(messages(warnings)).toMatch(/Fuzzy collision: "eli" \(Eli\) ~ "elon" \(Elon\)/);
  });

  it("does not warn about numbered siblings like 1 Kings / 2 Kings", () => {
    const bank = sevenPrompts();
    bank[0]!.answers[0] = answer("1 Kings");
    bank[0]!.answers[1] = answer("2 Kings");
    expect(messages(validateBank(bank).warnings)).not.toMatch(/kings/);
  });

  it("warns on unknown fields (typos)", () => {
    const bank = sevenPrompts();
    (bank[0]!.answers[0] as unknown as Record<string, unknown>).refrence = "Genesis 1:1";
    expect(messages(validateBank(bank).warnings)).toMatch(/Unknown answer field "refrence"/);
  });

  describe("generic answers (shared names)", () => {
    function withJames(genericTier: BankAnswer["tier"], zebedee: BankAnswer["tier"], alphaeus: BankAnswer["tier"]) {
      const bank = sevenPrompts();
      bank[0]!.answers[0] = answer("James", genericTier, { generic_for: ["James son of Zebedee", "James son of Alphaeus"] });
      bank[0]!.answers[1] = answer("James son of Zebedee", zebedee);
      bank[0]!.answers[2] = answer("James son of Alphaeus", alphaeus);
      return bank;
    }

    it("accepts a generic that scores below the specific answers", () => {
      expect(validateBank(withJames("plankton", "schooler", "deep_cut")).errors).toEqual([]);
    });

    it("allows a tie with one specific answer as long as another scores higher", () => {
      expect(validateBank(withJames("plankton", "plankton", "rare")).errors).toEqual([]);
    });

    it("rejects a generic that outscores a specific answer", () => {
      expect(messages(validateBank(withJames("rare", "schooler", "deep_cut")).errors)).toMatch(/outscores/);
    });

    it("rejects a generic that never scores less than a specific answer", () => {
      expect(messages(validateBank(withJames("schooler", "schooler", "schooler")).errors)).toMatch(/must score less/);
    });

    it("rejects generic_for names that don't exist in the prompt", () => {
      const bank = withJames("plankton", "schooler", "rare");
      bank[0]!.answers[0]!.generic_for = ["James son of Zebedee", "James the Just"];
      expect(messages(validateBank(bank).errors)).toMatch(/"James the Just", which is not a canonical answer/);
    });
  });
});

describe("checkReference", () => {
  it.each(["Judges 3:31", "1 Samuel 8:1-2", "Genesis 4:19; 36:2", "Psalm 133:3", "Song of Solomon 2:3", "3 John 1:1", "Numbers 9:5, 11"])(
    "accepts %j",
    (ref) => expect(checkReference(ref)).toBeNull(),
  );
  it.each(["", "Judges", "Hezekiah 3:16", "Maccabees 1:1", "judges 3:31", "Genesis 4:19; Tobit 1:1"])("rejects %j", (ref) => {
    expect(checkReference(ref)).not.toBeNull();
  });
});

describe("formatBank", () => {
  it("round-trips and puts each answer on its own line", () => {
    const bank = sevenPrompts();
    const text = formatBank(bank);
    expect(JSON.parse(text)).toEqual(bank);
    expect(text).toContain(`\n      {"canonical":"Alpha","aliases":[],"tier":"rare","reference":"Genesis 1:1"}`);
  });
});

describe("prompt matcher with strip_prefixes and generic answers", () => {
  const twelve = prompt("twelve", [
    answer("Peter", "plankton", { aliases: ["Simon Peter", "Cephas"] }),
    answer("James", "plankton", { generic_for: ["James son of Zebedee", "James son of Alphaeus"] }),
    answer("James son of Zebedee", "schooler", { aliases: ["James the Greater"] }),
    answer("James son of Alphaeus", "deep_cut", { aliases: ["James the Less"] }),
  ]);
  const m = buildPromptMatcher(twelve);

  it("a bare shared name gets the generic (low-tier) answer", () => {
    expect(m("James")).toMatchObject({ kind: "exact", answer: { canonical: "James", tier: "plankton" } });
    expect(m("Jame")).toMatchObject({ kind: "fuzzy", answer: { canonical: "James" } });
  });

  it("being specific earns the specific (higher-tier) answer", () => {
    expect(m("James son of Alphaeus")).toMatchObject({ answer: { tier: "deep_cut" } });
    expect(m("James the Less")).toMatchObject({ answer: { canonical: "James son of Alphaeus" } });
    expect(m("James son of Alpheus")).toMatchObject({ kind: "fuzzy", answer: { canonical: "James son of Alphaeus" } });
    expect(m("James the Greater")).toMatchObject({ answer: { canonical: "James son of Zebedee" } });
  });

  const mountains = prompt(
    "mountains",
    [answer("Sinai", "plankton", { aliases: ["Horeb"] }), answer("Mount of Olives", "schooler", { aliases: ["Olivet"] })],
    { strip_prefixes: ["mount", "mt"] },
  );
  const mm = buildPromptMatcher(mountains);

  it("strips per-prompt prefixes from the player's input", () => {
    expect(mm("Mount Sinai")).toMatchObject({ kind: "exact", answer: { canonical: "Sinai" } });
    expect(mm("Mt. Horeb")).toMatchObject({ kind: "exact", answer: { canonical: "Sinai" } });
    expect(mm("Mount Sinaii")).toMatchObject({ kind: "fuzzy", answer: { canonical: "Sinai" } });
  });

  it("tries the unstripped input first so multi-word names still match", () => {
    expect(mm("Mount of Olives")).toMatchObject({ kind: "exact", answer: { canonical: "Mount of Olives" } });
    expect(mm("Mount Olivet")).toMatchObject({ kind: "exact", answer: { canonical: "Mount of Olives" } });
  });

  it("never strips the whole input away", () => {
    expect(mm("Mount").kind).toBe("no_match");
  });
});

describe("the real bank (data/prompts.json)", () => {
  const bankPath = fileURLToPath(new URL("../../../data/prompts.json", import.meta.url));
  const bank = JSON.parse(readFileSync(bankPath, "utf8")) as Bank;

  it("passes validation with zero errors", () => {
    const { errors, stats } = validateBank(bank);
    expect(messages(errors)).toBe("");
    expect(stats.prompts).toBeGreaterThanOrEqual(35);
  });

  it("is stored in canonical format (run `npm run format-bank` after hand edits)", () => {
    expect(readFileSync(bankPath, "utf8").replace(/\r\n/g, "\n")).toBe(formatBank(bank));
  });

  it("every canonical name and alias matches its own answer exactly", () => {
    const failures: string[] = [];
    for (const p of bank) {
      const match = buildPromptMatcher(p);
      for (const a of p.answers) {
        for (const term of [a.canonical, ...a.aliases]) {
          const result = match(term);
          if (result.kind !== "exact" || result.answer !== a) {
            const got = "answer" in result ? result.answer.canonical : result.kind;
            failures.push(`${p.id}: "${term}" → ${got} (expected ${a.canonical})`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

});
