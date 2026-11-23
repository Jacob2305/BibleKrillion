/**
 * Pixel art for the open sky (Schooler) and the edge of space (Rare), all
 * original to this project. One art pixel = one `--px`. Most of it is
 * generated from simple maths (shaded spheres, puffs, curtains) so it stays
 * crisp, with flat colour ramps of 3–5 shades per material.
 */
import type { Palette } from "../pixel";
import { seeded } from "./art";

// ───────────────────────── helpers ─────────────────────────

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
/** Flat mix of two colours (`k` = 0 → a, 1 → b). */
export function mix(a: string, b: string, k: number): string {
  const A = hex(a);
  const B = hex(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i]! - v) * k).toString(16).padStart(2, "0")).join("");
}

/** 4×4 ordered-dither threshold in [-0.5, 0.5). */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)]! / 16 - 0.47;

/** A mutable character grid. */
class Grid {
  rows: string[][];
  constructor(
    public w: number,
    public h: number,
  ) {
    this.rows = Array.from({ length: h }, () => Array<string>(w).fill("."));
  }
  set(x: number, y: number, c: string) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.rows[y]![x] = c;
  }
  get(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.rows[y]![x]! : ".";
  }
  rect(x: number, y: number, w: number, h: number, c: string) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  out() {
    return this.rows.map((r) => r.join(""));
  }
}

/**
 * A pixel grid as a crisp SVG data URL. Runs of one colour merge across a row,
 * and identical runs stacked in consecutive rows merge into one taller rect
 * (so vertical aurora rays stay cheap). It's an image, so it adds no DOM nodes.
 */
export function gridUrl(art: readonly string[], palette: Palette): string {
  const w = Math.max(...art.map((r) => r.length));
  type R = { x: number; y: number; w: number; h: number; f: string };
  const rects: R[] = [];
  let open = new Map<string, R>();
  art.forEach((row, y) => {
    const next = new Map<string, R>();
    let x = 0;
    while (x < row.length) {
      const f = palette[row[x]!];
      let end = x + 1;
      while (end < row.length && row[end] === row[x]) end++;
      if (f) {
        const key = `${x},${end - x},${f}`;
        const prev = open.get(key);
        if (prev) {
          prev.h++;
          next.set(key, prev);
        } else {
          const r = { x, y, w: end - x, h: 1, f };
          rects.push(r);
          next.set(key, r);
        }
      }
      x = end;
    }
    open = next;
  });
  const body = rects.map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.f}"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${art.length}" width="${w}" height="${art.length}" preserveAspectRatio="none" shape-rendering="crispEdges">${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// ───────────────────────── Schooler: open sky ─────────────────────────

const SHADOW = "#3b2a6e";
const DEEP = "#1f1544";

/** Hand-tuned hue-shifted ramps (highlight, base, shadow, dark edge) for the balloon fabrics. */
const RAMPS: Record<string, string[]> = {
  "#e8505b": ["#ff8a80", "#e8505b", "#b0305a", "#6a1f4a"],
  "#ffd866": ["#fff1b8", "#ffd866", "#f0a040", "#a8583a"],
  "#3d6bd1": ["#8fb3ff", "#3d6bd1", "#2a4396", "#1c2560"],
  "#7fd6c0": ["#c8fff0", "#7fd6c0", "#3f9aa8", "#2a5a7a"],
  "#fff8ec": ["#ffffff", "#fff8ec", "#cfc6ee", "#8a7cc0"],
  "#ff7a6b": ["#ffb0a0", "#ff7a6b", "#d04a62", "#7a2a50"],
  "#ff9ac0": ["#ffd0e4", "#ff9ac0", "#d0609a", "#7a3070"],
  "#ffbf3c": ["#ffe08a", "#ffbf3c", "#e07a30", "#8a4030"],
  "#8a5ad6": ["#b89af0", "#8a5ad6", "#5e3aa8", "#33206a"],
  "#4fb8e0": ["#a8e4ff", "#4fb8e0", "#2f7fb8", "#1f4a80"],
  "#6a8ae8": ["#a8c0ff", "#6a8ae8", "#4458b8", "#252f78"],
  "#fff1b8": ["#ffffff", "#fff1b8", "#f0c878", "#a87a50"],
};
function ramp(base: string, haze: number, sky: string): string[] {
  const r = RAMPS[base] ?? [mix(base, "#fff8ec", 0.38), base, mix(base, SHADOW, 0.32), mix(base, DEEP, 0.58)];
  return r.map((c) => mix(c, sky, haze));
}

export type BalloonPattern = "gores" | "bands" | "chevron" | "patched" | "diamond" | "spiral";

/**
 * A hot air balloon `w` pixels wide: a shaded teardrop envelope (light from the
 * top left) with a pattern, skirt, ropes, burner flame and a woven basket.
 * `haze` fades it into the sky so small (far) ones sit further back.
 */
export function balloon(w: number, pattern: BalloonPattern, colors: [string, string, string], opts: { haze?: number; sky?: string; seed?: number } = {}) {
  const haze = opts.haze ?? 0;
  const sky = opts.sky ?? "#7a6cc0";
  const rand = seeded(opts.seed ?? w * 7 + 3);
  const R = w / 2;
  const cy = R; // centre of the round crown
  const L = Math.round(R * 1.05); // taper length below the crown centre
  const m = Math.max(1, Math.round(R * 0.27)); // mouth half-width
  const envH = Math.round(cy + L);
  const skirtH = w >= 16 ? 2 : 1;
  const ropeH = Math.max(2, Math.round(R * 0.5));
  const bw = Math.max(1, Math.round(m * 0.95)); // basket half-width
  const bh = Math.max(2, Math.round(R * 0.32));
  const H = envH + skirtH + ropeH + bh;
  const g = new Grid(w, H);
  const mats = ["abcd", "efgh", "ijkl"];
  const gores = w >= 26 ? 10 : w >= 16 ? 8 : 6;
  const patches = new Set<string>();
  for (let i = 0; i < 5; i++) patches.add(`${Math.floor(rand() * gores)},${1 + Math.floor(rand() * 4)}`);

  const halfW = (y: number) => {
    const dy = y + 0.5 - cy;
    if (dy < 0) return R * Math.sqrt(Math.max(0, 1 - (dy / R) ** 2));
    const t = Math.min(1, dy / L);
    return m + (R - m) * Math.pow(1 - t * t, 0.85);
  };
  const inside = (x: number, y: number) => y >= 0 && y < envH && Math.abs(x + 0.5 - w / 2) < halfW(y);
  const goreAt = (x: number, y: number) => {
    const nx = Math.max(-1, Math.min(1, (x + 0.5 - w / 2) / halfW(y)));
    const u = (Math.asin(nx) / Math.PI + 0.5) * gores;
    return { gi: Math.min(gores - 1, Math.floor(u)), f: u - Math.floor(u), nx };
  };

  for (let y = 0; y < envH; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      const { gi, f, nx } = goreAt(x, y);
      const dy = y + 0.5 - cy;
      const v = y / envH;
      const ny = dy < 0 ? dy / R : 0.15 + 0.55 * Math.min(1, dy / L);
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny * 0.7));
      let light = -0.5 * nx - 0.45 * ny + 0.7 * nz;
      light += bayer(x, y) * 0.09;
      let shade = light > 0.75 ? 0 : light > 0.25 ? 1 : light > -0.32 ? 2 : 3;

      let mat = 0;
      const band = Math.floor(v * 6);
      switch (pattern) {
        case "gores":
          mat = gi % 2;
          if (v < 0.1) mat = 2;
          break;
        case "bands":
          mat = v < 0.16 ? 2 : [0, 1, 0, 2, 1, 0][band] ?? 0;
          if (Math.abs(v - 0.5) < 0.04) mat = 2;
          break;
        case "chevron": {
          const s = v * 7 - Math.abs(f - 0.5) * 1.4;
          mat = v < 0.12 ? 2 : Math.floor(s + 7) % 2;
          if (v > 0.78) mat = 2;
          break;
        }
        case "patched":
          mat = gi % 2;
          if (patches.has(`${gi},${band}`)) mat = 2;
          break;
        case "diamond": {
          mat = gi % 2 ? 1 : 0;
          const d = Math.abs(f - 0.5) * 2 + Math.abs(v - 0.46) / 0.09;
          if (d < 1) mat = 2;
          else if (v > 0.37 && v < 0.55) mat = 0;
          if (v < 0.1) mat = 2;
          break;
        }
        case "spiral": {
          const s = gi + v * 5;
          mat = Math.floor(s) % 3;
          break;
        }
      }
      // gore seams: a thin darker line where one panel meets the next
      if (w >= 18 && pattern !== "gores" && f < 0.12 && v > 0.08 && v < 0.92) shade = Math.min(3, shade + 1);
      // selective outline: dark on the shadow side, none on the lit side
      const edge = !inside(x + 1, y) || !inside(x, y + 1) || !inside(x - 1, y) || !inside(x, y - 1);
      if (edge && (x + 0.5 > w / 2 || dy > R * 0.4)) shade = 3;
      if (edge && shade === 0) shade = 1;
      g.set(x, y, mats[mat]![shade]!);
    }
  }
  // skirt (mouth) in the darkest panel colour
  const cx0 = Math.floor(w / 2);
  for (let j = 0; j < skirtH; j++) {
    const hw = Math.max(1, m - j);
    for (let x = cx0 - hw; x < cx0 + hw + (w % 2); x++) g.set(x, envH + j, x < cx0 ? "c" : "d");
  }
  // ropes from the skirt to the basket corners, burner + flame in the middle
  const top = envH + skirtH;
  for (let j = 0; j < ropeH; j++) {
    const t = ropeH === 1 ? 1 : j / (ropeH - 1);
    const lx = Math.round(cx0 - m + (m - bw) * t);
    const rx = Math.round(cx0 + m - 1 + (w % 2) - (m - bw) * t);
    g.set(lx, top + j, "R");
    g.set(rx, top + j, "R");
    if (w >= 24 && j > 0) {
      g.set(Math.round(cx0 - m / 2 + ((m - bw) * t) / 2), top + j, "r");
      g.set(Math.round(cx0 + m / 2 - 1 + (w % 2) - ((m - bw) * t) / 2), top + j, "r");
    }
  }
  if (w >= 12) {
    const fx = cx0 - (w % 2 ? 0 : 1);
    const fw = w % 2 ? 1 : 2;
    g.rect(fx, top - 1, fw, 1, "Y");
    if (ropeH >= 3) g.rect(fx, top, fw, 1, "O");
    g.rect(fx, top + ropeH - 1, fw, 1, "M");
  }
  // woven basket: rim, staggered weave, shaded right side, dark base
  const bx = cx0 - bw;
  const bW = bw * 2 + (w % 2);
  const by = top + ropeH;
  for (let j = 0; j < bh; j++) {
    for (let i = 0; i < bW; i++) {
      let c = ((i + (j % 2) * 2) % 4 < 2 ? "W" : "w");
      if (j === 0) c = "K";
      else if (j === bh - 1) c = "k";
      else if (i === bW - 1 && bW > 2) c = "k";
      else if (i === 0 && bW > 3) c = "W";
      g.set(bx + i, by + j, c);
    }
  }
  const pal: Palette = {};
  colors.forEach((c, i) => ramp(c, haze, sky).forEach((s, k) => (pal[mats[i]![k]!] = s)));
  Object.assign(pal, {
    R: mix("#4a3a5a", sky, haze),
    r: mix("#6a5a7a", sky, haze),
    Y: mix("#fff1b8", sky, haze * 0.5),
    O: mix("#ff9a3c", sky, haze * 0.5),
    M: mix("#5a5a78", sky, haze),
    K: mix("#5a3520", sky, haze),
    W: mix("#c98a4a", sky, haze),
    w: mix("#9a6334", sky, haze),
    k: mix("#6a4024", sky, haze),
  });
  return { art: g.out(), palette: pal };
}

/**
 * A cloud `w`×`h`: overlapping round puffs on a flat base. Lower puffs sit in
 * front; the puffs behind are shaded where the front ones overlap them, the
 * tops catch the light and the flat underside is lavender.
 */
export function cloud(w: number, h: number, seed: number): string[] {
  const r = seeded(seed);
  const base = h - 1;
  const n = Math.max(2, Math.round(w / 15) + 1);
  const puffs = Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const bell = Math.sin(Math.PI * (0.15 + 0.7 * t));
    const rad = Math.max(3, h * (0.28 + 0.32 * bell) * (0.75 + r() * 0.45));
    const cx = 2 + rad * 0.7 + t * (w - 4 - rad * 1.4) + (r() - 0.5) * 3;
    const cy = Math.max(rad + 0.5, base - rad * (0.5 + r() * 0.4));
    return { cx: Math.min(w - rad, Math.max(rad, cx)), cy, rad };
  });
  // a row of small front puffs along the base joins it all into one body
  const fr = Math.max(2.5, h * 0.24);
  const nf = Math.max(2, Math.ceil((w - 2 * fr) / (fr * 1.5)));
  for (let i = 0; i <= nf; i++) {
    const rad = fr * (0.85 + r() * 0.3);
    puffs.push({ cx: fr + ((w - 2 * fr) * i) / nf + (r() - 0.5) * 2, cy: base - rad * 0.25, rad });
  }
  puffs.sort((a, b) => a.cy - b.cy); // higher puffs behind
  const owner = (x: number, y: number) => {
    if (y > base || y < 0 || x < 0 || x >= w) return -1;
    let o = -1;
    puffs.forEach((p, i) => {
      if ((x + 0.5 - p.cx) ** 2 + (y + 0.5 - p.cy) ** 2 <= p.rad * p.rad) o = i;
    });
    return o;
  };
  const own = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => owner(x, y)));
  const at = (x: number, y: number) => (y >= 0 && y < h && x >= 0 && x < w ? own[y]![x]! : -1);
  const top = Math.min(...puffs.map((p) => p.cy - p.rad));
  return own.map((row, y) =>
    row
      .map((o, x) => {
        if (o < 0) return ".";
        const p = puffs[o]!;
        const nx = (x + 0.5 - p.cx) / p.rad;
        const ny = (y + 0.5 - p.cy) / p.rad;
        const v = (y - top) / (base - top);
        // mostly lit from above, a little roundness per puff
        let l = 1.1 - 1.2 * v - 0.38 * ny - 0.15 * nx + bayer(x, y) * 0.08;
        // the puff behind is shaded just above a puff in front…
        const below1 = at(x, y + 1);
        const below2 = at(x, y + 2);
        if (below1 > o) l -= 0.4;
        else if (below2 > o) l -= 0.18;
        // …and the front puff's top edge catches the light
        const above = at(x, y - 1);
        if (above >= 0 && above < o) l += 0.15;
        if (y === base) return "D";
        if (y === base - 1) return "S";
        // dark edge on the underside silhouette
        if (at(x, y + 1) < 0) return "D";
        return l > 1.0 ? "H" : l > 0.55 ? "C" : l > 0.25 ? "M" : l > -0.05 ? "S" : "D";
      })
      .join(""),
  );
}
export function cloudPalette(haze: number, sky: string): Palette {
  const p = { H: "#ffffff", C: "#fff8ec", M: "#f1e3f2", S: "#cdbfec", D: "#a493d6" };
  return Object.fromEntries(Object.entries(p).map(([k, c]) => [k, mix(c, sky, haze)]));
}

/** A small dove in flight, two frames (same size). Faces right. */
export const DOVE_SMALL_UP = [
  "...H........",
  "...HW.......",
  "....HW......",
  "....HWW.....",
  ".....HWW.WW.",
  "HW...HWWWWKO",
  ".HWWWWWWWWW.",
  "..SSWWWWSS..",
  "....SSSS....",
  "............",
] as const;
export const DOVE_SMALL_DOWN = [
  "............",
  "............",
  "............",
  "............",
  ".........WW.",
  "HW..HWWWWWKO",
  ".HWWWWWWWWW.",
  "..SSWWWWSS..",
  "....SWWS....",
  ".....SS.....",
] as const;
export const DOVE_SMALL_COLORS: Palette = { H: "#ffffff", W: "#fff8ec", S: "#bfb6e6", K: "#13163f", O: "#ffbf3c" };

// ───────────────────────── Rare: the edge of space ─────────────────────────

/** Width of one aurora tile in art pixels (tiles repeat sideways). */
export const AURORA_W = 240;
/** Tile heights: landscape screens, and taller for portrait phones. */
export const AURORA_H = 116;
export const AURORA_H_TALL = 170;

/** Smooth periodic noise over `n` columns. */
function loopNoise(n: number, seed: number, smooth: number): number[] {
  const r = seeded(seed);
  let a = Array.from({ length: n }, () => r());
  for (let k = 0; k < smooth; k++) a = a.map((_, i) => (a[(i - 1 + n) % n]! + 2 * a[i]! + a[(i + 1) % n]!) / 4);
  const lo = Math.min(...a);
  const hi = Math.max(...a);
  return a.map((v) => (v - lo) / (hi - lo));
}

/**
 * One layer of aurora curtains, repeating every AURORA_W columns. Each curtain
 * hangs from a wavy, sharp, bright lower edge (thicker where it folds) and
 * fades upward through teal and violet to pink tips, broken into fine
 * vertical rays that end at different heights. `layer` 0 is the dim back
 * curtain, 1 the bright front one.
 */
export function auroraLayer(layer: 0 | 1, seed: number, H = AURORA_H): string[] {
  const W = AURORA_W;
  const TAU = Math.PI * 2;
  const k = H / AURORA_H; // reach scales with tile height
  const r = seeded(seed);
  const ph = Array.from({ length: 4 }, () => r() * TAU);
  const rays = loopNoise(W, seed + 1, 1);
  const fine = loopNoise(W, seed + 2, 0);
  const swell = loopNoise(W, seed + 3, 14);
  const front = layer === 1;
  // the lower edge sweeps in big S-curves, floating above the atmosphere
  const baseY = (x: number) => {
    const u = (x / W) * TAU;
    const amp = (front ? 13 : 10) * k;
    const mid = front ? H - 8 - 14 * k : H - 30 - 22 * k;
    return mid - amp * (0.65 * Math.sin(u + ph[0]!) + 0.35 * Math.sin(u * 3 + ph[1]!)) - 3 * Math.sin(u * 8 + ph[2]!);
  };
  const g = new Grid(W, H);
  for (let x = 0; x < W; x++) {
    const b = baseY(x);
    const slope = Math.abs(baseY(x + 1) - baseY(x - 1)) / 2;
    const ray = Math.pow(0.55 * rays[x]! + 0.45 * fine[x]!, 1.2);
    const reach = k * ((front ? 28 : 24) + (front ? 46 : 30) * (0.35 + 0.65 * swell[x]!) * (0.6 + 0.4 * ray));
    const strength = (0.4 + 0.6 * swell[x]!) * (0.5 + 0.5 * ray);
    // where this ray ends (fraction of reach): bright rays reach higher
    const tip = 0.42 + 0.58 * Math.pow(0.6 * fine[x]! + 0.4 * ray, 1.1);
    for (let y = 0; y < H; y++) {
      const up = b - y;
      if (up < -4) continue;
      // a faint dithered glow just under the sharp lower edge
      if (up < 0) {
        if (front && up >= -3 && bayer(x, y) > -0.3 + (-up) * 0.22) g.set(x, y, up >= -1 ? "C" : "D");
        continue;
      }
      const t = Math.max(0, up) / reach;
      if (t > tip) continue;
      // dithered fade near each ray's tip
      const near = (t - tip * 0.72) / (tip * 0.28);
      if (near > 0 && near > 0.5 + bayer(x, y) * 1.6) continue;
      // faint columns thin out into a dither part-way up
      if (ray < 0.3 && t > 0.35 && bayer(x, y) > 0.2 - (0.3 - ray) * 2) continue;
      let e = strength * (1 - t) + ray * 0.3 - 0.15 + bayer(x, y) * 0.14;
      if (up < 1.5 + slope * 0.9) e += 0.7; // the sharp lower edge, thicker on folds
      let c: string;
      if (front) {
        if (up < 1 && e > 1.05) c = "W";
        else if (t < 0.1) c = e > 0.8 ? "A" : "B";
        else if (t < 0.28) c = e > 0.55 ? "B" : "C";
        else if (t < 0.46) c = e > 0.42 ? "C" : "D";
        else if (t < 0.62) c = "E";
        else if (t < 0.8) c = "F";
        else c = "G";
      } else {
        if (t < 0.14) c = e > 0.75 ? "c" : "d";
        else if (t < 0.42) c = "d";
        else if (t < 0.7) c = "e";
        else c = "f";
      }
      g.set(x, y, c);
    }
  }
  return g.out();
}
export const AURORA_COLORS: Palette = {
  W: "#e9fff6",
  A: "#9dffd9",
  B: "#5fe8bc",
  C: "#2fbfa0",
  D: "#2a8f9a",
  E: "#5a5fc8",
  F: "#8a5ad6",
  G: "#c46ad0",
  c: "#3fbf9c",
  d: "#2a8a8e",
  e: "#4a4fae",
  f: "#7448b8",
};

/** Bright ray streaks along the front curtain's base, blinked on and off for a shimmer. */
export function auroraRays(seed: number, H = AURORA_H): string[] {
  const front = auroraLayer(1, seed, H);
  const r = seeded(seed + 9);
  const g = new Grid(AURORA_W, H);
  for (let x = 0; x < AURORA_W; x++) {
    if (r() > 0.22) continue;
    const len = 6 + Math.floor(r() * 16 * (H / AURORA_H));
    let found = 0;
    for (let y = H - 1; y >= 0 && found < len; y--) {
      const c = front[y]![x];
      if (c === "." ) {
        if (found) break;
        continue;
      }
      g.set(x, y, found < 2 ? "W" : found < len * 0.5 ? "A" : "B");
      found++;
    }
  }
  return g.out();
}

/** The curve of the atmosphere along the bottom: a bright rim fading into the sky below. */
export const LIMB_W = 520;
export function limb(): string[] {
  const W = LIMB_W;
  const H = 20;
  const c = W / 2;
  const k = 11 / ((W * 0.31) ** 2);
  const g = new Grid(W, H);
  for (let x = 0; x < W; x++) {
    const top = Math.round(H - 14 + k * (x - c) ** 2); // row of the rim
    for (let y = Math.max(0, top - 6); y < H; y++) {
      const d = y - top;
      let ch = ".";
      if (d === -4) ch = "g";
      else if (d === -2) ch = (x + y) % 2 === 0 ? "h" : ".";
      else if (d === -1) ch = "h";
      else if (d === 0) ch = "R";
      else if (d === 1) ch = "S";
      else if (d < 3) ch = "T";
      else if (d < 4) ch = (x + y) % 2 ? "T" : "U";
      else if (d < 6) ch = "U";
      else if (d < 7) ch = (x + y) % 2 ? "U" : "V";
      else if (d < 9) ch = "V";
      else if (d < 10) ch = (x + y) % 2 ? "V" : "Z";
      else ch = "Z";
      g.set(x, y, ch);
    }
  }
  return g.out();
}
export const LIMB_COLORS: Palette = {
  g: "#3b7f9a", // thin airglow line just above the rim
  h: "#6a7ad8",
  R: "#e4f6ff",
  S: "#a8d8f4",
  T: "#7aa6e6",
  U: "#6280d2",
  V: "#5466c0",
  Z: "#4a56b0", // matches the top of the open sky
};

/** A generic satellite: gold-foil body, two solar wings on trusses, a dish and an antenna. */
export function satellite(): { art: string[]; palette: Palette } {
  const W = 56;
  const H = 26;
  const g = new Grid(W, H);
  const r = seeded(77);
  // solar wings
  const wing = (x0: number) => {
    const pw = 17;
    const ph = 12;
    const y0 = 9;
    g.rect(x0, y0, pw, ph, "n"); // frame
    for (let j = 0; j < 3; j++)
      for (let i = 0; i < 5; i++) {
        const cx = x0 + 1 + i * 3;
        const cyy = y0 + 1 + j * 4;
        g.rect(cx, cyy, 3, 3, "p");
        g.set(cx, cyy, "q");
        g.set(cx + 2, cyy + 2, "o");
      }
    // diagonal glint across the cells
    for (let i = 0; i < ph; i++) {
      const gx = x0 + 9 - Math.floor(i / 2) + (i % 2);
      if (g.get(gx, y0 + i) === "p") g.set(gx, y0 + i, "q");
      if (g.get(gx + 1, y0 + i) === "p") g.set(gx + 1, y0 + i, "Q");
    }
  };
  wing(0);
  wing(W - 17);
  // trusses
  for (let x = 17; x < 21; x++) {
    g.set(x, 14, "s");
    g.set(x, 15, x % 2 ? "t" : "s");
  }
  for (let x = W - 21; x < W - 17; x++) {
    g.set(x, 14, "s");
    g.set(x, 15, x % 2 ? "t" : "s");
  }
  // body: gold foil box with a lit top face and shaded right side
  const bx = 21;
  const bw = 14;
  g.rect(bx, 9, bw, 13, "Y");
  for (let y = 9; y < 22; y++)
    for (let x = bx; x < bx + bw; x++) {
      const n = r();
      let c = n < 0.2 ? "y" : n < 0.32 ? "Z" : "Y"; // crinkled foil
      if (x >= bx + bw - 3) c = n < 0.3 ? "z" : "Z";
      if (x === bx) c = "y";
      if (x === bx + bw - 1 || y === 21) c = "x";
      g.set(x, y, c);
    }
  g.rect(bx, 7, bw, 2, "s"); // top deck
  g.rect(bx, 7, bw, 1, "u");
  g.set(bx + bw - 1, 8, "t");
  g.rect(bx + 3, 12, 4, 3, "n"); // sensor window
  g.set(bx + 3, 12, "q");
  // dish on top
  const dish = ["...uuuuuu...", ".uussssssst.", "..tsssssst..", "....ttt.....", ".....t......"];
  dish.forEach((row, j) => [...row].forEach((ch, i) => ch !== "." && g.set(bx + 1 + i, j + 2, ch)));
  g.set(bx + 6, 0, "u");
  g.set(bx + 6, 1, "s");
  // antenna below with a light
  for (let y = 22; y < 25; y++) g.set(bx + 10, y, "t");
  g.set(bx + 10, 25, "L");
  // thrusters
  g.set(bx + 2, 22, "t");
  g.set(bx + 3, 22, "t");
  return {
    art: g.out(),
    palette: {
      n: "#1e2458", // panel frame / gaps
      p: "#3d6bd1",
      q: "#8fb3ff",
      Q: "#c4d6ff",
      o: "#2a4aa0",
      s: "#c8c2ea",
      t: "#7a74a8",
      u: "#f4f0ff",
      Y: "#ffd866",
      y: "#fff1b8",
      Z: "#e0a83c",
      z: "#b07a2c",
      x: "#6a4424",
      L: "#ff7a6b",
    },
  };
}

/** A sparkling star: bright core with dim arms (5×5). */
export const STAR_CROSS = ["..d..", "..b..", "dbWbd", "..b..", "..d.."] as const;
export const STAR_CROSS_BIG = ["...d...", "...b...", "...b...", "dbbWbbd", "...b...", "...b...", "...d..."] as const;
export const STAR_COLORS: Palette = { W: "#ffffff", b: "#c8d8ff", d: "#6a74c8" };

/** A shooting star travelling right and down: hot head, stepped fading trail. */
export const METEOR = [
  "dd..........................",
  "..dddcc.....................",
  ".......cccbb................",
  "............bbbaa...........",
  "................aaaWW.......",
  "...................WWH......",
  "....................HH......",
] as const;
export const METEOR_COLORS: Palette = { d: "#3a3f8a", c: "#6a74c8", b: "#a9b4ee", a: "#dfe6ff", W: "#fff8ec", H: "#ffffff" };
