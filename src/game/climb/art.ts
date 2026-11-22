/**
 * Pixel art for the reveal climb, all original to this project. Hand-drawn
 * sprites are text grids (one character per pixel, "." is clear); the big
 * round things (planets, the galaxy, nebulae) are generated from maths so they
 * stay crisp at any size.
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

/** Dove, wings up and wings down (same size, so the flap doesn't jump). */
export const DOVE_UP = [
  "..W...............",
  "..WW..............",
  "...WW.............",
  "...WWW............",
  "....WWW...........",
  "....WWWW.....WW...",
  ".....WWWW...WWWW..",
  "WW...WWWWWWWWWKWOO",
  ".WWWWWWWWWWWWWWW..",
  "..WWWWWWWWWWWWW...",
  "...GGWWWWWWWGG....",
  "......GGGGG.......",
  "..................",
  "..................",
] as const;

export const DOVE_DOWN = [
  "..................",
  "..................",
  "..................",
  "..................",
  "..................",
  ".............WW...",
  "............WWWW..",
  "WW...WWWWWWWWWKWOO",
  ".WWWWWWWWWWWWWWW..",
  "..WWWWWWWWWWWWW...",
  "...GGWWWWWWGGG....",
  "....WWWWWWG.......",
  "....WWWWW.........",
  "...WWWW...........",
] as const;

export const DOVE_COLORS: Palette = { W: "#fff8ec", G: "#c8c2ea", K: "#13163f", O: "#ffbf3c" };

// ───────────────────────── the sea ─────────────────────────

export const WAVE_TILE = [
  "..CC......",
  ".CLLC...CC",
  "CLWWLC.CLL",
  "WWWWWWCWWW",
] as const;
export const WAVE_COLORS: Palette = { C: "#bfe9ff", L: "#5fb3dc", W: "#2b7fb0" };

export const BOAT = [
  "......M.......",
  "......MS......",
  "......MSS.....",
  "......MSSS....",
  "......MSSSS...",
  "......MSSSSS..",
  "......MSSSSSS.",
  "......M.......",
  "HHHHHHHHHHHHHH",
  ".HHHHHHHHHHHH.",
  "..DDDDDDDDDD..",
] as const;
export const BOAT_COLORS: Palette = { M: "#5a3420", S: "#fff8ec", H: "#b5523b", D: "#7a2e2a" };

export const FISH = [
  "...FFF...",
  ".FFFFFF.F",
  "FEFFFFFFF",
  ".FFFFFF.F",
  "...FFF...",
] as const;

export const PLANKTON = [
  ".P.",
  "PLP",
  ".P.",
] as const;
export const PLANKTON_COLORS: Palette = { P: "#7fffd4", L: "#e8fff7" };

/** A kelp frond, `h` pixels tall, gently zig-zagging. */
export function kelp(h: number, seed: number): string[] {
  const r = seeded(seed);
  const rows: string[] = [];
  let x = 2;
  for (let y = 0; y < h; y++) {
    if (y % 3 === 0) x = Math.min(3, Math.max(1, x + (r() < 0.5 ? -1 : 1)));
    const row = Array.from({ length: 6 }, (_, i) => (i === x || i === x + 1 ? "K" : y % 4 === 1 && i === x + 2 ? "L" : "."));
    rows.push(row.join(""));
  }
  return rows;
}
export const KELP_COLORS: Palette = { K: "#1f6b4f", L: "#2f9a6a" };

// ───────────────────────── creekside ─────────────────────────

export const CREEK_HOUSE = [
  "...........CC...",
  "......RRRR.CC...",
  ".....RRRRRRCC...",
  "....RRRRRRRRRR..",
  "...RRRRRRRRRRRR.",
  "..RRRRRRRRRRRRRR",
  "...WWWWWWWWWWWW.",
  "...WYYWWWWWDDWW.",
  "...WYYWWWWWDDWW.",
  "...WWWWWWWWDDWW.",
  "...WWWWWWWWDDWW.",
] as const;
export const CREEK_HOUSE_COLORS: Palette = { R: "#8a3344", C: "#4a3a4a", W: "#d9a86c", Y: "#ffd866", D: "#5a3420" };

export const CHAPEL = [
  "....Y....",
  "...YYY...",
  "....Y....",
  "...SSS...",
  "..SSSSS..",
  "..SWYWS..",
  ".RRRRRRR.",
  "RRRRRRRRR",
  ".WWWWWWW.",
  ".WYWWWYW.",
  ".WYWWWYW.",
  ".WWWDWWW.",
  ".WWWDWWW.",
] as const;
export const CHAPEL_COLORS: Palette = { Y: "#ffd866", S: "#e8e0f6", W: "#f3ead8", R: "#5b4a8a", D: "#5a3420" };

/** A town building `w`×`h` pixels with a grid of windows, some lit. */
export function building(w: number, h: number, seed: number, roof: "flat" | "peak" | "step"): string[] {
  const r = seeded(seed);
  const rows: string[] = [];
  const roofRows = roof === "flat" ? 1 : roof === "step" ? 2 : Math.ceil(w / 2);
  for (let y = 0; y < roofRows; y++) {
    let row = "";
    for (let x = 0; x < w; x++) {
      if (roof === "flat") row += "T";
      else if (roof === "step") row += y === 0 ? (x > w / 4 && x < (3 * w) / 4 ? "T" : ".") : "T";
      else row += Math.abs(x - (w - 1) / 2) <= y + 0.5 ? "T" : ".";
    }
    rows.push(row);
  }
  for (let y = 0; y < h; y++) {
    let row = "";
    for (let x = 0; x < w; x++) {
      const windowCell = x > 0 && x < w - 1 && x % 2 === 1 && y % 3 === 1 && y < h - 2;
      if (windowCell) row += r() < 0.55 ? "Y" : "K";
      else if (y >= h - 3 && x === Math.floor(w / 2)) row += "D";
      else row += "B";
    }
    rows.push(row);
  }
  return rows;
}

// ───────────────────────── the sky ─────────────────────────

export const BALLOON = [
  "....ABABA....",
  "..ABABABABA..",
  ".ABABABABABA.",
  "ABABABABABABA",
  "ABABABABABABA",
  "ABABABABABABA",
  ".ABABABABABA.",
  "..ABABABABA..",
  "...ABABABA...",
  "....L...L....",
  ".....L.L.....",
  ".....KKK.....",
  ".....KKK.....",
] as const;
export const BALLOON_COLORS: Palette = { A: "#ff7a6b", B: "#ffd866", L: "#4a3a4a", K: "#8a5a34" };

export const BIRD = [
  "B...B",
  ".B.B.",
  "..B..",
] as const;

// ───────────────────────── space ─────────────────────────

export const SATELLITE = [
  ".......A.......",
  "PPPPP..A..PPPPP",
  "PLPLP.GBG.PLPLP",
  "PPPPPGGBGGPPPPP",
  "PLPLP.GBG.PLPLP",
  "PPPPP.....PPPPP",
] as const;
export const SATELLITE_COLORS: Palette = { P: "#3d6bd1", L: "#8fb3ff", G: "#9a94c8", B: "#fff8ec", A: "#c8c2ea" };

export const SPARKLE = [
  "..W..",
  "..W..",
  "WWYWW",
  "..W..",
  "..W..",
] as const;
export const SPARKLE_COLORS: Palette = { W: "#fff8ec", Y: "#ffd866" };

/** Curtains of light hanging over the edge of the atmosphere: bright at the base, fading upwards. */
export function aurora(w: number, h: number, seed: number): string[] {
  const r = seeded(seed);
  const p1 = r() * 6;
  const p2 = r() * 6;
  const base = Array.from({ length: w }, (_, x) => Math.round(h * 0.78 + (h / 6) * Math.sin(x / 11 + p1)));
  const reach = Array.from({ length: w }, (_, x) => Math.round(h * (0.35 + 0.3 * (0.5 + 0.5 * Math.sin(x / 4.3 + p2)))));
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => {
      const up = base[x]! - y; // rows above this column's base
      if (up < 0 || up > reach[x]!) return ".";
      const t = up / reach[x]!;
      const n = r();
      if (t < 0.12) return "A";
      if (t < 0.45) return n < 0.85 ? "B" : ".";
      return n < 0.55 - t * 0.4 ? "C" : ".";
    }).join(""),
  );
}
export const AURORA_COLORS: Palette = { A: "#9dffd9", B: "#3fc8a4", C: "#7a5ad1" };

/**
 * A lit sphere of radius `r` (light from the top left). Optional bands for a
 * gas giant, craters for a moon, and a tilted ring that passes in front of the
 * lower half.
 */
export function planet(r: number, opts: { bands?: boolean; craters?: number; ring?: boolean; seed?: number } = {}): string[] {
  const ringA = opts.ring ? r * 1.95 : r;
  const ringB = r * 0.42;
  const halfW = Math.ceil(ringA);
  const rand = seeded(opts.seed ?? 5);
  const craters = Array.from({ length: opts.craters ?? 0 }, () => ({ x: (rand() - 0.5) * r * 1.3, y: (rand() - 0.5) * r * 1.3, s: 1 + rand() * (r / 5) }));
  const rows: string[] = [];
  for (let y = -r; y <= r; y++) {
    let row = "";
    for (let x = -halfW; x <= halfW; x++) {
      const inDisc = x * x + y * y <= r * r + r * 0.6;
      const e = opts.ring ? (x * x) / (ringA * ringA) + (y * y) / (ringB * ringB) : 9;
      const onRing = opts.ring && e > 0.72 && e < 1.05 && Math.abs(y) <= ringB + 0.5;
      if (onRing && (!inDisc || y >= 0)) {
        row += e > 0.9 ? "Q" : "R";
        continue;
      }
      if (!inDisc) {
        row += ".";
        continue;
      }
      const light = -(x + y) / (r * 1.414);
      const crater = craters.some((c) => (x - c.x) ** 2 + (y - c.y) ** 2 <= c.s * c.s);
      if (light > 0.45) row += "C";
      else if (light < -0.42) row += "S";
      else if (crater) row += "D";
      else if (opts.bands && (y + r) % 4 === 1) row += "D";
      else row += "A";
    }
    rows.push(row);
  }
  return rows;
}

/** A two-armed spiral galaxy, seen at a tilt. */
export function galaxy(w: number, h: number, seed: number): string[] {
  const r = seeded(seed);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => {
      const dx = x - cx;
      const dy = (y - cy) * (w / h) * 0.9;
      const d = Math.hypot(dx, dy);
      const phase = Math.atan2(dy, dx) - Math.log(d + 1) * 2.1;
      const arm = Math.pow(0.5 + 0.5 * Math.cos(2 * phase), 4) * Math.exp(-d / (w * 0.3));
      const core = Math.exp(-(d * d) / (w * 0.9));
      const v = arm * 1.15 + core + (r() - 0.5) * 0.12;
      return v > 0.8 ? "Y" : v > 0.5 ? "W" : v > 0.3 ? "P" : v > 0.16 ? "V" : ".";
    }).join(""),
  );
}
export const GALAXY_COLORS: Palette = { Y: "#fff6c8", W: "#ffd1f0", P: "#c48cff", V: "#6a4ad1" };

/** Soft clouds of colour, dithered: the nebula behind the cosmos. */
export function nebula(w: number, h: number, seed: number): string[] {
  const r = seeded(seed);
  const blobs = Array.from({ length: 6 }, (_, i) => ({
    x: r() * w,
    y: r() * h,
    rx: w * (0.12 + r() * 0.2),
    ry: h * (0.15 + r() * 0.25),
    c: (["M", "T", "G"] as const)[i % 3]!,
  }));
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => {
      let best = 0;
      let c = ".";
      for (const b of blobs) {
        const v = Math.exp(-(((x - b.x) / b.rx) ** 2 + ((y - b.y) / b.ry) ** 2));
        if (v > best) {
          best = v;
          c = b.c;
        }
      }
      const n = r();
      if (best > 0.6 && n < 0.85) return c;
      if (best > 0.3 && n < 0.5) return c.toLowerCase();
      if (best > 0.15 && n < 0.18) return c.toLowerCase();
      return ".";
    }).join(""),
  );
}
export const NEBULA_COLORS: Palette = {
  M: "#d14aa8",
  m: "#6a1f72",
  T: "#3ac6d8",
  t: "#1d4f8a",
  G: "#9a6aff",
  g: "#3d2a8a",
};

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
