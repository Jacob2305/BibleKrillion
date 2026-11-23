/**
 * Shared pixel art for the reveal climb, all original to this project: seeded
 * randomness, the climbing dove and the starfield. Each zone's own art lives
 * next to it: sea-art.ts, sky-art.ts, space-art.ts.
 */
import type { Palette } from "../pixel";

// ───────────────────────── seeded randomness ─────────────────────────

export function seeded(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ───────────────────────── the climber ─────────────────────────

/** Dove, wings up and wings down (same size, so the flap doesn't jump). Outlined, light from above. */
export const DOVE_UP = [
  ".....EE...............................",
  "....EHHE..............................",
  "....EWWHE.............................",
  "....ELGLEE............................",
  ".....EWWHHE...........................",
  ".....ELGLWEE..........................",
  "......EWWWHHE.........................",
  "......ELGLWWEE........................",
  ".......EWWWWHHE.......................",
  ".......ELGLWWWEE......................",
  "........EWWWWWHHE...........EE........",
  "........ELGLWWWWEE........EEHHEE......",
  ".........EWWWWWWHHE......EHHWWHHE.....",
  ".........ELGLWWWWWEE....EEWWWWWWE.....",
  ".EEE......EWWWWWWWHHEEEEHHWWWWWWHEEEE.",
  "EHHHEE....EWWWWWWWWWHHHHWWWWWSKWWBBBBE",
  "ELWWHHEEEEHWWWWWWWWWWWWWWWWWWKKWWbbbbE",
  ".ELLWWHHHHWWWWWWWWWWWWWWWWWWWWWWLEEEE.",
  "..EEWWWWWWWWWWWWWWWWWWWWWWWWWWWWE.....",
  "...ELLWWWWWWWWWWWWWWWWWWWWWWWWLLE.....",
  "....EELWWWWWWWWWWWWWWWWWWWWWWLEE......",
  "......EDGGWWWWWWWWWWWWWWWWGGDE........",
  ".......EDDDLLWWWWWWWWWWLLDDDE.........",
  "........EEEEEDGGGGGGGGDEEEEE..........",
  ".............EDDDDDDDDE...............",
  "..............EEEEEEEE................",
  "......................................",
  "......................................",
  "......................................",
  "......................................",
] as const;

export const DOVE_DOWN = [
  "......................................",
  "......................................",
  "......................................",
  "......................................",
  "......................................",
  "......................................",
  "......................................",
  "......................................",
  "......................................",
  "......................................",
  "............................EE........",
  "..........................EEHHEE......",
  ".........................EHHWWHHE.....",
  "........................EEWWWWWWE.....",
  ".EEE........EEEEEEEEEEEEHHWWWWWWHEEEE.",
  "EHHHEE....EEHHHHHHHHHHHHWWWWWSKWWBBBBE",
  "ELWWHHEEEEHHWWWWWWWWWWWWWWWWWKKWWbbbbE",
  ".ELLWWHHHHWWWWWWWWWWWWWWWWWWWWWWLEEEE.",
  "..EEWWWWWWWWWWWWWWWWWWWWWWWWWWWWE.....",
  "...ELLWWWWWWWWWWWWWWWWWWWWWWWWLLE.....",
  "....EELWWWWWWWWWWWWWWWWWWWWWWLEE......",
  "......EDGGGWWWWWWWWWWWWWGGGGDE........",
  ".......EDGGWWWWWWWWWWWGGDDDDE.........",
  "........EWWWWWWWWWWWWWDDEEEE..........",
  "........EWWWWWWWWWWWLDEE..............",
  "........EWWWWWWWWWLLEE................",
  ".......EHWWWWWWWLLEE..................",
  "......EHWWWWWWLLEE....................",
  "......ELLLLLLLEE......................",
  ".......EEEEEEE........................",
] as const;

export const DOVE_COLORS: Palette = {
  W: "#fff8ec",
  H: "#ffffff",
  L: "#e2dcf4",
  G: "#c8c2ea",
  D: "#9d95cc",
  E: "#3b3470",
  K: "#13163f",
  S: "#fff8ec",
  B: "#ffbf3c",
  b: "#e07a2c",
};

// ───────────────────────── stars ─────────────────────────

/** Stars for a zone: positions in %, density rising towards the top. */
export function starfield(count: number, seed: number, opts: { fromBottom?: number } = {}) {
  const r = seeded(seed);
  const from = opts.fromBottom ?? 0;
  return Array.from({ length: count }, () => {
    // Squaring biases stars towards the top when `from` > 0.
    const t = from > 0 ? Math.sqrt(r()) : r();
    return { x: r() * 100, y: from + t * (100 - from), big: r() < 0.18, twinkle: r() < 0.35, delay: r() * 3 };
  });
}
