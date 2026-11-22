/**
 * The six zones of the reveal climb, bottom to top, plus the deep water below
 * the sea. Each zone fills one screen; everything is placed in % so it works
 * on a phone in portrait and on a 16:9 projector. One art pixel is `--px`
 * (set on the climb overlay), so all sprites share the same chunky pixel size.
 */
import type { CSSProperties, ReactNode } from "react";
import { CLOUD_BIG, CLOUD_PALETTE, CLOUD_SMALL, SUN, SUN_PALETTE, Sprite, type Palette } from "../pixel";
import {
  AURORA_COLORS,
  BALLOON,
  BALLOON_COLORS,
  BIRD,
  BOAT,
  BOAT_COLORS,
  CHAPEL,
  CHAPEL_COLORS,
  CREEK_HOUSE,
  CREEK_HOUSE_COLORS,
  FISH,
  GALAXY_COLORS,
  KELP_COLORS,
  NEBULA_COLORS,
  PLANKTON,
  PLANKTON_COLORS,
  SATELLITE,
  SATELLITE_COLORS,
  SPARKLE,
  SPARKLE_COLORS,
  WAVE_COLORS,
  WAVE_TILE,
  aurora,
  building,
  galaxy,
  kelp,
  nebula,
  planet,
  seeded,
  starfield,
} from "./art";

/** `n` art pixels as a CSS length. */
export const px = (n: number) => `calc(${n} * var(--px))`;

/** Colours where one zone meets the next (bottom of the deep … top of the cosmos). */
const EDGES = ["#020c18", "#04213a", "#e48a8f", "#9a7fc8", "#4a56b0", "#1a1650", "#090726", "#1b0733"];

/** A sprite placed in a zone: `x`/`y` are % from the left / bottom; `scale` art pixels per pixel. */
function Art({
  art,
  palette,
  x,
  y,
  scale = 1,
  center = false,
  className = "",
  style,
}: {
  art: readonly string[];
  palette: Palette;
  x: number | string;
  y: number | string;
  scale?: number;
  center?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const cols = Math.max(...art.map((r) => r.length));
  return (
    <div
      className={`absolute ${className}`}
      style={{
        left: typeof x === "number" ? `${x}%` : x,
        bottom: typeof y === "number" ? `${y}%` : y,
        width: px(cols * scale),
        transform: center ? "translate(-50%, 50%)" : undefined,
        ...style,
      }}
    >
      <Sprite art={art} palette={palette} className="block w-full" />
    </div>
  );
}

/** A pixel grid as a CSS background tile. */
function tileUrl(art: readonly string[], palette: Palette): string {
  const w = Math.max(...art.map((r) => r.length));
  let rects = "";
  art.forEach((row, y) => [...row].forEach((ch, x) => palette[ch] && (rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${palette[ch]}"/>`)));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${art.length}" shape-rendering="crispEdges">${rects}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function Zone({ index, children }: { index: number; children: ReactNode }) {
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ transform: `translateY(${-index * 100}%)`, background: `linear-gradient(to top, ${EDGES[index + 1]}, ${EDGES[index + 2]})` }}
    >
      {children}
    </div>
  );
}

function Stars({ count, seed, fromBottom, color = "#fff8ec" }: { count: number; seed: number; fromBottom?: number; color?: string }) {
  return (
    <>
      {starfield(count, seed, { fromBottom }).map((s, i) => (
        <span
          key={i}
          className={`absolute ${s.twinkle ? "animate-twinkle" : ""}`}
          style={{ left: `${s.x}%`, bottom: `${s.y}%`, width: px(s.big ? 2 : 1), height: px(s.big ? 2 : 1), background: color, animationDelay: `${s.delay}s` }}
        />
      ))}
    </>
  );
}

// ───────────────────────── below the sea ─────────────────────────

function Deep() {
  const r = seeded(91);
  return (
    <Zone index={-1}>
      {Array.from({ length: 7 }, (_, i) => (
        <Art key={i} art={kelp(18 + Math.round(r() * 22), i + 3)} palette={KELP_COLORS} x={4 + i * 14 + r() * 6} y={0} scale={1} />
      ))}
      <Art art={FISH} palette={{ F: "#2c5d7c", E: "#bfe9ff" }} x={64} y={58} />
      <Art art={FISH} palette={{ F: "#245070", E: "#bfe9ff" }} x={20} y={72} />
    </Zone>
  );
}

// ───────────────────────── Plankton: the sea ─────────────────────────

/** Water surface height in the sea zone (% from the bottom). Matches CLIMB_START in lib/game/climb.ts. */
const SURFACE = 38;
const CLIFF_W = 52;
/** The creek falls down the far left of the cliff, out of the way of the text in the middle. */
const FALL_X = 4;

function Sea() {
  const r = seeded(17);
  return (
    <Zone index={0}>
      {/* low sun on the horizon, behind the water */}
      <Art art={SUN} palette={SUN_PALETTE} x={80} y={SURFACE - 2} scale={2} />
      {/* the cliff the town stands on */}
      <div
        className="absolute left-0"
        style={{
          bottom: `${SURFACE - 1}%`,
          top: 0,
          width: `${CLIFF_W}%`,
          background: "repeating-linear-gradient(to bottom, #4b3554 0 calc(9 * var(--px)), #3e2b48 calc(9 * var(--px)) calc(11 * var(--px)))",
          clipPath: "polygon(0 0, 100% 0, 100% 22%, 96% 22%, 96% 48%, 99% 48%, 99% 74%, 93% 74%, 93% 100%, 0 100%)",
        }}
      />
      {/* the creek falling down the cliff into the sea */}
      <div
        className="climb-waterfall absolute"
        style={{
          left: `${FALL_X}%`,
          width: px(5),
          top: 0,
          bottom: `${SURFACE - 1}%`,
          backgroundImage: "repeating-linear-gradient(to bottom, #bfe9ff 0 calc(2 * var(--px)), #5fb3dc calc(2 * var(--px)) calc(6 * var(--px)))",
        }}
      />
      <div className="absolute" style={{ left: `calc(${FALL_X}% - ${px(3)})`, bottom: `${SURFACE - 1}%`, width: px(11), height: px(3), background: "#e8f7ff" }} />
      {/* beach at the foot of the cliff */}
      <div className="absolute left-0" style={{ bottom: `calc(${SURFACE}% - ${px(1)})`, width: `${CLIFF_W - 10}%`, height: px(3), background: "#e9c58a" }} />
      {/* water */}
      <div className="absolute inset-x-0 bottom-0" style={{ height: `${SURFACE}%`, background: "linear-gradient(to top, #04213a, #1d6a93)" }} />
      <div
        className="climb-waves absolute inset-x-0"
        style={{ bottom: `calc(${SURFACE}% - ${px(3)})`, height: px(4), backgroundImage: tileUrl(WAVE_TILE, WAVE_COLORS), backgroundSize: `${px(10)} ${px(4)}` }}
      />
      <Art art={BOAT} palette={BOAT_COLORS} x={66} y={`calc(${SURFACE}% - ${px(2)})`} className="animate-bob" />
      {/* plankton drifting in the shallows */}
      {Array.from({ length: 16 }, (_, i) => (
        <Art
          key={i}
          art={PLANKTON}
          palette={PLANKTON_COLORS}
          x={r() * 96}
          y={4 + r() * (SURFACE - 12)}
          className="animate-twinkle opacity-80"
          style={{ animationDelay: `${r() * 3}s` }}
        />
      ))}
      <Art art={FISH} palette={{ F: "#ff9a5a", E: "#13163f" }} x={14} y={16} />
      <Art art={FISH} palette={{ F: "#ffd866", E: "#13163f" }} x={78} y={9} />
    </Zone>
  );
}

// ───────────────────────── Too Clever: creekside ─────────────────────────

const GROUND = 18;
/** The creek house sits right next to the creek; the town runs from there to the cliff edge. */
const HOUSE_X = `calc(${FALL_X}% + ${px(9)})`;

function Creekside() {
  const r = seeded(29);
  const roofs = ["flat", "peak", "step"] as const;
  const town = Array.from({ length: 9 }, (_, i) => ({
    art: building(7 + 2 * Math.floor(r() * 3), 8 + Math.floor(r() * 12), i + 1, roofs[i % 3]!),
    palette: { T: ["#3b2f63", "#5b3f5e", "#2f3a6b"][i % 3]!, B: ["#6c5a9e", "#8a6a8e", "#5a6aa8"][i % 3]!, Y: "#ffd866", K: "#2a2448", D: "#3a2430" },
  }));
  return (
    <Zone index={1}>
      <Art art={CLOUD_SMALL} palette={CLOUD_PALETTE} x={70} y={74} scale={2} className="opacity-70" />
      <Art art={BIRD} palette={{ B: "#2a2448" }} x={72} y={48} scale={1} />
      <Art art={BIRD} palette={{ B: "#2a2448" }} x={80} y={53} scale={1} />
      {/* cliff top: rock, grass, and the creek running to the edge */}
      <div className="absolute bottom-0 left-0" style={{ width: `${CLIFF_W}%`, height: `${GROUND}%`, background: "#4b3554" }} />
      <div className="absolute left-0" style={{ bottom: `calc(${GROUND}% - ${px(2)})`, width: `${CLIFF_W}%`, height: px(2), background: "#4f9a5a" }} />
      <div
        className="climb-waves absolute"
        style={{ left: 0, width: `calc(${FALL_X}% + ${px(5)})`, bottom: `calc(${GROUND}% - ${px(3)})`, height: px(3), background: "#5fb3dc" }}
      />
      {/* the town, filling the cliff from the creek outwards */}
      <div
        className="absolute flex items-end justify-start overflow-hidden"
        style={{ left: `calc(${HOUSE_X} + ${px(34)})`, right: `${100 - CLIFF_W + 1}%`, bottom: `${GROUND}%`, gap: px(2) }}
      >
        {town.slice(0, 4).map((b, i) => (
          <Sprite key={i} art={b.art} palette={b.palette} className="block shrink-0" style={{ width: px(b.art[0]!.length * 2) }} />
        ))}
        <Sprite art={CHAPEL} palette={CHAPEL_COLORS} className="block shrink-0" style={{ width: px(CHAPEL[0].length * 2) }} />
        {town.slice(4).map((b, i) => (
          <Sprite key={i} art={b.art} palette={b.palette} className="block shrink-0" style={{ width: px(b.art[0]!.length * 2) }} />
        ))}
      </div>
      <Art art={CREEK_HOUSE} palette={CREEK_HOUSE_COLORS} x={HOUSE_X} y={GROUND} scale={2} />
      {/* chimney smoke */}
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="absolute animate-bob bg-cloud-50/50"
          style={{
            left: `calc(${HOUSE_X} + ${px(22 + i * 2)})`,
            bottom: `calc(${GROUND}% + ${px(24 + i * 6)})`,
            width: px(3 + i * 2),
            height: px(3 + i * 2),
            animationDelay: `${i * 0.4}s`,
          }}
        />
      ))}
    </Zone>
  );
}

// ───────────────────────── Schooler: open sky ─────────────────────────

function OpenSky() {
  const clouds = [
    { x: -4, y: 12, big: true, s: 3 },
    { x: 58, y: 22, big: false, s: 3 },
    { x: 30, y: 38, big: true, s: 2 },
    { x: 76, y: 70, big: true, s: 3 },
    { x: 6, y: 80, big: false, s: 2 },
    { x: 44, y: 88, big: false, s: 2 },
  ];
  return (
    <Zone index={2}>
      {clouds.map((c, i) => (
        <Art key={i} art={c.big ? CLOUD_BIG : CLOUD_SMALL} palette={CLOUD_PALETTE} x={c.x} y={c.y} scale={c.s} className="opacity-85" />
      ))}
      <Art art={BALLOON} palette={BALLOON_COLORS} x={70} y={44} scale={2} className="animate-bob" />
      {/* a flock of doves in a V */}
      {[0, 1, 2, 3, 4].map((i) => (
        <Art
          key={i}
          art={BIRD}
          palette={{ B: "#fff8ec" }}
          x={`calc(14% + ${px(i * 6)})`}
          y={`calc(64% + ${px(Math.abs(i - 2) * -3)})`}
          scale={1}
          className="animate-bob"
          style={{ animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </Zone>
  );
}

// ───────────────────────── Rare: the edge of space ─────────────────────────

function EdgeOfSpace() {
  return (
    <Zone index={3}>
      <Stars count={40} seed={33} fromBottom={30} />
      <div className="absolute inset-x-0 opacity-60" style={{ bottom: "4%" }}>
        <Sprite art={aurora(96, 30, 4)} palette={AURORA_COLORS} className="block w-full" />
      </div>
      <Art art={SATELLITE} palette={SATELLITE_COLORS} x={66} y={66} scale={2} className="animate-bob" />
      <span className="climb-shooting absolute" style={{ left: "8%", bottom: "84%", width: px(26), height: px(1), background: "linear-gradient(to right, transparent, #fff8ec)" }} />
    </Zone>
  );
}

// ───────────────────────── Deep Cut: outer space ─────────────────────────

const RINGED = planet(11, { bands: true, ring: true });
const RED = planet(5, { seed: 8 });
const MOON = planet(7, { craters: 5, seed: 12 });

function OuterSpace() {
  return (
    <Zone index={4}>
      <Stars count={90} seed={44} />
      <Art art={MOON} palette={{ A: "#c9c3d9", C: "#f1ecff", S: "#8a83a6", D: "#9e97b8" }} x={8} y={74} scale={2} />
      <Art art={RINGED} palette={{ A: "#e0a35a", C: "#ffd99a", S: "#9a5a3a", D: "#c27a44", R: "#e8d8b8", Q: "#b8a48a" }} x={70} y={68} scale={1.5} center />
      <Art art={RED} palette={{ A: "#d4553a", C: "#ff8a66", S: "#7a2a2a", D: "#b8442e" }} x={18} y={20} scale={2} />
    </Zone>
  );
}

// ───────────────────────── One in a Million: the cosmos ─────────────────────────

const NEBULA_A = nebula(170, 60, 3);
const NEBULA_B = nebula(170, 60, 21);
const GALAXY = galaxy(49, 27, 6);

function Cosmos() {
  const r = seeded(55);
  return (
    <Zone index={5}>
      <Art art={NEBULA_A} palette={NEBULA_COLORS} x={50} y={70} scale={2} center className="opacity-30" />
      <Art art={NEBULA_B} palette={NEBULA_COLORS} x={50} y={18} scale={2} center className="opacity-25" />
      <Stars count={130} seed={66} />
      <div
        className="absolute inset-x-0 top-0 h-2/3"
        style={{ background: "radial-gradient(ellipse 70% 60% at 50% 0%, rgba(255,216,102,0.45), rgba(255,216,102,0) 70%)" }}
      />
      <Art art={GALAXY} palette={GALAXY_COLORS} x={50} y={74} scale={2} center />
      {Array.from({ length: 9 }, (_, i) => (
        <Art
          key={i}
          art={SPARKLE}
          palette={SPARKLE_COLORS}
          x={r() * 94}
          y={8 + r() * 86}
          scale={r() < 0.4 ? 2 : 1}
          className="animate-twinkle"
          style={{ animationDelay: `${r() * 3}s` }}
        />
      ))}
    </Zone>
  );
}

/** The whole tower, bottom to top. */
export function ClimbWorld() {
  return (
    <>
      <Deep />
      <Sea />
      <Creekside />
      <OpenSky />
      <EdgeOfSpace />
      <OuterSpace />
      <Cosmos />
    </>
  );
}
