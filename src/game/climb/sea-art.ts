/**
 * Pixel art for the deep, the sea and creekside (sea.tsx). Everything is drawn
 * at one art pixel per --px, with small shade ramps (highlight, base, shadow,
 * dark edge) and the light coming from the setting sun on the right.
 * Most sprites are generated from simple shapes with seeded noise so they stay
 * deterministic; a few small ones are hand-drawn grids.
 */
import type { Palette } from "../pixel";
import { seeded } from "./art";

// ───────────────────────── grid helpers ─────────────────────────

type Grid = string[][];
const blank = (w: number, h: number): Grid => Array.from({ length: h }, () => Array<string>(w).fill("."));
const out = (g: Grid) => g.map((r) => r.join(""));
const get = (g: Grid, x: number, y: number) => g[y]?.[x] ?? ".";
function set(g: Grid, x: number, y: number, ch: string) {
  const row = g[y];
  if (row && x >= 0 && x < row.length) row[x] = ch;
}
function rect(g: Grid, x: number, y: number, w: number, h: number, ch: string) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(g, x + i, y + j, ch);
}
/** Every filled pixel next to a clear one (4-neighbours) becomes `ch`. */
function outline(g: Grid, ch: string, keep = "") {
  const edge: [number, number][] = [];
  g.forEach((row, y) =>
    row.forEach((c, x) => {
      if (c === "." || keep.includes(c)) return;
      if ([get(g, x - 1, y), get(g, x + 1, y), get(g, x, y - 1), get(g, x, y + 1)].includes(".")) edge.push([x, y]);
    }),
  );
  edge.forEach(([x, y]) => set(g, x, y, ch));
}
/** Mirror a sprite left-right. */
export const flip = (art: readonly string[]) => art.map((r) => [...r].reverse().join(""));
const wrap = (v: number, n: number) => ((v % n) + n) % n;

/** A pixel grid as a repeating CSS background (runs merged, so tiles stay small). */
export function tileBg(art: readonly string[], palette: Palette): string {
  const w = Math.max(...art.map((r) => r.length));
  let rects = "";
  art.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const fill = palette[row[x]!];
      if (!fill) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < row.length && row[end] === row[x]) end++;
      rects += `<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${fill}"/>`;
      x = end;
    }
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${art.length}" shape-rendering="crispEdges">${rects}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// ───────────────────────── sunset ─────────────────────────

/** The setting sun: a lit disc with a soft halo, its lower half sliced into bands. */
export function sunsetSun(r: number): string[] {
  const halo = 4;
  const n = 2 * (r + halo);
  const c = (n - 1) / 2;
  const g = blank(n, n);
  const sliceFrom = Math.floor(c + r * 0.1);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = x - c;
      const dy = y - c;
      const d = Math.hypot(dx, dy);
      if (d > r + halo) continue;
      if (d > r) {
        set(g, x, y, d <= r + 2 ? "H" : "h");
        continue;
      }
      // sunset slices: gaps grow towards the bottom
      const yy = y - sliceFrom;
      if (yy > 0 && yy % 4 < (yy < 6 ? 1 : 2)) continue;
      // horizontal bands, bowed a little by the disc
      const v = dy / r + (d / r) * 0.22 - (dx / r) * 0.08;
      const ch = v < -0.62 ? "W" : v < -0.12 ? "L" : v < 0.32 ? "Y" : v < 0.68 ? "O" : "R";
      set(g, x, y, ch);
    }
  return out(g);
}
export const SUN_COLORS: Palette = {
  W: "#fffbe6",
  L: "#fff1a8",
  Y: "#ffcf4a",
  O: "#f8963c",
  R: "#e8604f",
  H: "rgba(255,196,140,0.38)",
  h: "rgba(255,196,140,0.18)",
};

/** Broken bars of sunlight on the water, narrowing with depth. */
export function sunGlint(w: number, h: number, seed: number): string[] {
  const r = seeded(seed);
  const g = blank(w, h);
  for (let y = 0; y < h; y += 2) {
    const t = y / h;
    const half = Math.max(1, Math.round((w / 2) * (1 - t * 0.85) * (0.55 + r() * 0.45)));
    const cx = Math.round(w / 2 + (r() - 0.5) * 4 * (1 - t));
    let x = cx - half;
    while (x < cx + half) {
      const len = 2 + Math.floor(r() * 5);
      const ch = t < 0.2 ? (r() < 0.5 ? "W" : "Y") : t < 0.55 ? (r() < 0.5 ? "Y" : "O") : r() < 0.6 ? "O" : "R";
      for (let i = 0; i < len && x + i < cx + half; i++) set(g, x + i, y, ch);
      x += len + 1 + Math.floor(r() * 3);
    }
  }
  return out(g);
}
export const GLINT_COLORS: Palette = { W: "#fff1a8", Y: "#ffcf4a", O: "#f8963c", R: "#c8625f" };

/** A long thin sunset cloud, lit from below. */
export function cloudStreak(w: number, seed: number): string[] {
  const r = seeded(seed);
  const h = 5;
  const g = blank(w, h);
  const bumps = Array.from({ length: Math.ceil(w / 10) }, (_, i) => ({ x: i * 10 + 3 + r() * 5, s: 2 + r() * 2 }));
  for (let x = 0; x < w; x++) {
    const t = Math.abs(x - (w - 1) / 2) / (w / 2); // 0 middle, 1 ends
    let top = t > 0.8 ? 3 : t > 0.55 ? 2 : 1;
    for (const b of bumps) if (Math.abs(x - b.x) < b.s && t < 0.6) top = 0;
    const bottom = t > 0.92 ? 3 : 4;
    for (let y = top; y <= bottom; y++) set(g, x, y, y === bottom ? "C" : y === top && bottom - top > 1 ? "A" : "B");
  }
  return out(g);
}
export const STREAK_COLORS: Palette = { A: "#b47aa2", B: "#d48a9a", C: "#ffb889" };

// ───────────────────────── the cliff ─────────────────────────

/** Layered rock with strata seams, speckle and small cracks. Tiles both ways. */
export function rockTile(w: number, h: number, seed: number): string[] {
  const r = seeded(seed);
  const g = blank(w, h);
  const seams: number[] = [];
  for (let y = 0; y < h - 5; y += 6 + Math.floor(r() * 7)) seams.push(y);
  const ph = r() * 6;
  const wob = (x: number, i: number) => Math.round(Math.sin((2 * Math.PI * x * 2) / w + ph + i) * 0.9 + Math.sin((2 * Math.PI * x * 5) / w + i * 2) * 0.45);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(g, x, y, "B");
  seams.forEach((s, i) => {
    const next = seams[i + 1] ?? h + seams[0]!;
    if (i % 2 === 1) for (let x = 0; x < w; x++) for (let y = s + wob(x, i) + 2; y < next + wob(x, i + 1); y++) set(g, x, wrap(y, h), "A");
    for (let x = 0; x < w; x++) {
      const y0 = s + wob(x, i);
      if (r() > 0.1) set(g, x, wrap(y0, h), "D");
      if (r() > 0.4) set(g, x, wrap(y0 + 1, h), "H");
      else if (r() > 0.7) set(g, x, wrap(y0 - 1, h), "b");
    }
    // vertical joints split each band into blocks
    const joints = r() < 0.6 ? 1 : 0;
    for (let j = 0; j < joints; j++) {
      const x = Math.floor(r() * w);
      const top = s + wob(x, i) + 1;
      const bottom = top + 2 + Math.floor(r() * Math.max(1, next - s - 4));
      for (let y = top; y < bottom; y++) {
        set(g, x, wrap(y, h), "D");
        set(g, wrap(x + 1, w), wrap(y, h), "H");
      }
    }
    // a little moss on some ledges
    if (r() < 0.45) {
      const x = Math.floor(r() * w);
      const len = 2 + Math.floor(r() * 4);
      for (let k = 0; k < len; k++) {
        set(g, wrap(x + k, w), wrap(s + wob(x + k, i), h), k % 2 ? "G" : "g");
        if (r() < 0.5) set(g, wrap(x + k, w), wrap(s + wob(x + k, i) + 1, h), "G");
      }
    }
  });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = get(g, x, y);
      if (c !== "B" && c !== "A") continue;
      const n = r();
      if (n < 0.045) set(g, x, y, "b");
      else if (n < 0.065) set(g, x, y, "H");
    }
  // a few cracks: dark lines with a lit right edge, sometimes forking
  for (let i = 0; i < 3; i++) {
    let x = Math.floor(r() * w);
    let y = Math.floor(r() * h);
    const len = 5 + Math.floor(r() * 7);
    for (let j = 0; j < len; j++) {
      set(g, wrap(x, w), wrap(y, h), "K");
      if (get(g, wrap(x + 1, w), wrap(y, h)) !== "K") set(g, wrap(x + 1, w), wrap(y, h), "H");
      if (j === 3) {
        set(g, wrap(x - 1, w), wrap(y + 1, h), "K");
        set(g, wrap(x - 2, w), wrap(y + 2, h), "K");
      }
      y++;
      if (r() < 0.45) x += r() < 0.5 ? -1 : 1;
    }
  }
  return out(g);
}
export const ROCK_COLORS: Palette = { g: "#5f9a5a", G: "#3f7448", H: "#5d4569", B: "#4b3554", A: "#46314f", b: "#3f2c49", D: "#37263f", K: "#2a1d33" };

/** The right-hand edge of the cliff: rim light from the sun and a dark outline, jagged. */
export function cliffEdgeTile(h: number, seed: number): string[] {
  const r = seeded(seed);
  const w = 6;
  const g = blank(w, h);
  const p1 = r() * 6;
  const p2 = r() * 6;
  for (let y = 0; y < h; y++) {
    const off = Math.max(0, Math.min(2, Math.round(1 + Math.sin((2 * Math.PI * y * 2) / h + p1) * 0.7 + Math.sin((2 * Math.PI * y * 5) / h + p2) * 0.6)));
    const o = w - 1 - off;
    for (let x = 2; x < o - 2; x++) set(g, x, y, r() < 0.08 ? "b" : "B");
    set(g, o - 2, y, r() < 0.7 ? "H" : "B");
    set(g, o - 1, y, r() < 0.12 ? "H" : "R");
    set(g, o, y, "K");
  }
  return out(g);
}
export const CLIFF_EDGE_COLORS: Palette = { ...ROCK_COLORS, R: "#a8697d" };

/** Moss and grass on top of a ledge: tufts above, drips below, outlined at the right. */
export function ledge(w: number, seed: number): string[] {
  const r = seeded(seed);
  const g = blank(w, 6);
  for (let x = 0; x < w - 1; x++) {
    if (r() < 0.3 && x > 1 && x < w - 2) set(g, x, 0, "g");
    if (x > 0 || r() < 0.5) set(g, x, 1, r() < 0.35 || get(g, x, 0) === "g" ? "g" : "G");
    set(g, x, 2, r() < 0.2 ? "g" : "G");
    set(g, x, 3, r() < 0.75 ? "M" : "G");
    if (r() < 0.45) set(g, x, 4, "M");
    if (get(g, x, 4) === "M" && r() < 0.35) set(g, x, 5, "M");
  }
  for (let y = 1; y < 5; y++) set(g, w - 1, y, "K");
  set(g, w - 2, 0, ".");
  set(g, w - 1, 1, ".");
  set(g, w - 2, 1, "K");
  return out(g);
}
export const MOSS_COLORS: Palette = { g: "#8fd16f", G: "#4f9a5a", M: "#2f6b45", K: "#2a1d33", V: "#3f8a50", F: "#ffb0c8" };

/** Underside of a jutting ledge: dark seam, a cast shadow, and roots hanging from the lip. */
export function overhang(w: number, jut: number, seed: number): string[] {
  const r = seeded(seed);
  const g = blank(w, 7);
  for (let x = 0; x < w; x++) {
    set(g, x, 0, "K");
    if (x < w - jut) {
      set(g, x, 1, "S");
      if ((x + 1) % 2 === 0) set(g, x, 2, "S");
    } else if (r() < 0.5) {
      const len = 1 + Math.floor(r() * 5);
      for (let y = 1; y <= len; y++) set(g, x, y, y === len ? "g" : "M");
    }
  }
  return out(g);
}
export const OVERHANG_COLORS: Palette = { K: "#2a1d33", S: "rgba(28,16,38,0.45)", M: "#2f6b45", g: "#4f9a5a" };

/** Ivy hanging down the cliff face. */
export function vine(h: number, seed: number): string[] {
  const r = seeded(seed);
  const g = blank(5, h);
  let x = 2;
  for (let y = 0; y < h; y++) {
    if (y > 0 && r() < 0.35) x = Math.max(1, Math.min(3, x + (r() < 0.5 ? -1 : 1)));
    set(g, x, y, "M");
    if (r() < 0.45) set(g, x + (r() < 0.5 ? -1 : 1), y, r() < 0.4 ? "g" : "G");
    if (y === h - 1) set(g, x, y, "G");
  }
  return out(g);
}

// ───────────────────────── waterfall, sea, beach ─────────────────────────

/** Falling water: streaks of foam and blue, dark at the edges. Repeats vertically. */
export function fallTile(h: number, seed: number): string[] {
  const r = seeded(seed);
  const w = 8;
  const g = blank(w, h);
  for (let x = 0; x < w; x++) {
    if (x === 0 || x === w - 1) {
      for (let y = 0; y < h; y++) set(g, x, y, r() < 0.2 ? "M" : "E");
      continue;
    }
    const edge = x === 1 || x === w - 2;
    let y = 0;
    let light = r() < 0.5;
    while (y < h) {
      const len = 2 + Math.floor(r() * (light ? 4 : 5));
      const ch = light ? (!edge && r() < 0.45 ? "W" : "L") : edge ? "D" : "M";
      for (let i = 0; i < len && y < h; i++, y++) set(g, x, y, ch);
      light = !light;
    }
  }
  return out(g);
}
export const FALL_COLORS: Palette = { W: "#f4fbff", L: "#bfe9ff", M: "#5fb3dc", D: "#3f94c4", E: "#2b6f9e" };

/** Foam boiling at the foot of the falls (two frames for a churn). */
export function foam(w: number, h: number, seed: number): string[] {
  const r = seeded(seed);
  const g = blank(w, h);
  const puffs = Array.from({ length: 6 }, () => ({ x: 2 + r() * (w - 4), y: h - 1 - r() * 2, s: 1.6 + r() * 2.4 }));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let best = -1;
      let dy = 0;
      for (const p of puffs) {
        const v = 1 - Math.hypot(x - p.x, (y - p.y) * 1.2) / p.s;
        if (v > best) {
          best = v;
          dy = (y - p.y) / p.s;
        }
      }
      if (best < 0) continue;
      set(g, x, y, dy < -0.35 ? "W" : dy < 0.2 ? ((x + y) % 2 ? "W" : "L") : "L");
    }
  for (let i = 0; i < 6; i++) set(g, Math.floor(r() * w), Math.floor(r() * (h - 3)), r() < 0.5 ? "W" : "L");
  return out(g);
}
export const FOAM_COLORS: Palette = { W: "#f4fbff", L: "#a8dcf5" };

/** The surface of the sea: rolling crests with foam caps. 20 wide, repeats sideways. */
export function waveTile(): string[] {
  const w = 20;
  const h = 7;
  const g = blank(w, h);
  for (let x = 0; x < w; x++) {
    const top = Math.round(2.2 + Math.sin((2 * Math.PI * x) / w) * 1.5 + Math.sin((4 * Math.PI * x) / w + 1) * 0.6);
    for (let y = top; y < h; y++) {
      const d = y - top;
      const ch = d === 0 ? "C" : d === 1 ? (x % 3 === 0 ? "C" : "L") : d === 2 ? ((x + y) % 2 ? "L" : "W") : y === h - 1 ? "N" : (x + y) % 2 && y === h - 2 ? "N" : "W";
      set(g, x, y, ch);
    }
  }
  return out(g);
}
export const WAVE2_COLORS: Palette = { C: "#e8f7ff", L: "#8fd0ee", W: "#3a8fbf", N: "#1d6a93" };

/** Small ripple glints just under the surface. */
export const RIPPLE = ["LLLL..LL", "..MMMM.."] as const;
export const RIPPLE_COLORS: Palette = { L: "#5aa6d0", M: "#2f80b0" };

/** Sand at the foot of the cliff: dry on top, wet and dark at the waterline. Repeats sideways. */
export function sandTile(seed: number): string[] {
  const r = seeded(seed);
  const w = 24;
  const g = blank(w, 6);
  for (let x = 0; x < w; x++) {
    set(g, x, 0, r() < 0.85 ? "L" : "S");
    set(g, x, 1, r() < 0.3 ? "L" : "S");
    set(g, x, 2, r() < 0.12 ? "p" : "S");
    set(g, x, 3, r() < 0.5 ? "S" : "D");
    set(g, x, 4, "D");
    set(g, x, 5, r() < 0.5 ? "D" : "w");
  }
  for (let i = 0; i < 3; i++) {
    const x = Math.floor(r() * (w - 1));
    set(g, x, 2, "P");
    set(g, x + 1, 2, "P");
    set(g, x, 3, "p");
  }
  return out(g);
}
export const SAND_COLORS: Palette = { L: "#f6dca6", S: "#e9c58a", D: "#c99a62", w: "#a07a5a", p: "#c9a06a", P: "#a08cb0" };
/** Where the beach slopes into the water. */
export const SAND_END = [
  "L.......",
  "SSL.....",
  "SSSSL...",
  "DDSSSSL.",
  "DDDDDDSS",
  "wDwDwDDD",
] as const;

/** A boulder, lit from the upper right. */
export function boulder(w: number, h: number, seed: number): string[] {
  const r = seeded(seed);
  const g = blank(w, h);
  const cx = (w - 1) / 2;
  const bumps = Array.from({ length: w }, (_, x) => Math.sin(x * 0.9 + r() * 6) * 0.6);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const nx = (x - cx) / (w / 2);
      const ny = (h - 1 - y) / h; // 0 bottom .. 1 top
      const top = Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(nx), 2.6))) + bumps[x]! / h;
      if (ny > top) continue;
      const lit = nx * 0.6 + (ny / Math.max(top, 0.01)) * 0.8 + (r() - 0.5) * 0.25;
      set(g, x, y, lit > 0.95 ? "H" : lit > 0.35 ? "B" : lit > -0.1 ? "S" : "D");
    }
  outline(g, "K");
  // flatten the base (it sits in sand or water)
  for (let x = 0; x < w; x++) if (get(g, x, h - 1) === "K" && get(g, x, h - 2) !== ".") set(g, x, h - 1, "D");
  return out(g);
}
export const SEA_ROCK_COLORS: Palette = { H: "#8a6a8e", B: "#634a70", S: "#4b3554", D: "#3a2844", K: "#271b30" };
export const DEEP_ROCK_COLORS: Palette = { H: "#4f6c84", B: "#35506a", S: "#263c54", D: "#1b2c40", K: "#0c1624" };

// ───────────────────────── boat ─────────────────────────

/** A little sailboat: mainsail, jib, pennant, planked hull with lit portholes. */
export function sailboat(): string[] {
  const W = 26;
  const g = blank(W, 22);
  const mx = 12;
  // pennant
  set(g, mx + 1, 0, "F");
  set(g, mx + 2, 0, "F");
  set(g, mx + 3, 0, "f");
  set(g, mx + 1, 1, "F");
  set(g, mx + 2, 1, "f");
  for (let y = 0; y <= 15; y++) set(g, mx, y, "M");
  // mainsail
  for (let y = 2; y <= 14; y++) {
    const wd = 1 + Math.floor((y - 2) * 0.82);
    for (let i = 0; i < wd; i++) {
      const x = mx + 1 + i;
      let ch = "S";
      if (i === wd - 1) ch = "G";
      else if (i === 0) ch = "s";
      else if ((y - 2) % 4 === 3) ch = "s";
      else if (i > wd - 4 && (x + y) % 2) ch = "G";
      set(g, x, y, ch);
    }
  }
  // jib
  for (let y = 5; y <= 14; y++) {
    const wd = 1 + Math.floor((y - 5) * 0.75);
    for (let i = 0; i < wd; i++) set(g, mx - 1 - i, y, i === wd - 1 ? "j" : i === 0 ? "j" : "J");
  }
  // boom
  for (let x = mx; x <= mx + 11; x++) set(g, x, 15, "M");
  // hull
  const hull: [number, number][] = [
    [0, 25],
    [1, 25],
    [1, 24],
    [2, 23],
    [3, 22],
    [5, 21],
  ];
  hull.forEach(([a, b], i) => {
    const y = 16 + i;
    for (let x = a; x <= b; x++) {
      const ch = i === 0 ? "T" : i === 1 ? "W" : i === 2 ? "h" : i === 3 ? "H" : i === 4 ? "D" : "K";
      set(g, x, y, x === a || x === b ? "K" : ch);
    }
  });
  [6, 11, 16].forEach((x) => set(g, x, 19, "P"));
  // the bow rises a touch
  set(g, 25, 15, "K");
  set(g, 24, 15, "T");
  return out(g);
}
export const SAILBOAT_COLORS: Palette = {
  F: "#ff5d5d",
  f: "#c93d4d",
  M: "#5a3420",
  S: "#fff8ec",
  s: "#e6d6cf",
  G: "#ffd9a8",
  J: "#f2e2d4",
  j: "#c9b3c6",
  T: "#c08a5a",
  W: "#f3ead8",
  h: "#d0694c",
  H: "#b5523b",
  D: "#7a2e2a",
  K: "#3a1c22",
  P: "#ffd866",
};

// ───────────────────────── fish and small things ─────────────────────────

/** A fish facing right: shaded body, forked tail, optional dorsal fin and stripes. */
export function fish(len: number, ht: number, opts: { fin?: boolean; stripes?: number[]; tail?: number } = {}): string[] {
  const tailW = opts.tail ?? Math.max(3, Math.round(len * 0.24));
  const top = opts.fin ? 2 : 0;
  const g = blank(len, ht + top);
  const bx0 = tailW - 1;
  const bx1 = len - 1;
  const cx = (bx0 + bx1) / 2 + 0.5;
  const rx = (bx1 - bx0) / 2 + 0.5;
  const cy = top + (ht - 1) / 2;
  const ry = ht / 2;
  for (let y = 0; y < ht + top; y++)
    for (let x = bx0; x <= bx1; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      // blunter head, tapering tail
      const k = dx > 0 ? 2.4 : 1.7;
      if (Math.pow(Math.abs(dx), k) + dy * dy > 1) continue;
      set(g, x, y, dy < -0.38 ? "D" : dy > 0.42 ? "L" : "B");
    }
  for (let x = 0; x < tailW; x++) {
    const spread = ((tailW - x) / tailW) * ry * 1.05 + 0.3;
    for (let y = 0; y < ht + top; y++) {
      const d = Math.abs(y - cy);
      if (d <= spread && !(x < tailW * 0.45 && d < spread * 0.4) && get(g, x, y) === ".") set(g, x, y, "F");
    }
  }
  if (opts.fin) {
    const fx = Math.round(cx - rx * 0.35);
    for (let i = 0; i < Math.max(3, Math.round(rx * 0.7)); i++) {
      set(g, fx + i, top - 1, "F");
      if (i < Math.round(rx * 0.35)) set(g, fx + i, top - 2, "F");
    }
  }
  for (const sx of opts.stripes ?? [])
    for (let y = 0; y < ht + top; y++) if ("DBL".includes(get(g, sx, y))) set(g, sx, y, "S");
  outline(g, "O");
  const ex = bx1 - Math.max(2, Math.round(rx * 0.42));
  const ey = Math.round(cy - ry * 0.25);
  set(g, ex, ey, "E");
  if (ht >= 7) set(g, ex + 1, ey, "E");
  if (ht >= 7 && get(g, ex - 2, ey + 1) !== "O") set(g, ex - 2, ey + 1, "O");
  return out(g);
}
export const FISH_PALETTES = {
  clown: { O: "#7a2414", D: "#e0602a", B: "#ff8a3c", L: "#ffc27a", F: "#e0602a", S: "#fff8ec", E: "#13163f" },
  tang: { O: "#7a4a08", D: "#e8a820", B: "#ffd23c", L: "#fff0a0", F: "#3d6bd1", S: "#fff0a0", E: "#13163f" },
  mackerel: { O: "#1d4a6a", D: "#5a9ac0", B: "#a8d8f0", L: "#eaf8ff", F: "#5a9ac0", S: "#3a74a0", E: "#13163f" },
  deep: { O: "#08162a", D: "#1a3a55", B: "#2c5d7c", L: "#4f86a8", F: "#1a3a55", S: "#1a3a55", E: "#bfe9ff" },
  violet: { O: "#100c2a", D: "#33265a", B: "#4f3c80", L: "#7d64aa", F: "#33265a", S: "#2a1f4a", E: "#ffd866" },
} satisfies Record<string, Palette>;

/** A tiny shoal fish. */
export const MINNOW = ["F.SSS..", "FSSSSSE", "F.LLL.."] as const;
export const MINNOW_COLORS: Palette = { F: "#5fa0c8", S: "#bfe9ff", L: "#8fc8e8", E: "#13163f" };

/** Krill: a little curled shrimp with legs and feelers (faces right). */
export const KRILL = [
  "..........aa",
  "........aa..",
  "t.kkKkKkKKE.",
  "ttKKKKKKKKa.",
  "t..l.l.l.l..",
] as const;
export const KRILL_COLORS: Palette = { k: "#ffd0d8", K: "#ff8098", t: "#ffa6b6", e: "#13163f", l: "#e0607c", a: "#ffc0cc" };

/** Glowing plankton, three sizes. */
export const GLOW_S = [".a.", "aWa", ".a."] as const;
export const GLOW_M = ["..a..", ".aGa.", "aGWGa", ".aGa.", "..a.."] as const;
export const GLOW_DOT = ["W"] as const;
export const GLOW_COLORS: Palette = { W: "#eafff8", G: "#7fffd4", a: "#3fb89a" };

export const BUBBLE_S = [".B.", "BWB", ".B."] as const;
export const BUBBLE_M = [".BB.", "BW.B", "B..B", ".BB."] as const;
export const BUBBLE_COLORS: Palette = { B: "#6fb8dc", W: "#e8f7ff" };

/** A jellyfish: translucent bell, frilled rim, trailing tentacles. */
export const JELLY = [
  "....HHHH....",
  "..HHLLLLHH..",
  ".HLWWLLLLLH.",
  ".HLWLLLLLLH.",
  "HLLLLLLLLLLH",
  "HBBBBBBBBBBH",
  ".HbHbHHbHbH.",
  "..b.t..t.b..",
  "..b.t..t.b..",
  "...b.tt.b...",
  "...b.t..b...",
  "..b..t...b..",
  "..b...t..b..",
  "...b..t.b...",
  "......t.....",
] as const;
export const JELLY_COLORS: Palette = { H: "#c48cff", L: "rgba(214,176,255,0.75)", W: "#f6ecff", B: "#9a6aff", b: "#7a5ad1", t: "#c48cff" };

// ───────────────────────── the sea floor ─────────────────────────

/** A kelp stalk with leaf blades and air bladders, swaying. */
export function kelp2(h: number, seed: number): string[] {
  const r = seeded(seed);
  const w = 13;
  const g = blank(w, h);
  const ph = r() * 6;
  const c = (y: number) => 5 + Math.round(1.8 * Math.sin(y / 7 + ph));
  for (let y = 2; y < h; y++) {
    set(g, c(y), y, "K");
    set(g, c(y) + 1, y, "B");
  }
  let side = r() < 0.5 ? -1 : 1;
  for (let y = 4 + Math.floor(r() * 3); y < h - 4; y += 4 + Math.floor(r() * 3)) {
    const len = 3 + Math.floor(r() * 3);
    const x0 = side < 0 ? c(y) - 1 : c(y) + 2;
    for (let i = 0; i < len; i++) {
      const x = x0 + side * i;
      const yy = y - Math.floor(i / 2);
      set(g, x, yy, i === len - 1 ? "L" : "B");
      if (i < len - 1) set(g, x, yy - 1, i > 0 ? "H" : "L");
      if (i > 0 && i < len - 2) set(g, x, yy + 1, "K");
    }
    set(g, side < 0 ? c(y) - 1 : c(y) + 2, y + 1, "L"); // air bladder
    side = -side;
  }
  // frond tip
  const t = c(2);
  set(g, t, 0, "H");
  set(g, t, 1, "L");
  set(g, t + 1, 1, "L");
  set(g, t + 1, 0, "L");
  return out(g);
}
export const KELP2_COLORS: Palette = { K: "#123f30", B: "#1f6b4f", L: "#2f9a6a", H: "#57c08a" };

/** Branching coral, tips glowing. */
export const BRANCH_CORAL = [
  "..T.....T...T..",
  "..L..T..L...L..",
  "..B..L..B..TB..",
  "T.B..B..B..LB..",
  "L.BB.B.BB..B...",
  "B..B.BBB..BB.T.",
  "BB.BB.B..BB..L.",
  ".B..BBB.BB..BB.",
  ".BB..BBBB..BB..",
  "..BB..BB..BB...",
  "...BBBBBBBB....",
  ".....BBBD......",
  "......BD.......",
  "......BD.......",
  ".....BBDD......",
] as const;

/** A clump of tube coral: lit rims round dark mouths. */
export function tubeCoral(seed: number): string[] {
  const r = seeded(seed);
  const tubes = [
    { x: 0, h: 5 + Math.floor(r() * 3) },
    { x: 3, h: 9 + Math.floor(r() * 3) },
    { x: 7, h: 6 + Math.floor(r() * 3) },
    { x: 10, h: 4 + Math.floor(r() * 2) },
  ];
  const H = Math.max(...tubes.map((t) => t.h)) + 1;
  const g = blank(14, H);
  for (const t of tubes) {
    const top = H - t.h;
    set(g, t.x, top, "L");
    set(g, t.x + 1, top, "K");
    set(g, t.x + 2, top, "L");
    set(g, t.x + 3, top, "D");
    for (let y = top + 1; y < H; y++) {
      set(g, t.x, y, "L");
      set(g, t.x + 1, y, y % 3 === 0 ? "L" : "B");
      set(g, t.x + 2, y, "B");
      set(g, t.x + 3, y, "D");
    }
  }
  return out(g);
}
export const CORAL_PINK: Palette = { D: "#6a2a5a", B: "#a8487a", L: "#e07aa8", T: "#ffb0d0", K: "#3a1434" };
export const CORAL_ORANGE: Palette = { D: "#6a2e2a", B: "#b25a3c", L: "#e88a58", T: "#ffc08a", K: "#3a1a14" };

/** The sea bed: a bumpy sandy crust with pebbles. Repeats sideways. */
export function floorTile(seed: number): string[] {
  const r = seeded(seed);
  const w = 32;
  const h = 12;
  const g = blank(w, h);
  const p = r() * 6;
  for (let x = 0; x < w; x++) {
    const top = Math.round(3 + Math.sin((2 * Math.PI * x * 2) / w + p) * 1.4 + Math.sin((2 * Math.PI * x * 3) / w) * 0.7);
    for (let y = top; y < h; y++) {
      const d = y - top;
      const n = r();
      const ch = d === 0 ? "H" : d === 1 ? (n < 0.35 ? "H" : "B") : d < 5 ? (n < 0.1 ? "S" : "B") : (x + y) % 2 && d < 7 ? "B" : "S";
      set(g, x, y, ch);
    }
  }
  for (let i = 0; i < 5; i++) {
    const x = Math.floor(r() * (w - 2));
    const y = 6 + Math.floor(r() * 4);
    set(g, x, y, "P");
    set(g, x + 1, y, "P");
    set(g, x, y + 1, "K");
    set(g, x + 1, y + 1, "K");
  }
  return out(g);
}
export const FLOOR_COLORS: Palette = { H: "#3a5a70", B: "#24394e", S: "#18293b", P: "#4a6a80", K: "#101d2c" };

export const SHELL = [
  "...OOOOO...",
  "..OHlHlLOO.",
  ".OHlHlLlLlO",
  "OHlHlLlLlLO",
  "OHlLlLlLlLO",
  ".OlLlLlLlO.",
  "..OlLlLlO..",
  "...OOOOO...",
  "..ObbObbO..",
  "...OOOOO...",
] as const;
export const SHELL_COLORS: Palette = { O: "#4a2a3f", H: "#f4c8c8", L: "#d8a0a8", l: "#a8707e", b: "#7a4a5e" };

export const STARFISH = [
  "....O....",
  "...OLO...",
  "OOOOLOOOO",
  "OLLLLLLSO",
  ".OSLLLSO.",
  "..OLSLO..",
  ".OLSOSLO.",
  "OSO...OSO",
] as const;
export const STARFISH_COLORS: Palette = { O: "#5a1f2a", L: "#d8664f", S: "#a8443f" };

/** A rusty anchor, sunk in the sand. */
export const ANCHOR = [
  ".....OOOO....",
  "....OA..OO...",
  "....OO..OO...",
  ".....OOOO....",
  "......OA.....",
  "..OAAAOAAAO..",
  "..OOOOOOOOO..",
  "......OA.....",
  "......OA.....",
  "......OA.....",
  "......OA.....",
  "......OA.....",
  "OA....OA....O",
  "OAA...OA...AO",
  ".OAA..OA..AO.",
  "..OOAAOAAOO..",
  "....OOOOO....",
] as const;
export const ANCHOR_COLORS: Palette = { O: "#3a2a30", A: "#7a5a4a" };

// ───────────────────────── creekside ─────────────────────────

/** Grass on top of the cliff, with tufts above and roots dripping into the rock. Repeats sideways. */
export function grassTile(seed: number): string[] {
  const r = seeded(seed);
  const w = 24;
  const g = blank(w, 7);
  for (let x = 0; x < w; x++) {
    if (r() < 0.3) set(g, x, 0, "g");
    set(g, x, 1, r() < 0.45 || get(g, x, 0) === "g" ? "g" : "G");
    set(g, x, 2, r() < 0.2 ? "g" : "G");
    set(g, x, 3, r() < 0.3 ? "M" : "G");
    set(g, x, 4, r() < 0.7 ? "M" : "d");
    set(g, x, 5, r() < 0.4 ? "M" : "d");
    if (r() < 0.25) set(g, x, 6, "M");
  }
  for (let i = 0; i < 3; i++) set(g, Math.floor(r() * w), 1, r() < 0.5 ? "F" : "Y");
  return out(g);
}
export const GRASS_COLORS: Palette = { g: "#8fd16f", G: "#4f9a5a", M: "#2f6b45", d: "#3a2a3a", F: "#ffb0c8", Y: "#ffe27a" };

/** The creek on the cliff top: bright ripples flowing towards the falls. 20 wide, repeats sideways. */
export function creekTile(): string[] {
  const w = 20;
  const rows = ["KKKKKKKKKKKKKKKKKKKK", "", "", "", "dddddddddddddddddddd"];
  const g = rows.map((r) => (r ? [...r] : Array<string>(w).fill("M")));
  for (let x = 0; x < w; x++) {
    if (x % 10 < 4) set(g, x, 1, "L");
    if ((x + 5) % 10 < 3) set(g, x, 2, "W");
    if ((x + 2) % 7 === 0) set(g, x, 3, "L");
  }
  return out(g);
}
export const CREEK_COLORS: Palette = { K: "#2f6b45", W: "#f4fbff", L: "#bfe9ff", M: "#5fb3dc", d: "#2b6f9e" };

/** The creek tipping over the edge of the cliff. */
export const CREEK_LIP = [
  "LLWWLLLL..",
  "MLLWWLLLM.",
  "EMLLWLLME.",
  "EMMLLLLME.",
] as const;
export const CREEK_LIP_COLORS: Palette = { ...FALL_COLORS };

/** A round puff of smoke lit from the right. */
export function puff(d: number): string[] {
  const g = blank(d, d);
  const c = (d - 1) / 2;
  for (let y = 0; y < d; y++)
    for (let x = 0; x < d; x++) {
      const dx = x - c;
      const dy = y - c;
      if (Math.hypot(dx, dy) > d / 2 - 0.1) continue;
      const lit = (dx * 0.7 - dy * 0.7) / (d / 2);
      set(g, x, y, lit > 0.35 ? "H" : lit > -0.3 ? "B" : "S");
    }
  return out(g);
}
export const PUFF_COLORS: Palette = { H: "#fff4ee", B: "#e4d8ec", S: "#b9a6cf" };

/** A fluffy cloud: overlapping domes on a flat base, warm on top, lilac beneath. */
export function cloud(w: number, h: number, seed: number): string[] {
  const r = seeded(seed);
  const g = blank(w, h);
  // a big dome in the middle, smaller ones either side
  const spec = [
    [0.14, 0.42],
    [0.34, 0.75],
    [0.55, 1],
    [0.8, 0.6],
  ];
  const domes = spec.map(([t, k]) => {
    const s = (h - 1) * k! * (0.9 + r() * 0.15);
    return { x: t! * (w - 1) + (r() - 0.5) * 2, y: h - 1, s: Math.min(s, h - 1) };
  });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let best = -1;
      let nx = 0;
      let ny = 0;
      for (const d of domes) {
        const v = 1 - Math.hypot((x - d.x) * 0.9, y - d.y) / d.s;
        if (v > best) {
          best = v;
          nx = ((x - d.x) * 0.9) / d.s;
          ny = (y - d.y) / d.s;
        }
      }
      if (best < 0) continue;
      const lit = -ny + nx * 0.25;
      let ch = lit > 0.6 ? "H" : lit > 0.2 ? "B" : "S";
      if (y === h - 1) ch = "U";
      set(g, x, y, ch);
    }
  return out(g);
}
export const CLOUD2_COLORS: Palette = { H: "#fff4ee", B: "#f7dcea", S: "#d6bde4", U: "#b8a0d8" };

export const GULL = ["bB.....Bb", "..BB.BB..", "....B...."] as const;
export const GULL_COLORS: Palette = { B: "#2a2448", b: "#4a3f6e" };

/**
 * A town building: shaded walls (lit on the sun side), floors with trim, a grid
 * of windows (some lit), a door, and a flat, peaked or stepped roof.
 */
export function townHouse(w: number, floors: number, seed: number, roof: "flat" | "peak" | "step"): string[] {
  const r = seeded(seed);
  const floorH = 7;
  const wallH = floors * floorH + 2;
  const roofH = roof === "flat" ? 4 : roof === "step" ? 7 : Math.ceil(w / 2) + 1;
  const H = roofH + wallH;
  const g = blank(w, H);
  // walls
  for (let y = roofH; y < H; y++)
    for (let x = 0; x < w; x++) {
      let ch = x === 0 ? "N" : x === w - 1 ? "L" : x === w - 2 && (x + y) % 2 ? "L" : "B";
      if (y === roofH) ch = "N"; // shadow under the eaves
      set(g, x, y, ch);
    }
  rect(g, 0, H - 1, w, 1, "N");
  // floor trim and windows
  const cols = Math.max(1, Math.floor((w - 2) / 5));
  const span = cols * 5 - 2;
  const x0 = Math.floor((w - span) / 2);
  for (let f = 0; f < floors; f++) {
    const top = roofH + 1 + f * floorH;
    if (f > 0) rect(g, 0, top - 1, w, 1, "C");
    if (f === floors - 1) {
      // ground floor: a door and maybe a shop window
      const dx = Math.floor(w / 2) - 2;
      rect(g, dx - 1, top + 1, 6, 1, "C");
      rect(g, dx, top + 2, 4, floorH - 1, "D");
      rect(g, dx + 3, top + 2, 1, floorH - 1, "d");
      set(g, dx + 2, top + 4, "Y");
      if (w >= 16) {
        const sx = dx > w / 2 ? 1 : dx + 5;
        if (sx + 3 < w - 1) {
          rect(g, sx, top + 2, 3, 3, r() < 0.7 ? "Y" : "K");
          rect(g, sx, top + 5, 3, 1, "C");
        }
      }
      continue;
    }
    for (let c = 0; c < cols; c++) {
      const wx = x0 + c * 5;
      const lit = r() < 0.5;
      rect(g, wx, top + 1, 3, 4, lit ? "Y" : "K");
      set(g, wx, top + 1, lit ? "y" : "R");
      if (lit && r() < 0.4) set(g, wx + 2, top + 1, "k"); // a curtain
      rect(g, wx - 1, top + 5, 5, 1, "C");
    }
  }
  // roofs
  if (roof === "flat") {
    rect(g, 0, roofH - 2, w, 2, "T");
    rect(g, 0, roofH - 2, w, 1, "U");
    rect(g, 0, roofH - 1, w, 1, "O");
    if (r() < 0.6) {
      const cx = 2 + Math.floor(r() * (w - 6));
      rect(g, cx, 0, 3, 2, "T");
      rect(g, cx, 0, 3, 1, "U");
    } else {
      set(g, w - 3, 0, "O");
      set(g, w - 3, 1, "O");
    }
  } else if (roof === "peak") {
    const c = (w - 1) / 2;
    for (let y = 0; y < roofH; y++)
      for (let x = 0; x < w; x++) {
        const d = Math.abs(x - c);
        if (d > y + 0.5) continue;
        const edge = d > y - 0.5;
        const tile = (y % 2 === 0 && y > 0) || (x + (y % 4 < 2 ? 0 : 2)) % 4 === 0;
        set(g, x, y, edge ? (x > c ? "U" : "O") : tile ? "t" : "T");
      }
    rect(g, 0, roofH - 1, w, 1, "O");
    if (w >= 14) {
      const ax = Math.round(c) - 1;
      rect(g, ax, roofH - 5, 2, 2, r() < 0.6 ? "Y" : "K");
    }
  } else {
    // stepped gable, in the wall colour with trim on each step
    for (let s = 0; s < 3; s++) {
      const inset = 1 + s * 2;
      const y = roofH - 2 - s * 2;
      rect(g, inset, y, w - inset * 2, 2, "B");
      rect(g, inset, y, w - inset * 2, 1, "C");
      set(g, w - inset - 1, y + 1, "L");
    }
    rect(g, 0, roofH - 1, w, 1, "C");
    set(g, Math.floor(w / 2) - 1, roofH - 4, "Y");
    set(g, Math.floor(w / 2), roofH - 4, "Y");
  }
  return out(g);
}
export const TOWN_PALETTES: Palette[] = [
  { T: "#3b2f63", t: "#2f2550", U: "#5a4a8a", O: "#221b3e", B: "#6c5a9e", L: "#8f7cc0", N: "#54458a", C: "#9a8ac8" },
  { T: "#5b3f5e", t: "#46304a", U: "#7d5a7e", O: "#2e1f33", B: "#8a6a8e", L: "#ae8cae", N: "#6d5272", C: "#c4a8c0" },
  { T: "#2f3a6b", t: "#252e58", U: "#4a5a96", O: "#1a2040", B: "#5a6aa8", L: "#7e8ecc", N: "#46558a", C: "#a2b0dc" },
  { T: "#7a3a44", t: "#5e2a34", U: "#a05a5e", O: "#3a1c22", B: "#c08a6a", L: "#e0aa84", N: "#9a6a54", C: "#ecd2a8" },
].map((p) => ({ ...p, Y: "#ffd866", y: "#fff1a8", k: "#e8a040", K: "#2a2448", R: "#4a4a7a", D: "#5a3420", d: "#3a2014" }));

/** The chapel: a bell tower with a gold bell and cross, a nave with glowing arched windows. */
export function chapel(): string[] {
  const W = 26;
  const H = 62;
  const g = blank(W, H);
  const cx = 12; // tower centre is cx..cx+1
  // cross
  rect(g, cx, 0, 2, 6, "G");
  rect(g, cx - 2, 2, 6, 2, "G");
  set(g, cx + 1, 0, "g");
  // spire
  for (let y = 6; y < 18; y++) {
    const half = Math.floor((y - 6) / 2.2);
    for (let x = cx - half; x <= cx + 1 + half; x++) set(g, x, y, x <= cx ? "T" : x === cx + 1 + half ? "U" : "t");
    set(g, cx - half, y, "O");
  }
  rect(g, cx - 5, 18, 12, 1, "O");
  // belfry with the bell
  rect(g, cx - 4, 19, 10, 10, "W");
  rect(g, cx - 4, 19, 1, 10, "w");
  rect(g, cx + 5, 19, 1, 10, "V");
  rect(g, cx - 2, 21, 6, 7, "K");
  set(g, cx - 2, 21, "W");
  set(g, cx + 3, 21, "W");
  rect(g, cx, 22, 2, 1, "M");
  rect(g, cx - 1, 23, 4, 3, "B");
  rect(g, cx + 2, 23, 1, 3, "b");
  set(g, cx - 1, 23, "M");
  rect(g, cx - 2, 26, 6, 1, "B");
  rect(g, cx + 2, 26, 2, 1, "b");
  rect(g, cx - 5, 29, 12, 1, "C");
  // tower body with a round window
  rect(g, cx - 4, 30, 10, 8, "W");
  rect(g, cx - 4, 30, 1, 8, "w");
  rect(g, cx + 5, 30, 1, 8, "V");
  const rose = [".PY.", "PYYB", "BYYP", ".BP."];
  rose.forEach((row, j) => [...row].forEach((ch, i) => ch !== "." && set(g, cx - 1 + i, 32 + j, ch)));
  // nave roof
  for (let y = 36; y < 42; y++) {
    const half = 7 + (y - 36) * 2;
    for (let x = cx - half; x <= cx + 1 + half; x++) if (x >= 0 && x < W) set(g, x, y, x > cx + 1 + half - 2 ? "U" : (x + y) % 3 === 0 ? "t" : "T");
  }
  rect(g, 0, 42, W, 1, "O");
  // nave
  rect(g, 1, 43, W - 2, H - 43, "W");
  rect(g, 1, 43, W - 2, 1, "w");
  rect(g, 1, 43, 1, H - 43, "w");
  rect(g, W - 2, 43, 1, H - 43, "V");
  rect(g, 0, H - 1, W, 1, "C");
  // arched windows
  for (const wx of [3, 20]) {
    set(g, wx + 1, 46, "Y");
    rect(g, wx, 47, 3, 6, "Y");
    set(g, wx + 1, 49, "P");
    set(g, wx + 1, 51, "B");
    set(g, wx, 47, "y");
    rect(g, wx - 1, 53, 5, 1, "C");
  }
  // arched door
  rect(g, cx - 2, 49, 6, H - 50, "D");
  rect(g, cx - 1, 48, 4, 1, "D");
  rect(g, cx, 49, 1, H - 50, "d");
  rect(g, cx + 3, 49, 1, H - 50, "d");
  set(g, cx + 2, 54, "G");
  rect(g, cx - 3, H - 1, 8, 1, "S");
  return out(g);
}
export const CHAPEL2_COLORS: Palette = {
  G: "#ffd866",
  g: "#fff1a8",
  M: "#fff1a8",
  B: "#e8a830",
  b: "#a8641c",
  T: "#5b4a8a",
  t: "#4a3c74",
  U: "#7d6cb0",
  O: "#2a2448",
  W: "#f3ead8",
  w: "#cfc0d8",
  V: "#fffaf0",
  K: "#2a2448",
  C: "#b8a8c8",
  Y: "#ffd866",
  y: "#fff1a8",
  P: "#ff8aa8",
  D: "#5a3420",
  d: "#3a2014",
  S: "#9a8aa8",
};

/** The creek house: timber-framed walls, tiled roof, brick chimney, lit windows, flower box. */
export function creekHouse(): string[] {
  const W = 36;
  const H = 30;
  const g = blank(W, H);
  // chimney (behind the roof)
  rect(g, 25, 2, 4, 12, "b");
  for (let y = 2; y < 14; y++) for (let x = 25; x < 29; x++) if ((y % 2 === 0 && x === 26) || (y % 2 === 1 && x === 28)) set(g, x, y, "c");
  for (let y = 3; y < 14; y += 2) rect(g, 25, y, 4, 1, (y / 2) % 2 ? "c" : "b");
  rect(g, 24, 0, 6, 2, "O");
  rect(g, 25, 0, 4, 1, "s");
  // roof
  const apex = 17.5;
  for (let y = 4; y < 16; y++) {
    const half = (y - 4) * 1.45 + 1.5;
    for (let x = 0; x < W; x++) {
      const d = Math.abs(x - apex);
      if (d > half) continue;
      const edge = d > half - 1;
      const tile = (y - 4) % 3 === 2 ? "r" : (x + Math.floor((y - 4) / 3) * 2) % 4 === 0 ? "r" : "R";
      set(g, x, y, edge ? (x > apex ? "U" : "O") : x > apex + half - 3 && tile === "R" ? "U" : tile);
    }
  }
  rect(g, 0, 15, W, 1, "O");
  // walls with timber frame
  rect(g, 3, 16, 30, 13, "W");
  rect(g, 3, 16, 30, 1, "w");
  rect(g, 3, 16, 1, 13, "T");
  rect(g, 32, 16, 1, 13, "T");
  rect(g, 3, 22, 30, 1, "T");
  rect(g, 18, 16, 1, 6, "T");
  rect(g, 31, 17, 1, 12, "V");
  // gable window in the roof
  rect(g, 16, 9, 4, 3, "F");
  rect(g, 17, 10, 2, 1, "Y");
  // left window with flower box
  rect(g, 6, 17, 8, 7, "F");
  rect(g, 7, 18, 6, 5, "Y");
  rect(g, 7, 18, 2, 1, "y");
  rect(g, 7, 20, 6, 1, "F");
  rect(g, 9, 18, 1, 5, "F");
  rect(g, 5, 24, 10, 2, "G");
  for (const fx of [6, 8, 11, 13]) set(g, fx, 24, "P");
  set(g, 10, 24, "Y");
  // door
  rect(g, 21, 19, 6, 10, "D");
  rect(g, 22, 18, 4, 1, "D");
  rect(g, 23, 19, 1, 10, "d");
  rect(g, 26, 19, 1, 10, "d");
  set(g, 25, 24, "Y");
  set(g, 22, 18, "T");
  set(g, 25, 18, "T");
  // small round window by the door
  rect(g, 28, 18, 3, 3, "F");
  set(g, 29, 19, "Y");
  // stone footing and step
  rect(g, 2, 29, 32, 1, "S");
  for (let x = 3; x < 33; x += 4) set(g, x, 29, "s");
  rect(g, 20, 29, 8, 1, "s");
  return out(g);
}
export const CREEK_HOUSE2_COLORS: Palette = {
  O: "#3a1c2a",
  R: "#8a3344",
  r: "#6a2434",
  U: "#b0505a",
  b: "#7a3a3a",
  c: "#5a2a2e",
  s: "#a89aa8",
  W: "#e0b078",
  w: "#b88a5a",
  V: "#f4cc94",
  T: "#6a3a2a",
  F: "#5a3420",
  Y: "#ffd866",
  y: "#fff1a8",
  G: "#3f8a50",
  P: "#ff8aa8",
  D: "#7a4a2a",
  d: "#5a3420",
  S: "#7a6a7a",
};

/** A round tree: clumps of leaves lit from the right, on a short trunk. */
export function tree(w: number, h: number, seed: number): string[] {
  const r = seeded(seed);
  const g = blank(w, h);
  const trunkH = Math.round(h * 0.3);
  const ch = h - trunkH + 1;
  const clumps = Array.from({ length: 6 }, () => {
    const a = r() * Math.PI * 2;
    const d = r() * 0.4;
    return { x: (w - 1) / 2 + Math.cos(a) * d * w * 0.5, y: ch / 2 + Math.sin(a) * d * ch * 0.5, s: Math.min(w, ch) * (0.28 + r() * 0.12) };
  });
  clumps.push({ x: (w - 1) / 2, y: ch / 2, s: Math.min(w, ch) * 0.42 });
  const tx = Math.floor(w / 2) - 1;
  rect(g, tx, h - trunkH, 2, trunkH, "t");
  rect(g, tx + 1, h - trunkH, 1, trunkH, "T");
  set(g, tx - 1, h - 1, "t");
  set(g, tx + 2, h - 1, "T");
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < w; x++) {
      let best = -1;
      let lx = 0;
      let ly = 0;
      for (const c of clumps) {
        const v = 1 - Math.hypot(x - c.x, y - c.y) / c.s;
        if (v > best) {
          best = v;
          lx = (x - c.x) / c.s;
          ly = (y - c.y) / c.s;
        }
      }
      if (best < 0) continue;
      const global = (x - (w - 1) / 2) / w - (y - ch / 2) / ch;
      const lit = lx * 0.5 - ly * 0.6 + global * 0.9;
      set(g, x, y, lit > 0.55 ? "H" : lit > 0.05 ? "B" : lit > -0.45 ? "S" : "D");
    }
  outline(g, "D", "tT");
  return out(g);
}
export const TREE_COLORS: Palette = { H: "#9ad66e", B: "#5aa65a", S: "#3a7a4a", D: "#24503a", T: "#7a4a34", t: "#4a2a24" };

/** A street lamp with a warm glow. */
export const LAMP = [
  "..hhh..",
  ".hOOOh.",
  "hOYWYOh",
  "hOYYYOh",
  ".hOOOh.",
  "..hKh..",
  "...K...",
  "...K...",
  "...K...",
  "...K...",
  "...K...",
  "...K...",
  "...K...",
  "...K...",
  "..KKK..",
  ".KKKKK.",
] as const;
export const LAMP_COLORS: Palette = { h: "rgba(255,216,102,0.35)", O: "#2a2448", Y: "#ffd866", W: "#fff8ec", K: "#2a2448" };

export const FENCE = [
  "P....P....P....P",
  "PRRRRPRRRRPRRRRP",
  "P....P....P....P",
  "PRRRRPRRRRPRRRRP",
  "P....P....P....P",
] as const;
export const FENCE_COLORS: Palette = { P: "#5a3420", R: "#a0704a" };

/** The grassy lip where the cliff top meets the edge. */
export const GRASS_CAP = [
  "gg....",
  "GgG...",
  "GGgK..",
  "MGGK..",
  "MMGK..",
  "MMMK..",
  "M.MK..",
  "..M...",
] as const;

export const TUFT = ["g.g.g", ".gGg.", "GGMGG"] as const;
export const BUSH = ["..gggG...", ".gHHgGG..", "gHgGGGGM.", "GGGGGMGMM", ".MMMMMMM."] as const;
export const BUSH_COLORS: Palette = { H: "#c8f08a", g: "#8fd16f", G: "#4f9a5a", M: "#2f6b45", F: "#ffb0c8" };
