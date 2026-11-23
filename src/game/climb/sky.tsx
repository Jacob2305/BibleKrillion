/** Schooler (open sky) and Rare (the edge of space). One art pixel = one --px throughout. */
import type { CSSProperties } from "react";
import type { Palette } from "../pixel";
import { seeded } from "./art";
import {
  AURORA_COLORS,
  AURORA_H,
  AURORA_H_TALL,
  AURORA_W,
  auroraLayer,
  auroraRays,
  balloon,
  cloud,
  cloudPalette,
  DOVE_SMALL_COLORS,
  DOVE_SMALL_DOWN,
  DOVE_SMALL_UP,
  gridUrl,
  LIMB_COLORS,
  limb,
  METEOR,
  METEOR_COLORS,
  mix,
  satellite,
  STAR_COLORS,
  STAR_CROSS,
  STAR_CROSS_BIG,
  type BalloonPattern,
} from "./sky-art";
import { Zone, px } from "./zone";

/** A pixel grid drawn as one background image (no per-pixel DOM), 1 art pixel = 1 --px. */
function Pix({ art, url, className = "", style }: { art: readonly string[]; url: string; className?: string; style?: CSSProperties }) {
  const w = Math.max(...art.map((r) => r.length));
  return (
    <div
      aria-hidden
      className={`absolute ${className}`}
      style={{ width: px(w), height: px(art.length), backgroundImage: url, backgroundSize: "100% 100%", backgroundRepeat: "no-repeat", ...style }}
    />
  );
}

const sprite = (art: readonly string[], palette: Palette) => ({ art, url: gridUrl(art, palette) });

// ───────────────────────── Schooler: open sky ─────────────────────────

/** Sky colour behind each depth (the zone's gradient runs #9a7fc8 → #4a56b0). */
const SKY = "#7468bc";

type BalloonDef = { w: number; pattern: BalloonPattern; colors: [string, string, string]; haze: number; x: string; y: string; float: number; sway: number };
const BALLOONS: BalloonDef[] = [
  // far, small and hazy …
  { w: 9, pattern: "gores", colors: ["#7fd6c0", "#fff8ec", "#ff7a6b"], haze: 0.45, x: "56%", y: "86%", float: 4.2, sway: 23 },
  { w: 11, pattern: "bands", colors: ["#ffd866", "#ff7a6b", "#8a5ad6"], haze: 0.4, x: "21%", y: "21%", float: 3.6, sway: 19 },
  { w: 14, pattern: "spiral", colors: ["#ff9ac0", "#fff1b8", "#6a8ae8"], haze: 0.3, x: "88%", y: "75%", float: 3.3, sway: 17 },
  // … middle distance …
  { w: 20, pattern: "chevron", colors: ["#4fb8e0", "#fff8ec", "#ffbf3c"], haze: 0.16, x: "4%", y: "44%", float: 2.8, sway: 15 },
  { w: 24, pattern: "patched", colors: ["#ffbf3c", "#ff7a6b", "#7fd6c0"], haze: 0.1, x: "calc(100% - 7 * var(--px) - 24 * var(--px))", y: "8%", float: 2.5, sway: 13 },
  // … and one big one close by
  { w: 36, pattern: "diamond", colors: ["#e8505b", "#ffd866", "#3d6bd1"], haze: 0, x: "calc(70% - 6 * var(--px))", y: "34%", float: 2.2, sway: 11 },
];
const BALLOON_SPRITES = BALLOONS.map((b, i) => {
  const { art, palette } = balloon(b.w, b.pattern, b.colors, { haze: b.haze, sky: SKY, seed: i * 13 + 5 });
  return sprite(art, palette);
});

type CloudDef = { w: number; h: number; seed: number; haze: number; x: string; y: string; opacity: number };
const CLOUDS: CloudDef[] = [
  { w: 34, h: 10, seed: 3, haze: 0.2, x: "34%", y: "92%", opacity: 0.9 },
  { w: 48, h: 13, seed: 8, haze: 0.14, x: "4%", y: "82%", opacity: 0.95 },
  { w: 76, h: 20, seed: 11, haze: 0.05, x: "calc(100% - 52 * var(--px))", y: "64%", opacity: 1 },
  { w: 60, h: 16, seed: 21, haze: 0.08, x: "36%", y: "38%", opacity: 1 },
  { w: 44, h: 12, seed: 5, haze: 0.12, x: "62%", y: "22%", opacity: 0.95 },
  { w: 88, h: 23, seed: 17, haze: 0, x: "calc(-22 * var(--px))", y: "10%", opacity: 1 },
];
const CLOUD_SPRITES = CLOUDS.map((c) => sprite(cloud(c.w, c.h, c.seed), cloudPalette(c.haze, SKY)));

const DOVE_UP_S = sprite(DOVE_SMALL_UP, DOVE_SMALL_COLORS);
const DOVE_DOWN_S = sprite(DOVE_SMALL_DOWN, DOVE_SMALL_COLORS);

export function OpenSky() {
  return (
    <Zone index={2}>
      {CLOUDS.map((c, i) => (
        <Pix key={i} {...CLOUD_SPRITES[i]!} className="sky-sway" style={{ left: c.x, bottom: c.y, opacity: c.opacity, ["--sway" as string]: `${18 + i * 3}s` }} />
      ))}
      {BALLOONS.map((b, i) => (
        <div key={i} className="absolute sky-sway" style={{ left: b.x, bottom: b.y, ["--sway" as string]: `${b.sway}s` }}>
          <Pix {...BALLOON_SPRITES[i]!} className="sky-float" style={{ position: "relative", ["--float" as string]: `${b.float}s`, animationDelay: `${-i * 0.7}s` }} />
        </div>
      ))}
      {/* a flock of doves in a V, each flapping on its own beat */}
      {[0, 1, 2, 3, 4, 5, 6].map((i) => {
        const back = Math.abs(i - 3);
        const style: CSSProperties = { left: `calc(12% + ${px(i * 11)})`, bottom: `calc(74% + ${px(-back * 6)})` };
        const delay = { animationDelay: `${-((i * 0.37) % 0.24)}s` };
        return (
          <div key={i} className="absolute" style={style}>
            <Pix {...DOVE_UP_S} className="climb-flap-a" style={{ position: "relative", ...delay }} />
            <Pix {...DOVE_DOWN_S} className="climb-flap-b" style={{ top: 0, left: 0, ...delay }} />
          </div>
        );
      })}
    </Zone>
  );
}

// ───────────────────────── Rare: the edge of space ─────────────────────────

/** The aurora tiles: [landscape, portrait (taller)]. */
const AURORAS = [AURORA_H, AURORA_H_TALL].map((h) => ({
  h,
  back: gridUrl(auroraLayer(0, 41, h), AURORA_COLORS),
  front: gridUrl(auroraLayer(1, 7, h), AURORA_COLORS),
  rays: gridUrl(auroraRays(7, h), AURORA_COLORS),
}));
const LIMB = sprite(limb(), LIMB_COLORS);
const SAT = (() => {
  const s = satellite();
  return sprite(s.art, s.palette);
})();
const CROSS = sprite(STAR_CROSS, STAR_COLORS);
const CROSS_BIG = sprite(STAR_CROSS_BIG, STAR_COLORS);
const METEOR_S = sprite(METEOR, METEOR_COLORS);

/** Stars of varied brightness, denser and brighter towards the top. */
const STARS = (() => {
  const r = seeded(303);
  const tints = ["#ffffff", "#fff8ec", "#cfe0ff", "#ffe9c4", "#b7b0e8"];
  return Array.from({ length: 110 }, () => {
    const y = 18 + Math.sqrt(r()) * 82;
    const lvl = r();
    const big = lvl > 0.9;
    const color = lvl < 0.45 ? mix(tints[4]!, "#2a2a78", 0.35 + 0.3 * (1 - y / 100)) : tints[Math.floor(r() * 4)]!;
    return { x: r() * 100, y, big, color, twinkle: r() < 0.3, delay: r() * 3 };
  });
})();
const CROSSES = [
  { x: 12, y: 74, big: true },
  { x: 86, y: 90, big: false },
  { x: 40, y: 94, big: false },
  { x: 93, y: 52, big: true },
  { x: 6, y: 40, big: false },
  { x: 58, y: 60, big: false },
];

const tile = (url: string, h: number): CSSProperties => ({
  backgroundImage: url,
  backgroundSize: `${px(AURORA_W)} ${px(h)}`,
  backgroundRepeat: "repeat-x",
});

export function EdgeOfSpace() {
  return (
    <Zone index={3}>
      {STARS.map((s, i) => (
        <span
          key={i}
          className={`absolute ${s.twinkle ? "animate-twinkle" : ""}`}
          style={{ left: `${s.x}%`, bottom: `${s.y}%`, width: px(s.big ? 2 : 1), height: px(s.big ? 2 : 1), background: s.color, animationDelay: `${s.delay}s` }}
        />
      ))}
      {CROSSES.map((c, i) => (
        <Pix key={i} {...(c.big ? CROSS_BIG : CROSS)} className="animate-twinkle" style={{ left: `${c.x}%`, bottom: `${c.y}%`, animationDelay: `${i * 0.6}s` }} />
      ))}

      {/* the aurora: a dim back curtain and a bright front one drifting opposite ways, with rays that flicker */}
      {AURORAS.map((a, i) => (
        <div key={i} className={`absolute inset-x-0 ${i ? "landscape:hidden" : "portrait:hidden"}`} style={{ bottom: px(9), height: px(a.h) }}>
          <div className="sky-aurora absolute inset-0 opacity-80" style={{ ...tile(a.back, a.h), ["--dur" as string]: "220s" }} />
          <div className="sky-aurora absolute inset-0" style={{ ...tile(a.front, a.h), ["--dur" as string]: "150s", animationDirection: "reverse" }} />
          <div className="absolute inset-0 sky-shimmer">
            <div className="sky-aurora absolute inset-0" style={{ ...tile(a.rays, a.h), ["--dur" as string]: "150s", animationDirection: "reverse" }} />
          </div>
        </div>
      ))}
      {/* the curve of the atmosphere along the bottom */}
      <Pix {...LIMB} style={{ left: "50%", bottom: 0, transform: "translateX(-50%)" }} />

      <div className="absolute sky-sway" style={{ left: "min(66%, calc(100% - 60 * var(--px)))", bottom: "68%", ["--sway" as string]: "16s" }}>
        <Pix {...SAT} className="sky-float" style={{ position: "relative", ["--float" as string]: "3.4s" }} />
        <span className="absolute animate-twinkle" style={{ left: px(31), top: px(25), width: px(1), height: px(1), background: "#ffd0c8", animationDuration: "1.2s" }} />
      </div>
      <Pix {...METEOR_S} className="climb-shooting" style={{ left: "6%", bottom: "84%", rotate: "0deg" }} />
    </Zone>
  );
}
