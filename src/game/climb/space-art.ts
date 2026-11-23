/**
 * Pixel art for Deep Cut (outer space) and One in a Million (the cosmos), all
 * original to this project. Everything is generated at 1 art pixel = 1 --px,
 * shaded with short colour ramps and ordered (Bayer) dithering so it stays
 * flat-coloured and hard-edged, with runs long enough to keep rect counts low.
 */
import type { Palette } from "../pixel";
import { seeded } from "./art";

// ───────────────────────── tools ─────────────────────────

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
/** Ordered-dither threshold in [0, 1) for a pixel. */
const bayer = (x: number, y: number) => (BAYER[((y % 4) + 4) % 4]![((x % 4) + 4) % 4]! + 0.5) / 16;

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

/**
 * Pick a step 0…n-1 for a value in [0, 1], dithering only in a narrow band
 * around each step boundary (`sharp` > 1 narrows it; 1 dithers the whole step).
 */
function step(v: number, n: number, x: number, y: number, sharp = 3): number {
  const f = clamp(v) * (n - 1);
  const i = Math.floor(f);
  const t = clamp((f - i - 0.5) * sharp + 0.5);
  return Math.min(n - 1, t > bayer(x, y) ? i + 1 : i);
}

/** Builds a palette from named colour ramps; `c(name, i)` is the character for step i. */
function ramps(def: Record<string, readonly string[]>) {
  const pool = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%&*+=?@^~";
  const palette: Palette = {};
  const map: Record<string, string[]> = {};
  let k = 0;
  for (const [name, cols] of Object.entries(def)) {
    map[name] = cols.map((hex) => {
      const ch = pool[k++]!;
      palette[ch] = hex;
      return ch;
    });
  }
  const c = (name: string, i: number) => {
    const r = map[name]!;
    return r[clamp(Math.round(i), 0, r.length - 1)]!;
  };
  return { palette, c };
}

/** Smooth value noise in [0, 1]. */
function noise2(seed: number) {
  const h = (x: number, y: number) => {
    let n = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const sm = (t: number) => t * t * (3 - 2 * t);
  const one = (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = sm(x - xi);
    const v = sm(y - yi);
    const a = h(xi, yi) + (h(xi + 1, yi) - h(xi, yi)) * u;
    const b = h(xi, yi + 1) + (h(xi + 1, yi + 1) - h(xi, yi + 1)) * u;
    return a + (b - a) * v;
  };
  return (x: number, y: number, oct = 3) => {
    let s = 0;
    let amp = 1;
    let tot = 0;
    for (let o = 0; o < oct; o++) {
      s += one(x * 2 ** o, y * 2 ** o) * amp;
      tot += amp;
      amp *= 0.5;
    }
    return s / tot;
  };
}

/** Drops fully clear rows/columns around a grid. */
function trim(rows: string[]): string[] {
  const filled = (s: string) => /[^.]/.test(s);
  let top = 0;
  let bot = rows.length - 1;
  while (top < bot && !filled(rows[top]!)) top++;
  while (bot > top && !filled(rows[bot]!)) bot--;
  const kept = rows.slice(top, bot + 1);
  let left = Infinity;
  let right = 0;
  for (const r of kept) {
    const a = r.search(/[^.]/);
    if (a < 0) continue;
    left = Math.min(left, a);
    right = Math.max(right, r.length - 1 - [...r].reverse().join("").search(/[^.]/));
  }
  return kept.map((r) => r.slice(left, right + 1).padEnd(right - left + 1, "."));
}

/** Light comes from the top left and a little in front. */
const LIGHT = (() => {
  const v = [-0.62, -0.55, 0.56];
  const l = Math.hypot(...v);
  return v.map((n) => n / l) as [number, number, number];
})();

/** Sphere maths for pixel (x, y) of a disc of radius r centred on 0 (y down). */
function sphere(x: number, y: number, r: number) {
  const nx = x / r;
  const ny = y / r;
  const d2 = nx * nx + ny * ny;
  const nz = Math.sqrt(Math.max(0, 1 - d2));
  const lam = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
  return { nx, ny, nz, lam, edge: Math.sqrt(d2) * r > r - 1.1 };
}

/** Shared grid loop for a disc-ish sprite: half-size `hw`×`hh`, pixel centres on integers. */
function grid(hw: number, hh: number, fn: (x: number, y: number, gx: number, gy: number) => string): string[] {
  const rows: string[] = [];
  for (let y = -hh; y <= hh; y++) {
    let row = "";
    for (let x = -hw; x <= hw; x++) row += fn(x, y, x + hw, y + hh);
    rows.push(row);
  }
  return trim(rows);
}

const inDisc = (x: number, y: number, r: number) => x * x + y * y <= r * r + r * 0.5;

// ───────────────────────── Deep Cut: outer space ─────────────────────────

const RINGED_RAMPS = ramps({
  cream: ["#3a2230", "#7a4634", "#c88850", "#f0c27e", "#ffe6b0", "#fff6dc"],
  tan: ["#341d2a", "#6a3a2e", "#a9663e", "#d89a5a", "#f2c48a", "#ffe0b0"],
  rust: ["#2c1726", "#5a2c2a", "#8a4430", "#b8603a", "#d88a52", "#f2b070"],
  storm: ["#2c1424", "#5e2228", "#9a3a2e", "#d0603e", "#f08c5a", "#ffc08a"],
  ring: ["#2a1d2e", "#5a4a4e", "#8f7a66", "#bfa888", "#e8d6b4", "#fff2d8"],
  gap: ["#1e1838"],
});

/** A banded gas giant with a storm, tilted rings (with gaps) and shadows both ways. */
export function ringedPlanet(r: number, tiltDeg = -14) {
  const { c, palette } = RINGED_RAMPS;
  const th = (tiltDeg * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const A = r * 2.15;
  const B = A * 0.32;
  const n = noise2(31);
  // band edges by latitude (-1 top … 1 bottom) and their material
  const bands: [number, string][] = [
    [-0.82, "tan"], [-0.6, "cream"], [-0.46, "rust"], [-0.3, "cream"], [-0.12, "tan"],
    [0.02, "cream"], [0.16, "rust"], [0.3, "tan"], [0.5, "cream"], [0.66, "tan"], [0.82, "rust"], [2, "tan"],
  ];
  const ringAt = (e: number): number => {
    // brightness offset for ring radius e (null-ish = -9 for clear)
    if (e < 0.62 || e > 1) return -9;
    if (e < 0.7) return -1.6; // faint inner ring
    if (e < 0.72) return -9;
    if (e < 0.85) return 0; // bright main ring
    if (e < 0.885) return -9; // the big gap
    return -0.8;
  };
  const hw = Math.ceil(A) + 2;
  const hh = Math.ceil(Math.max(r, Math.sqrt(A * A * sin * sin + B * B * cos * cos))) + 2;
  return {
    palette,
    art: grid(hw, hh, (x, y) => {
      // rotate into the planet's frame (u along the equator, v towards its south)
      const u = x * cos + y * sin;
      const v = -x * sin + y * cos;
      const disc = inDisc(x, y, r);
      const e = Math.sqrt((u * u) / (A * A) + (v * v) / (B * B));
      const ring = ringAt(e);
      if (ring > -9 && (!disc || v > 0)) {
        // planet's shadow falls across the back of the ring, just right of the globe
        const shadow = v < 0 && !disc && u > r * 0.15 && u < r * 1.3;
        if (shadow) return c("ring", ring < -1 ? 0 : 1);
        const lit = 3.7 + ring - (u / A) * 1.4;
        return c("ring", step(lit / 5, 6, x, y, 3));
      }
      if (!disc) return ".";
      const s = sphere(x, y, r);
      if (s.edge && s.lam < 0.35) return c("rust", 0);
      // bands follow latitude, with a little turbulence
      const lat = v / r + 0.045 * Math.sin(u * 0.55 + v * 0.9) + (n(u * 0.18 + 9, v * 0.6) - 0.5) * 0.09;
      let mat = bands.find(([edge]) => lat < edge)![1];
      // storm spot in the southern hemisphere
      const sx = (u + r * 0.3) / (r * 0.24);
      const sy = (v - r * 0.2) / (r * 0.12);
      const sd = sx * sx + sy * sy;
      let lift = 0;
      if (sd < 1) {
        mat = "storm";
        lift = sd < 0.35 ? 0.06 : -0.04;
      } else if (sd < 1.6) mat = "cream";
      // the front ring throws a thin shadow on the globe just below it
      const su = u - 1.2;
      const sv = v - 2.6;
      const se = Math.sqrt((su * su) / (A * A) + (sv * sv) / (B * B));
      const ringShadow = sv > 0 && ringAt(se) > -8;
      let b = s.lam * 0.98 + 0.12 + lift;
      if (ringShadow) b -= 0.3;
      return c(mat, step(b, 6, x, y, 2.2));
    }),
  };
}

const MOON_RAMPS = ramps({
  rock: ["#2a2440", "#4e4670", "#7a7298", "#a49dbe", "#cdc7e0", "#f1ecff"],
  mare: ["#26213a", "#433c62", "#655d88", "#8a83a6", "#aea8c6", "#cfc9e2"],
});

/** A lavender moon with dark seas and rimmed craters. */
export function moon(r: number, seed: number) {
  const { c, palette } = MOON_RAMPS;
  const rand = seeded(seed);
  const n = noise2(seed);
  const craters: { x: number; y: number; s: number }[] = [];
  const sizes = [r * 0.32, r * 0.24, r * 0.18, r * 0.13, r * 0.1];
  for (let tries = 0; craters.length < sizes.length && tries < 400; tries++) {
    const s = sizes[craters.length]!;
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * (r - s - 1.5);
    const k = { x: Math.cos(a) * d, y: Math.sin(a) * d, s };
    if (craters.every((o) => Math.hypot(o.x - k.x, o.y - k.y) > o.s + k.s + 2)) craters.push(k);
  }
  const L2 = [LIGHT[0], LIGHT[1]];
  return {
    palette,
    art: grid(r + 1, r + 1, (x, y) => {
      if (!inDisc(x, y, r)) return ".";
      const s = sphere(x, y, r);
      if (s.edge && s.lam < 0.4) return c("rock", 0);
      let b = s.lam * 1.0 + 0.1;
      const mare = n(x * 0.1 + 3, y * 0.1 + 7, 2) > 0.6;
      for (const k of craters) {
        const dx = x - k.x;
        const dy = y - k.y;
        const d = Math.hypot(dx, dy);
        if (d > k.s + 1) continue;
        const toward = d > 0 ? (dx * L2[0]! + dy * L2[1]!) / d : 0;
        // inside, the wall nearest the light is in shadow and the far wall catches it
        if (d <= k.s) b += d > k.s * 0.3 && toward > -0.1 ? -0.42 : toward < -0.3 && d > k.s * 0.45 ? 0.2 : -0.12;
        else b += toward > 0.1 ? 0.2 : toward < -0.2 ? -0.22 : 0; // raised rim
        break;
      }
      return c(mare ? "mare" : "rock", step(b, 6, x, y, 3));
    }),
  };
}

const MARS_RAMPS = ramps({
  dust: ["#2c1020", "#5e1f24", "#9a3328", "#cc5236", "#f07a4e", "#ffa878"],
  dark: ["#220c1c", "#4a1820", "#742824", "#9e3a2c", "#c4553a", "#e07850"],
  ice: ["#4a3c5c", "#8a84a8", "#c8c6e0", "#f4f2ff"],
});

/** A small red planet with dark markings, a canyon and a polar cap. */
export function redPlanet(r: number, seed: number) {
  const { c, palette } = MARS_RAMPS;
  const n = noise2(seed);
  return {
    palette,
    art: grid(r + 1, r + 1, (x, y) => {
      if (!inDisc(x, y, r)) return ".";
      const s = sphere(x, y, r);
      if (s.edge && s.lam < 0.38) return c("dust", 0);
      const b = s.lam * 1.05 + 0.04;
      if (s.ny < -0.78 + (n(x * 0.5, 1) - 0.5) * 0.15) return c("ice", step(b * 1.1, 4, x, y, 2));
      const u = x / (s.nz + 0.35); // squash markings towards the limb
      const canyon = Math.abs(y - 1 - u * 0.25 - Math.sin(u * 0.4) * 1.2) < 0.6 && Math.abs(u) < r * 0.9;
      const dark = canyon || n(u * 0.22 + 5, y * 0.3 + 2, 3) > 0.58;
      return c(dark ? "dark" : "dust", step(b, 6, x, y, 2.2));
    }),
  };
}

const ICE_RAMPS = ramps({
  sea: ["#101c48", "#1c3a7a", "#2f64b8", "#4a96e0", "#8cd0ff"],
  cloud: ["#2a3470", "#5a74b8", "#a8c8f0", "#eef8ff"],
  air: ["#6ab8ff"],
});

/** A distant blue planet with cloud streaks and a thin bright atmosphere on the lit limb. */
export function bluePlanet(r: number, seed: number) {
  const { c, palette } = ICE_RAMPS;
  const n = noise2(seed);
  return {
    palette,
    art: grid(r + 2, r + 2, (x, y) => {
      const d = Math.hypot(x, y);
      if (!inDisc(x, y, r)) {
        const lit = (x * LIGHT[0] + y * LIGHT[1]) / (d || 1);
        return d < r + 1.3 && lit > 0.45 ? c("air", 0) : ".";
      }
      const s = sphere(x, y, r);
      if (s.edge && s.lam < 0.4) return c("sea", 0);
      const b = s.lam * 1.05 + 0.03;
      const cloud = n(x * 0.25 + 2, y * 0.7 + 4, 2) > 0.6;
      return cloud ? c("cloud", step(b, 4, x, y, 2)) : c("sea", step(b, 5, x, y, 2));
    }),
  };
}

const ROCK_RAMPS = ramps({ rock: ["#1c1630", "#3a3150", "#5e5478", "#8a7fa0", "#b6abc8"] });

/** A lumpy little asteroid. */
export function asteroid(r: number, seed: number) {
  const { c, palette } = ROCK_RAMPS;
  const rand = seeded(seed);
  const bumps = Array.from({ length: 5 }, () => rand() * Math.PI * 2);
  const sq = 0.7 + rand() * 0.3;
  return {
    palette,
    art: grid(Math.ceil(r) + 1, Math.ceil(r) + 1, (x, y) => {
      const a = Math.atan2(y, x);
      const rr = r * (1 + 0.16 * Math.sin(a * 2 + bumps[0]!) + 0.12 * Math.sin(a * 3 + bumps[1]!));
      const yy = y / sq;
      if (x * x + yy * yy > rr * rr) return ".";
      const s = sphere(x, yy, rr);
      if (s.edge && s.lam < 0.45) return c("rock", 0);
      const pit = Math.sin(x * 1.7 + bumps[2]!) * Math.sin(y * 1.9 + bumps[3]!) > 0.75;
      return c("rock", step(s.lam * 1.1 + (pit ? -0.25 : 0), 5, x, y, 2));
    }),
  };
}

/** A comet heading down-left, with a straight blue ion tail and a curved golden dust tail. */
export function comet(len: number) {
  const { c, palette } = ramps({
    head: ["#ffffff", "#e6fbff"],
    ion: ["#1a2a6a", "#2f58b0", "#5aa8ff", "#a8e4ff"],
    dust: ["#3a2a5a", "#8a6a6a", "#d8a860", "#ffe2a0"],
  });
  const h = Math.ceil(len * 0.42);
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let row = "";
    for (let x = 0; x < len; x++) {
      // head sits at the bottom left; t runs 0 (head) … 1 (tail tip) along the tail
      const hx = 3;
      const hy = h - 4;
      const dx = x - hx;
      const dy = hy - y;
      const dh = Math.hypot(dx, dy);
      if (dh < 1.3) row += c("head", 0);
      else if (dh < 2.4) row += c("head", 1);
      else {
        const t = (dx + dy * 0.42) / 1.085 / len;
        // ion tail: straight, along slope 0.42
        const off = dy - dx * 0.42;
        const ionW = 0.8 + t * 3;
        const dustOff = dy - dx * 0.62 - t * t * len * 0.12;
        const dustW = 1.2 + t * 5;
        let ch = ".";
        if (t > 0 && t < 1 && Math.abs(off) < ionW) {
          const v = (1 - t) * (1 - Math.abs(off) / ionW * 0.6);
          const lvl = v * 4 - 0.4;
          if (lvl > bayer(x, y) * 0.9) ch = c("ion", step(v * 1.1, 4, x, y, 1.4));
        } else if (t > 0 && t < 0.9 && Math.abs(dustOff) < dustW) {
          const v = (0.9 - t) * (1 - Math.abs(dustOff) / dustW * 0.7);
          if (v * 3.2 > bayer(x, y) + 0.2) ch = c("dust", step(v * 1.3, 4, x, y, 1.4));
        } else if (dh < 4 && 1 - (dh - 2.4) / 1.6 > bayer(x, y)) ch = c("ion", 3);
        row += ch;
      }
    }
    rows.push(row);
  }
  return { palette, art: trim(rows) };
}

// ───────────────────────── One in a Million: the cosmos ─────────────────────────

export const GALAXY_PALETTE_DEF = {
  halo: ["#3a2478", "#5a3cb0", "#7c5ad8"],
  arm: ["#5a3cb8", "#8a62e0", "#b88cff", "#e0b8ff", "#ffe0fa"],
  core: ["#ffc8e8", "#ffe6c4", "#fff4cc", "#fffdf0"],
  dust: ["#2a1258", "#43228a"],
  knotPink: ["#ff7ac8"],
  knotBlue: ["#a8f0ff"],
};
const GALAXY_RAMPS = ramps(GALAXY_PALETTE_DEF);

/** A detailed two-armed spiral seen at a tilt: bright core, dust lanes, star knots, dithered halo. */
export function spiralGalaxy(w: number, h: number, seed: number) {
  const { c, palette } = GALAXY_RAMPS;
  const rand = seeded(seed);
  const n = noise2(seed);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const R = w / 2;
  const tilt = (-12 * Math.PI) / 180;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const squash = (h / w) * 1.02;
  const knots = new Map<string, string>();
  for (let i = 0; i < 70; i++) {
    // star knots sprinkled along the arms
    const arm = i % 2;
    const t = 0.12 + rand() * 0.78;
    const ang = Math.log(t * R + 1) / 0.42 + arm * Math.PI + (rand() - 0.5) * 0.25;
    const rr = t * R;
    const gx = Math.cos(ang) * rr;
    const gy = Math.sin(ang) * rr * squash;
    const x = Math.round(cx + gx * ct - gy * st);
    const y = Math.round(cy + gx * st + gy * ct);
    knots.set(`${x},${y}`, rand() < 0.55 ? c("knotBlue", 0) : rand() < 0.7 ? c("knotPink", 0) : c("arm", 4));
  }
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let row = "";
    for (let x = 0; x < w; x++) {
      const k = knots.get(`${x},${y}`);
      // un-rotate, un-squash into the galaxy's own plane
      const px0 = x - cx;
      const py0 = y - cy;
      const gx = px0 * ct + py0 * st;
      const gy = (-px0 * st + py0 * ct) / squash;
      const d = Math.hypot(gx, gy);
      const dn = d / R;
      const theta = Math.atan2(gy, gx);
      const phase = theta - Math.log(d + 1) / 0.42;
      const armWave = 0.5 + 0.5 * Math.cos(2 * phase);
      const rim = clamp((1.02 - dn) / 0.3);
      const arm = Math.pow(armWave, 3) * Math.exp(-dn * 1.6) * (1 - Math.exp(-dn * 9)) * rim;
      // dust lane: trailing edge of each arm
      const lane = Math.pow(0.5 + 0.5 * Math.cos(2 * phase - 0.95), 34) * (dn > 0.1 && dn < 0.75 ? 1 : 0);
      const core = Math.exp(-(dn * dn) / 0.012);
      const bulge = Math.exp(-(dn * dn) / 0.06);
      const halo = Math.exp(-dn * 3.2) * 0.9 * rim;
      const grain = (n(x * 0.35, y * 0.35, 2) - 0.5) * 0.18;
      const v = arm * 1.5 + bulge * 0.6 + grain * (arm > 0.1 ? 1 : 0.3);
      if (core > 0.25) {
        row += c("core", step((core - 0.25) / 0.75, 4, x, y, 2));
        continue;
      }
      if (k && v > 0.18) {
        row += k;
        continue;
      }
      if (lane > 0.55 && v > 0.3) {
        row += c("dust", lane > 0.8 ? 0 : 1);
        continue;
      }
      if (v > 0.24) {
        row += c("arm", step((v - 0.24) / 1.0, 5, x, y, 2.4));
        continue;
      }
      if (bulge > 0.3) {
        row += c("core", 0);
        continue;
      }
      const hv = halo + v * 0.9 - 0.1;
      if (hv > 0.04) {
        const lvl = hv / 0.35; // 0…1 over the halo
        if (lvl < 1 && lvl * 1.3 < bayer(x, y)) row += ".";
        else row += c("halo", step(lvl - 0.6, 3, x, y, 2));
        continue;
      }
      row += ".";
    }
    rows.push(row);
  }
  return { palette, art: trim(rows) };
}

const NEB_RAMPS = ramps({
  M: ["#1e0b3a", "#341150", "#561a68", "#86287e", "#c24a9e", "#ef86c6"],
  T: ["#0e1640", "#132a5a", "#174674", "#1f7090", "#36a8be", "#7ee6e8"],
  G: ["#170e44", "#24175e", "#36237e", "#5236a8", "#7a58d8", "#b49cff"],
});
export const NEBULA_PALETTE = NEB_RAMPS.palette;

/**
 * Layered nebula clouds: each blob is a hue, shaped by smooth noise and shaded
 * in 6 flat steps with dithering only at step edges (so it reads as banded
 * gas, not static). `top` fades clouds out near the top or bottom edge.
 */
export function nebulaClouds(
  w: number,
  h: number,
  seed: number,
  hues: readonly ("M" | "T" | "G")[],
  fade: "up" | "down" | "both" = "both",
  strength = 1,
) {
  const { c } = NEB_RAMPS;
  const rand = seeded(seed);
  const n = noise2(seed);
  const n2 = noise2(seed + 101);
  // Blobs are spread evenly across the width (one per slot, a little jitter),
  // alternating high and low, so neither side ends up heavier than the other.
  const k = hues.length;
  const blobs = hues.map((hue, i) => ({
    x: ((i + 0.5) / k + (rand() - 0.5) * (0.35 / k)) * w,
    y: (i % 2 === 0 ? 0.36 : 0.64) * h + (rand() - 0.5) * 0.16 * h,
    rx: w * (1.05 / k) * (0.85 + rand() * 0.3),
    ry: h * (0.22 + rand() * 0.16),
    hue,
  }));
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let row = "";
    const fy = y / (h - 1);
    const edge = fade === "up" ? clamp(fy * 2.2) : fade === "down" ? clamp((1 - fy) * 2.2) : clamp(Math.min(fy, 1 - fy) * 3.2);
    for (let x = 0; x < w; x++) {
      const warp = (n(x * 0.03, y * 0.05, 2) - 0.5) * 1.8;
      const warpY = (n(x * 0.035 + 40, y * 0.05 + 17, 2) - 0.5) * 1.4;
      let best = 0;
      let second = 0;
      let hue: string = "G";
      let total = 0;
      for (const b of blobs) {
        const dx = (x - b.x) / b.rx + warp;
        const dy = (y - b.y) / b.ry + warpY;
        const v = Math.exp(-(dx * dx + dy * dy) * 1.1);
        total += v;
        if (v > best) {
          if (b.hue !== hue) second = best;
          best = v;
          hue = b.hue;
        } else if (v > second && b.hue !== hue) second = v;
      }
      // where two clouds of different colour meet, a darker dust lane
      const seam = clamp(((best - second) / (best + 1e-6)) * 3.5 + 0.35);
      // filaments: brighter wisps where ridged noise peaks
      const ridge = 1 - Math.abs(n2(x * 0.04, y * 0.08, 2) * 2 - 1);
      const ex = clamp(Math.min(x, w - 1 - x) / (w * 0.14));
      const v = (Math.min(1, total) * 0.42 * strength * seam + Math.pow(ridge, 8) * 0.4 * best * seam) * edge * ex - 0.06;
      if (v < 0.04) {
        row += v > 0 && bayer(x, y) < 0.5 * (v / 0.04) ? c(hue, 0) : ".";
        continue;
      }
      row += c(hue, step(v / 0.8, 6, x, y, 7));
    }
    rows.push(row);
  }
  return rows;
}

/** A loose cluster of stars in a few colours, densest in the middle. */
export function starCluster(size: number, count: number, seed: number) {
  const { c, palette } = ramps({ star: ["#fff8ec", "#ffe6a8", "#a8e4ff", "#ffb0dc", "#8a78c8", "#3a2a78"] });
  const rand = seeded(seed);
  const grid0 = Array.from({ length: size }, () => Array.from({ length: size }, () => "."));
  const mid = (size - 1) / 2;
  // faint haze behind the core
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - mid, y - mid) / mid;
      if (d < 0.55 && (x + y) % 2 === 0 && bayer(x, y) > d * 1.4) grid0[y]![x] = c("star", 5);
    }
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.pow(rand(), 1.6) * mid;
    const x = Math.round(mid + Math.cos(a) * d);
    const y = Math.round(mid + Math.sin(a) * d);
    const k = rand();
    const col = c("star", k < 0.45 ? 0 : k < 0.65 ? 1 : k < 0.85 ? 2 : 3);
    grid0[y]![x] = col;
    if (rand() < 0.12 && x > 0 && x < size - 1 && y > 0 && y < size - 1) {
      grid0[y]![x - 1] = grid0[y]![x + 1] = grid0[y - 1]![x] = grid0[y + 1]![x] = c("star", 4);
    }
  }
  return { palette, art: grid0.map((r) => r.join("")) };
}

/** Sparkles: a long 4-point star, an 8-point star and a tiny one. Palette keys W (core), Y (centre), b (mid), a (faint). */
export const SPARKLE_4 = [
  "......a......",
  "......a......",
  "......b......",
  "......b......",
  ".....bWb.....",
  ".....WYW.....",
  "aabbWYYYWbbaa",
  ".....WYW.....",
  ".....bWb.....",
  "......b......",
  "......b......",
  "......a......",
  "......a......",
] as const;

export const SPARKLE_8 = [
  "a...a...a",
  ".b..b..b.",
  "..b.W.b..",
  "...WYW...",
  "abWYYYWba",
  "...WYW...",
  "..b.W.b..",
  ".b..b..b.",
  "a...a...a",
] as const;

export const SPARKLE_TINY = [
  "..a..",
  "..W..",
  "aWYWa",
  "..W..",
  "..a..",
] as const;

export const SPARKLE_TINTS: Palette[] = [
  { W: "#fff8ec", Y: "#ffffff", b: "#ffd866", a: "#9a6a3a" },
  { W: "#e6fbff", Y: "#ffffff", b: "#6ad8ff", a: "#2a5a9a" },
  { W: "#ffe6f6", Y: "#ffffff", b: "#ff8ad8", a: "#7a2a72" },
  { W: "#f0e6ff", Y: "#ffffff", b: "#b48cff", a: "#4a2f92" },
];
