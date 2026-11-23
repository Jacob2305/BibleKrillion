/** Below the sea, Plankton (the sea) and Too Clever (creekside). Art lives in sea-art.ts. */
import type { CSSProperties } from "react";
import { Sprite, type Palette } from "../pixel";
import { seeded } from "./art";
import {
  ANCHOR,
  ANCHOR_COLORS,
  BUBBLE_COLORS,
  BUBBLE_M,
  BUBBLE_S,
  BRANCH_CORAL,
  BUSH,
  BUSH_COLORS,
  CLIFF_EDGE_COLORS,
  CLOUD2_COLORS,
  CORAL_ORANGE,
  CORAL_PINK,
  CREEK_COLORS,
  CREEK_HOUSE2_COLORS,
  CREEK_LIP,
  CREEK_LIP_COLORS,
  CHAPEL2_COLORS,
  DEEP_ROCK_COLORS,
  FALL_COLORS,
  FENCE,
  FENCE_COLORS,
  FISH_PALETTES,
  FLOOR_COLORS,
  FOAM_COLORS,
  GLINT_COLORS,
  GLOW_COLORS,
  GLOW_DOT,
  GLOW_M,
  GLOW_S,
  GRASS_CAP,
  GRASS_COLORS,
  GULL,
  GULL_COLORS,
  JELLY,
  JELLY_COLORS,
  KELP2_COLORS,
  KRILL,
  KRILL_COLORS,
  LAMP,
  LAMP_COLORS,
  MINNOW,
  MINNOW_COLORS,
  MOSS_COLORS,
  OVERHANG_COLORS,
  PUFF_COLORS,
  RIPPLE,
  RIPPLE_COLORS,
  ROCK_COLORS,
  SAILBOAT_COLORS,
  SAND_COLORS,
  SAND_END,
  SEA_ROCK_COLORS,
  SHELL,
  SHELL_COLORS,
  STARFISH,
  STARFISH_COLORS,
  STREAK_COLORS,
  SUN_COLORS,
  TOWN_PALETTES,
  TREE_COLORS,
  TUFT,
  WAVE2_COLORS,
  boulder,
  chapel,
  cliffEdgeTile,
  cloud,
  cloudStreak,
  tubeCoral,
  creekHouse,
  creekTile,
  fallTile,
  fish,
  flip,
  floorTile,
  foam,
  grassTile,
  kelp2,
  ledge,
  overhang,
  puff,
  rockTile,
  sailboat,
  sandTile,
  sunGlint,
  sunsetSun,
  tileBg,
  townHouse,
  tree,
  vine,
  waveTile,
} from "./sea-art";
import { Art, Zone, px } from "./zone";

// ───────────────────────── shared bits ─────────────────────────

/** A repeating pixel tile as a background, `w`×`h` art pixels per tile. */
function tile(art: readonly string[], palette: Palette, anchor = "0 0"): CSSProperties {
  const w = Math.max(...art.map((r) => r.length));
  return { backgroundImage: tileBg(art, palette), backgroundSize: `${px(w)} ${px(art.length)}`, backgroundPosition: anchor, imageRendering: "pixelated" };
}

/** A sprite placed by its top-right corner (for things hung off the cliff edge). */
function Hung({ art, palette, right, top }: { art: readonly string[]; palette: Palette; right: string; top: string }) {
  const cols = Math.max(...art.map((r) => r.length));
  return <Sprite art={art} palette={palette} className="absolute block" style={{ right, top, width: px(cols) }} />;
}

const ROCK = rockTile(120, 72, 7);
const ROCK_BG = (anchor: string) => tile(ROCK, ROCK_COLORS, anchor);
const EDGE = cliffEdgeTile(36, 11);
const EDGE_BG = (anchor: string) => tile(EDGE, CLIFF_EDGE_COLORS, anchor);
const FALL_BG = tile(fallTile(24, 5), FALL_COLORS);
/** Width of the cliff's edge strip; the rock body stops this many pixels short of the edge, less 2 (the jaggies). */
const EDGE_W = 6;

// ───────────────────────── below the sea ─────────────────────────

const FLOOR = floorTile(3);
const KELPS = [30, 20, 38, 24, 34, 18, 28, 36].map((h, i) => kelp2(h, i + 3));
const DEEP_ROCKS = [boulder(16, 10, 2), boulder(22, 13, 4), boulder(11, 8, 6)];
const CORALS = [BRANCH_CORAL, tubeCoral(4), flip(BRANCH_CORAL)];
const DEEP_FISH = fish(16, 7, { fin: true });
const VIOLET_FISH = flip(fish(13, 6, { stripes: [5, 8] }));

/**
 * The sea bed lies at the very bottom of the sea zone, so it's in view on the
 * start frame (the camera rests a little below the sea zone, see CLIMB_START).
 * Under it, the deep zone is solid ground.
 */
const ON_BED = (n: number) => px(n);

/** Kelp, coral, rocks and the creatures down by the sea bed (drawn inside the sea zone). */
function SeaBed() {
  const r = seeded(91);
  return (
    <>
      {Array.from({ length: 7 }, (_, i) => (
        <Art
          key={`b${i}`}
          art={i % 3 === 0 ? BUBBLE_M : BUBBLE_S}
          palette={BUBBLE_COLORS}
          x={6 + i * 14 + r() * 5}
          y={`calc(${px(14)} + ${(r() * 14).toFixed(1)}%)`}
          className="animate-bob opacity-70"
          style={{ animationDelay: `${r() * 1.6}s` }}
        />
      ))}
      {KELPS.map((k, i) => (
        <Art key={`k${i}`} art={k} palette={KELP2_COLORS} x={1 + i * 12.5 + r() * 4} y={ON_BED(6)} />
      ))}
      <Art art={CORALS[0]!} palette={CORAL_PINK} x={47} y={ON_BED(6)} />
      <Art art={CORALS[2]!} palette={CORAL_ORANGE} x={92} y={ON_BED(6)} />
      <Art art={DEEP_ROCKS[0]!} palette={DEEP_ROCK_COLORS} x={27} y={ON_BED(6)} />
      <Art art={DEEP_ROCKS[1]!} palette={DEEP_ROCK_COLORS} x={60} y={ON_BED(6)} />
      <Art art={DEEP_ROCKS[2]!} palette={DEEP_ROCK_COLORS} x={76} y={ON_BED(6)} />
      <div className="absolute inset-x-0 bottom-0" style={{ height: px(12), ...tile(FLOOR, FLOOR_COLORS) }} />
      <Art art={ANCHOR} palette={ANCHOR_COLORS} x={84} y={ON_BED(4)} />
      <Art art={CORALS[1]!} palette={CORAL_ORANGE} x={7} y={ON_BED(5)} />
      <Art art={SHELL} palette={SHELL_COLORS} x={68} y={ON_BED(5)} />
      <Art art={STARFISH} palette={STARFISH_COLORS} x={18} y={ON_BED(5)} />
      <Art art={JELLY} palette={JELLY_COLORS} x={88} y={20} className="animate-bob" />
      <Art art={JELLY} palette={JELLY_COLORS} x={33} y={16} className="animate-bob opacity-70" style={{ animationDelay: "0.8s" }} />
      <Art art={DEEP_FISH} palette={FISH_PALETTES.deep} x={54} y={`calc(${px(22)} + 1%)`} />
      <Art art={VIOLET_FISH} palette={FISH_PALETTES.violet} x={6} y={`calc(${px(30)} + 2%)`} />
    </>
  );
}

const BURIED_ROCK: Palette = { H: "#2a4258", B: "#203448", S: "#1a2a3c", D: "#132131", K: "#0c1624" };
const BURIED = (() => {
  const r = seeded(77);
  return Array.from({ length: 14 }, (_, i) => ({
    art: i % 5 === 4 ? SHELL : boulder(5 + Math.floor(r() * 8), 3 + Math.floor(r() * 4), i + 50),
    palette: i % 5 === 4 ? SHELL_COLORS : BURIED_ROCK,
    x: ((i + r() * 0.7) / 14) * 100 - 2,
    y: 60 + r() * 34,
  }));
})();

/** Under the sea bed: solid ground, darker the deeper it goes. */
export function Deep() {
  return (
    <Zone index={-1}>
      <div className="absolute inset-0" style={{ background: `linear-gradient(to top, #0b1420, ${FLOOR_COLORS.S} 60%)` }} />
      {/* stones and old shells buried in the ground */}
      {BURIED.map((b, i) => (
        <Art key={i} art={b.art} palette={b.palette} x={b.x} y={b.y} className="opacity-60" />
      ))}
    </Zone>
  );
}

// ───────────────────────── Plankton: the sea ─────────────────────────

/** Water surface height in the sea zone (% from the bottom). Matches CLIMB_START in lib/game/climb.ts. */
const SURFACE = 38;
const CLIFF_W = 52;
/** The creek falls down the far left of the cliff, out of the way of the text in the middle. */
const FALL_X = 4;
/** The cliff face, top to bottom: each segment runs to `to`% of the cliff's height, set back `inset` pixels from its edge. */
const SEGMENTS = [
  { to: 22, inset: 0 },
  { to: 48, inset: 8 },
  { to: 74, inset: 3 },
  { to: 100, inset: 12 },
];
const SUN_X = 72;

const SUN_ART = sunsetSun(13);
const GLINTS = [sunGlint(30, 26, 3), sunGlint(30, 26, 8)];
const STREAKS = [cloudStreak(44, 3), cloudStreak(28, 8), cloudStreak(20, 13)];
const WAVES_BG = tile(waveTile(), WAVE2_COLORS);
const SAND_BG = tile(sandTile(4), SAND_COLORS);
const FOAMS = [foam(22, 8, 2), foam(22, 8, 7)];
const BOAT_ART = sailboat();
const SEA_ROCKS = [boulder(13, 9, 3), boulder(8, 6, 8)];
const CLOWN = fish(16, 7, { fin: true, stripes: [6, 10] });
const TANG = flip(fish(14, 9, { fin: true, tail: 4 }));
const MACKEREL = flip(fish(18, 5, { stripes: [6, 9, 12] }));
const KRILL_L = flip(KRILL);
const LEDGES = SEGMENTS.slice(1).map((s, i) => {
  const up = SEGMENTS[i]!;
  const jut = Math.abs(up.inset - s.inset);
  return up.inset > s.inset
    ? { kind: "ledge" as const, at: up.to, right: s.inset, art: ledge(jut + EDGE_W + 2, i + 4) }
    : { kind: "over" as const, at: up.to, right: up.inset, art: overhang(jut + EDGE_W, jut, i + 4) };
});
const VINES = [vine(12, 2), vine(18, 5), vine(9, 8)];

function SeaCliff() {
  const clip = (inset: number) => `calc(100% - ${px(inset + EDGE_W - 2)})`;
  let from = 0;
  const pts = ["0 0"];
  for (const s of SEGMENTS) {
    pts.push(`${clip(s.inset)} ${from}%`, `${clip(s.inset)} ${s.to}%`);
    from = s.to;
  }
  pts.push("0 100%");
  return (
    <div className="absolute left-0" style={{ top: 0, bottom: `${SURFACE - 1}%`, width: `${CLIFF_W}%` }}>
      <div className="absolute inset-0" style={{ ...ROCK_BG("0 0"), clipPath: `polygon(${pts.join(", ")})` }} />
      {SEGMENTS.map((s, i) => {
        const top = i === 0 ? 0 : SEGMENTS[i - 1]!.to;
        return (
          <div
            key={i}
            className="absolute inset-y-0"
            style={{ right: px(s.inset), width: px(EDGE_W), ...EDGE_BG("0 0"), clipPath: `inset(${top}% 0 ${100 - s.to}% 0)` }}
          />
        );
      })}
      {LEDGES.map((l, i) => (
        <Hung key={i} art={l.art} palette={l.kind === "ledge" ? MOSS_COLORS : OVERHANG_COLORS} right={px(l.right)} top={`calc(${l.at}% - ${px(l.kind === "ledge" ? 3 : 1)})`} />
      ))}
      {/* ivy hanging off the mossy ledge and the cliff top */}
      <Hung art={VINES[0]!} palette={MOSS_COLORS} right={px(6)} top={`calc(48% + ${px(2)})`} />
      <Hung art={VINES[2]!} palette={MOSS_COLORS} right={px(10)} top={`calc(48% + ${px(2)})`} />
      <Hung art={VINES[1]!} palette={MOSS_COLORS} right={px(3)} top="0" />
    </div>
  );
}

export function Sea() {
  const r = seeded(17);
  return (
    <Zone index={0}>
      {/* the low sun, a warm band on the horizon, and thin clouds across it */}
      <div className="absolute inset-x-0" style={{ bottom: `${SURFACE}%`, height: px(10), background: "rgba(255,186,140,0.12)" }} />
      <div className="absolute inset-x-0" style={{ bottom: `${SURFACE}%`, height: px(4), background: "rgba(255,186,140,0.16)" }} />
      <Art art={SUN_ART} palette={SUN_COLORS} x={SUN_X} y={`calc(${SURFACE}% - ${px(6)})`} />
      <Art art={STREAKS[0]!} palette={STREAK_COLORS} x={`calc(${SUN_X}% - ${px(22)})`} y={`calc(${SURFACE}% + ${px(9)})`} />
      <Art art={STREAKS[1]!} palette={STREAK_COLORS} x={`calc(${SUN_X}% + ${px(12)})`} y={`calc(${SURFACE}% + ${px(20)})`} />
      <Art art={STREAKS[2]!} palette={STREAK_COLORS} x={`calc(${SUN_X}% - ${px(8)})`} y={`calc(${SURFACE}% + ${px(31)})`} className="opacity-80" />
      <Art art={GULL} palette={GULL_COLORS} x={84} y={64} />
      <Art art={GULL} palette={GULL_COLORS} x={66} y={70} />
      {/* the cliff the town stands on */}
      <SeaCliff />
      {/* the creek falling down the cliff into the sea, wet rock either side */}
      <div className="absolute" style={{ left: `calc(${FALL_X}% - ${px(1)})`, width: px(10), top: 0, bottom: `${SURFACE - 1}%`, background: "rgba(28,16,38,0.45)" }} />
      <div className="sea-fall absolute" style={{ left: `${FALL_X}%`, width: px(8), top: 0, bottom: `${SURFACE - 1}%`, ...FALL_BG }} />
      {/* beach at the foot of the cliff */}
      <div className="absolute left-0" style={{ bottom: `calc(${SURFACE}% - ${px(1)})`, width: `calc(${CLIFF_W}% - ${px(10)})`, height: px(6), ...SAND_BG }} />
      <Art art={SAND_END} palette={SAND_COLORS} x={`calc(${CLIFF_W}% - ${px(10)})`} y={`calc(${SURFACE}% - ${px(1)})`} />
      {/* water */}
      <div className="absolute inset-x-0 bottom-0" style={{ height: `${SURFACE}%`, background: "linear-gradient(to top, #04213a, #1d6a93)" }} />
      <SeaBed />
      {GLINTS.map((g, i) => (
        <Art
          key={i}
          art={g}
          palette={GLINT_COLORS}
          x={`calc(${SUN_X}% + ${px(2)})`}
          y={`calc(${SURFACE}% - ${px(28)})`}
          className="animate-twinkle"
          style={{ animationDelay: `${i * 1.5}s` }}
        />
      ))}
      {Array.from({ length: 7 }, (_, i) => (
        <Art key={`r${i}`} art={RIPPLE} palette={RIPPLE_COLORS} x={CLIFF_W * 0.2 + r() * 70} y={SURFACE - 5 - r() * 10} className="opacity-70" />
      ))}
      <Art art={BOAT_ART} palette={SAILBOAT_COLORS} x={60} y={`calc(${SURFACE}% - ${px(2)})`} className="animate-bob" />
      <div className="sea-waves absolute inset-x-0" style={{ bottom: `calc(${SURFACE}% - ${px(5)})`, height: px(7), ...WAVES_BG }} />
      <Art art={SEA_ROCKS[0]!} palette={SEA_ROCK_COLORS} x={`calc(${CLIFF_W}% - ${px(8)})`} y={`calc(${SURFACE}% - ${px(4)})`} />
      <Art art={SEA_ROCKS[1]!} palette={SEA_ROCK_COLORS} x={`calc(${CLIFF_W}% + ${px(6)})`} y={`calc(${SURFACE}% - ${px(3)})`} />
      {FOAMS.map((f, i) => (
        <Art
          key={i}
          art={f}
          palette={FOAM_COLORS}
          x={`calc(${FALL_X}% - ${px(7)})`}
          y={`calc(${SURFACE}% - ${px(4)})`}
          className={i ? "climb-flap-b" : "climb-flap-a"}
        />
      ))}
      {/* plankton and krill drifting in the shallows */}
      {Array.from({ length: 18 }, (_, i) => (
        <Art
          key={`p${i}`}
          art={i % 4 === 0 ? GLOW_M : i % 4 === 1 ? GLOW_DOT : GLOW_S}
          palette={GLOW_COLORS}
          x={r() * 96}
          y={4 + r() * (SURFACE - 14)}
          className="animate-twinkle opacity-80"
          style={{ animationDelay: `${r() * 3}s` }}
        />
      ))}
      {Array.from({ length: 4 }, (_, i) => (
        <Art
          key={`k${i}`}
          art={i % 2 ? KRILL_L : KRILL}
          palette={KRILL_COLORS}
          x={8 + i * 24 + r() * 8}
          y={6 + r() * (SURFACE - 16)}
          className="animate-bob"
          style={{ animationDelay: `${r() * 1.6}s` }}
        />
      ))}
      <Art art={CLOWN} palette={FISH_PALETTES.clown} x={12} y={15} />
      <Art art={TANG} palette={FISH_PALETTES.tang} x={78} y={8} />
      <Art art={MACKEREL} palette={FISH_PALETTES.mackerel} x={44} y={22} />
      {[0, 1, 2, 3, 4].map((i) => (
        <Art key={`s${i}`} art={MINNOW} palette={MINNOW_COLORS} x={62 + (i % 2) * 3 + i * 1.5} y={14 + ((i * 3) % 5) * 1.4} />
      ))}
    </Zone>
  );
}

// ───────────────────────── Too Clever: creekside ─────────────────────────

const GROUND = 18;
/** The creek house sits right next to the creek; the town runs from there to the cliff edge. */
const HOUSE_X = `calc(${FALL_X}% + ${px(10)})`;
/** Every town item stands in a slot this tall, so a row that doesn't fit wraps out of sight whole. */
const TOWN_H = 64;

const HOUSE = creekHouse();
const GRASS_BG = tile(grassTile(6), GRASS_COLORS);
const CREEK_BG = tile(creekTile(), CREEK_COLORS);
const CLOUDS = [cloud(50, 17, 4), cloud(30, 11, 9), cloud(38, 13, 12)];
const PUFFS = [puff(5), puff(7), puff(9), puff(11)];
const TOWN: { art: readonly string[]; palette: Palette }[] = [
  { art: townHouse(14, 3, 1, "peak"), palette: TOWN_PALETTES[0]! },
  { art: townHouse(20, 4, 2, "flat"), palette: TOWN_PALETTES[2]! },
  { art: LAMP, palette: LAMP_COLORS },
  { art: chapel(), palette: CHAPEL2_COLORS },
  { art: townHouse(14, 5, 6, "flat"), palette: TOWN_PALETTES[1]! },
  { art: tree(12, 20, 3), palette: TREE_COLORS },
  { art: townHouse(18, 3, 5, "step"), palette: TOWN_PALETTES[3]! },
  { art: LAMP, palette: LAMP_COLORS },
  { art: townHouse(16, 2, 7, "peak"), palette: TOWN_PALETTES[2]! },
  { art: FENCE, palette: FENCE_COLORS },
];

export function Creekside() {
  return (
    <Zone index={1}>
      <Art art={CLOUDS[0]!} palette={CLOUD2_COLORS} x={64} y={72} className="opacity-90" />
      <Art art={CLOUDS[1]!} palette={CLOUD2_COLORS} x={6} y={88} className="opacity-60" />
      <Art art={CLOUDS[2]!} palette={CLOUD2_COLORS} x={86} y={52} className="opacity-75" />
      <Art art={GULL} palette={GULL_COLORS} x={72} y={46} />
      <Art art={GULL} palette={GULL_COLORS} x={80} y={52} />
      <Art art={GULL} palette={GULL_COLORS} x={76} y={58} className="opacity-70" />
      {/* cliff top: rock, grass, and the creek running to the edge */}
      <div className="absolute bottom-0 left-0" style={{ height: `${GROUND}%`, width: `${CLIFF_W}%` }}>
        <div className="absolute inset-y-0 left-0" style={{ right: px(EDGE_W - 2), ...ROCK_BG("0 100%") }} />
        <div className="absolute inset-y-0 right-0" style={{ width: px(EDGE_W), ...EDGE_BG("0 100%") }} />
      </div>
      <div className="absolute left-0" style={{ bottom: `calc(${GROUND}% - ${px(5)})`, height: px(7), width: `calc(${CLIFF_W}% - ${px(3)})`, ...GRASS_BG }} />
      <Art art={GRASS_CAP} palette={GRASS_COLORS} x={`calc(${CLIFF_W}% - ${px(4)})`} y={`calc(${GROUND}% - ${px(6)})`} />
      <div className="absolute" style={{ left: `calc(${FALL_X}% - ${px(1)})`, width: px(10), bottom: 0, height: `calc(${GROUND}% - ${px(3)})`, background: "rgba(28,16,38,0.45)" }} />
      <div className="sea-fall absolute" style={{ left: `${FALL_X}%`, width: px(8), bottom: 0, height: `calc(${GROUND}% - ${px(3)})`, ...FALL_BG }} />
      <div className="sea-waves absolute left-0" style={{ width: `calc(${FALL_X}% + ${px(8)})`, bottom: `calc(${GROUND}% - ${px(3)})`, height: px(5), ...CREEK_BG }} />
      <Art art={CREEK_LIP} palette={CREEK_LIP_COLORS} x={`${FALL_X}%`} y={`calc(${GROUND}% - ${px(6)})`} />
      {/* the town, filling the cliff from the creek house outwards */}
      <div
        className="absolute flex flex-wrap content-start items-end overflow-hidden"
        style={{ left: `calc(${HOUSE_X} + ${px(37)})`, right: `calc(${100 - CLIFF_W}% + ${px(3)})`, bottom: `${GROUND}%`, height: px(TOWN_H), columnGap: px(2) }}
      >
        {TOWN.map((b, i) => (
          <div key={i} className="flex shrink-0 items-end" style={{ height: px(TOWN_H) }}>
            <Sprite art={b.art} palette={b.palette} className="block" style={{ width: px(b.art[0]!.length) }} />
          </div>
        ))}
      </div>
      <Art art={HOUSE} palette={CREEK_HOUSE2_COLORS} x={HOUSE_X} y={GROUND} />
      <Art art={BUSH} palette={BUSH_COLORS} x={`calc(${HOUSE_X} - ${px(3)})`} y={`calc(${GROUND}% - ${px(1)})`} />
      <Art art={TUFT} palette={GRASS_COLORS} x={`calc(${HOUSE_X} + ${px(33)})`} y={`calc(${GROUND}% - ${px(1)})`} />
      {/* chimney smoke */}
      {PUFFS.map((p, i) => (
        <Art
          key={i}
          art={p}
          palette={PUFF_COLORS}
          x={`calc(${HOUSE_X} + ${px(27 - p.length / 2 + i * 3)})`}
          y={`calc(${GROUND}% + ${px(31 + [0, 5, 11, 19][i]!)})`}
          className="animate-bob"
          style={{ animationDelay: `${i * 0.4}s`, opacity: 0.9 - i * 0.15 }}
        />
      ))}
    </Zone>
  );
}
