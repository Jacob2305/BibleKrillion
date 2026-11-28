/** Deep Cut (outer space) and One in a Million (the cosmos). Art lives in space-art.ts. */
import { seeded } from "./art";
import { gridUrl } from "./sky-art";
import {
  asteroid,
  bluePlanet,
  comet,
  moon,
  NEBULA_PALETTE,
  nebulaClouds,
  redPlanet,
  ringedPlanet,
  SPARKLE_4,
  SPARKLE_8,
  SPARKLE_TINTS,
  SPARKLE_TINY,
  SPACE_STATION,
  SPACE_STATION_COLORS,
  spiralGalaxy,
  starCluster,
} from "./space-art";
import { METEOR, METEOR_COLORS } from "./sky-art";
import { Art, Stars, Zone, px } from "./zone";

/** Nebula image size in art pixels (shared by both zones). */
const NEB_W = 320;
const NEB_H = 104;

// ───────────────────────── Deep Cut: outer space ─────────────────────────

const RINGED = ringedPlanet(17);
const MOON = moon(14, 12);
const RED = redPlanet(10, 8);
const BLUE = bluePlanet(6, 3);
const COMET = comet(64);
const ROCKS = [
  { a: asteroid(5, 4), x: 63, y: 9 },
  { a: asteroid(3.5, 9), x: 70, y: 14 },
  { a: asteroid(2.5, 17), x: 77, y: 7 },
  { a: asteroid(6, 23), x: 91, y: 6 },
  { a: asteroid(2, 31), x: 56, y: 16 },
  { a: asteroid(3, 40), x: 83, y: 16 },
];

/**
 * Extra depth for WIDE screens only (the projector). A portrait phone already
 * looks full, so none of this renders there: faint nebula wisps, a soft glow,
 * an asteroid belt, a distant galaxy, a drifting station, coloured twinkles and
 * an occasional shooting star. The band right of centre (where the projector
 * stacks answer boxes) and the top (behind the prompt) are left quiet.
 */
const WIDE = "hidden landscape:min-[900px]:block";
const DEEP_WISP_LOW = gridUrl(nebulaClouds(NEB_W, NEB_H, 83, ["G", "T", "G", "M", "G", "T"], "both", 0.5), NEBULA_PALETTE);
const DEEP_WISP_HIGH = gridUrl(nebulaClouds(NEB_W, NEB_H, 91, ["M", "G", "G", "T", "G", "G"], "both", 0.35), NEBULA_PALETTE);
const DEEP_GALAXY = spiralGalaxy(38, 16, 47);
/** A belt of small rocks running up and left from the existing cluster at bottom right. */
const BELT = (() => {
  const r = seeded(212);
  return Array.from({ length: 11 }, (_, i) => {
    const t = i / 10;
    return { a: asteroid(1.5 + r() * 2, 300 + i), x: 52 - t * 30 + (r() - 0.5) * 4, y: 21 + t * 17 + (r() - 0.5) * 5 };
  });
})();
const DEEP_TWINKLES = [
  { x: 27, y: 50, kind: 2, tint: 1, delay: 0.4 },
  { x: 27, y: 7, kind: 0, tint: 2, delay: 1.6 },
  { x: 55, y: 52, kind: 2, tint: 0, delay: 2.3 },
  { x: 33, y: 27, kind: 1, tint: 3, delay: 0.9 },
  { x: 60, y: 4, kind: 2, tint: 1, delay: 2.8 },
  { x: 22, y: 62, kind: 2, tint: 2, delay: 1.2 },
  { x: 47, y: 15, kind: 2, tint: 3, delay: 0.1 },
];
const DEEP_SPARKLES = [SPARKLE_4, SPARKLE_8, SPARKLE_TINY];

function WideDeepSpace() {
  return (
    <div className={`absolute inset-0 ${WIDE}`} aria-hidden="true">
      {/* soft violet and teal light pooling across the middle */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 38% 30% at 40% 70%, rgba(140,110,255,0.16), rgba(140,110,255,0) 70%), radial-gradient(ellipse 30% 26% at 22% 45%, rgba(90,220,230,0.10), rgba(90,220,230,0) 70%)",
        }}
      />
      <div className="absolute inset-0 opacity-40">
        <Nebula url={DEEP_WISP_LOW} y={30} />
      </div>
      <div className="absolute inset-0 opacity-20">
        <Nebula url={DEEP_WISP_HIGH} y={64} />
      </div>
      <Stars count={60} seed={47} />
      <Stars count={14} seed={48} color="#ffb0dc" />
      <Art art={DEEP_GALAXY.art} palette={DEEP_GALAXY.palette} x={38} y={12} center className="opacity-60" />
      {BELT.map((b, i) => (
        <Art key={i} art={b.a.art} palette={b.a.palette} x={b.x} y={b.y} center className="opacity-90" />
      ))}
      <div className="deep-station absolute" style={{ left: "52%", bottom: "39%" }}>
        <Art art={SPACE_STATION} palette={SPACE_STATION_COLORS} x={0} y={0} className="relative" />
      </div>
      {DEEP_TWINKLES.map((t, i) => (
        <Art
          key={`tw${i}`}
          art={DEEP_SPARKLES[t.kind]!}
          palette={SPARKLE_TINTS[t.tint]!}
          x={t.x}
          y={t.y}
          center
          className="animate-twinkle"
          style={{ animationDelay: `${t.delay}s` }}
        />
      ))}
      <Art art={METEOR} palette={METEOR_COLORS} x={20} y={56} className="deep-shooting" />
    </div>
  );
}

export function OuterSpace() {
  return (
    <Zone index={4}>
      <WideDeepSpace />
      <Stars count={90} seed={44} />
      <Stars count={14} seed={45} color="#a8e4ff" />
      <Stars count={10} seed={46} color="#ffd9a0" />
      <Art art={MOON.art} palette={MOON.palette} x={8} y={72} />
      <Art art={RINGED.art} palette={RINGED.palette} x={72} y={66} center />
      <div className="space-comet absolute" style={{ left: "4%", bottom: "40%" }}>
        <Art art={COMET.art} palette={COMET.palette} x={0} y={0} className="relative" />
      </div>
      <Art art={RED.art} palette={RED.palette} x={15} y={19} />
      <Art art={BLUE.art} palette={BLUE.palette} x={86} y={30} center />
      {ROCKS.map((r, i) => (
        <Art key={i} art={r.a.art} palette={r.a.palette} x={r.x} y={r.y} center />
      ))}
    </Zone>
  );
}

// ───────────────────────── One in a Million: the cosmos ─────────────────────────

/** The nebulae are big, so they're drawn as images (no DOM nodes per pixel run). */
const NEBULA_TOP = gridUrl(nebulaClouds(NEB_W, NEB_H, 3, ["M", "T", "G", "M", "T", "G"]), NEBULA_PALETTE);
/** A dimmer, mostly violet layer that fills the band across the middle. */
const NEBULA_MID = gridUrl(nebulaClouds(NEB_W, NEB_H, 37, ["G", "M", "G", "G", "M", "G"], "both", 0.45), NEBULA_PALETTE);
const NEBULA_LOW = gridUrl(nebulaClouds(NEB_W, NEB_H, 21, ["G", "M", "T", "G", "M", "T"], "both", 0.8), NEBULA_PALETTE);

function Nebula({ url, y }: { url: string; y: number }) {
  return (
    <div
      className="absolute"
      style={{
        left: "50%",
        bottom: `${y}%`,
        width: px(NEB_W),
        height: px(NEB_H),
        transform: "translate(-50%, 50%)",
        backgroundImage: url,
        backgroundSize: "100% 100%",
        imageRendering: "pixelated",
      }}
    />
  );
}
/**
 * The centrepiece: a big three-armed spiral BELOW the tier line (the line sits at
 * 50% of the zone), so it shows under the prompt and the answer boxes when the
 * climb stops here. Its width is capped at 94% of the zone so a portrait phone
 * still sees all of it.
 */
const GALAXY = spiralGalaxy(156, 62, 6, { arms: 3, knots: 170 });
const GALAXY_COLS = Math.max(...GALAXY.art.map((r) => r.length));
const GALAXY_Y = 27;
/** A bigger ringed giant beside the galaxy (landscape) or tucked under it (portrait). */
const BIG_RINGED = ringedPlanet(11, -16);
/** Far-off galaxies, high up: a tilted spiral and a nearly edge-on one. */
const FAR_GALAXY_A = spiralGalaxy(46, 24, 13);
const FAR_GALAXY_B = spiralGalaxy(40, 12, 29);
const CLUSTER_A = starCluster(32, 50, 5);
const CLUSTER_B = starCluster(32, 50, 9);
const FAR_BLUE = bluePlanet(5, 11);
const SPARKLES = [SPARKLE_4, SPARKLE_8, SPARKLE_TINY, SPARKLE_TINY];

/**
 * Sparkle spots: alternating left and right halves and stepping up the screen,
 * so both sides get the same number. Around the galaxy they hug the edges.
 */
const SPARKLE_SPOTS = (() => {
  const r = seeded(55);
  const out: { x: number; y: number; kind: number; tint: number; delay: number }[] = [];
  const n = 18;
  for (let i = 0; i < n; i++) {
    const left = i % 2 === 0;
    const y = 5 + ((i + r()) / n) * 88;
    let x = 3 + r() * 44;
    if (y > 8 && y < 46) x = 3 + r() * 20; // the galaxy's band: keep to the edges
    out.push({ x: left ? x : 100 - x, y, kind: Math.floor(r() * SPARKLES.length), tint: Math.floor(r() * SPARKLE_TINTS.length), delay: r() * 3 });
  }
  return out;
})();

/** Big four-point glints right on the galaxy's rim, twinkling out of step. */
const GALAXY_GLINTS = [
  { x: 33, y: GALAXY_Y + 7, tint: 1, delay: 0 },
  { x: 66, y: GALAXY_Y - 6, tint: 2, delay: 1.1 },
  { x: 58, y: GALAXY_Y + 9, tint: 0, delay: 2.2 },
];

export function Cosmos() {
  return (
    <Zone index={5}>
      <Nebula url={NEBULA_MID} y={50} />
      <Nebula url={NEBULA_TOP} y={78} />
      <Nebula url={NEBULA_LOW} y={GALAXY_Y} />
      <Stars count={170} seed={66} />
      <Stars count={24} seed={67} color="#a8e4ff" />
      <Stars count={18} seed={68} color="#ffb0dc" />
      <Stars count={12} seed={69} color="#ffe6a8" />
      <div
        className="absolute inset-x-0 top-0 h-2/3"
        style={{ background: "radial-gradient(ellipse 70% 60% at 50% 0%, rgba(255,216,102,0.45), rgba(255,216,102,0) 70%)" }}
      />
      <Art art={FAR_GALAXY_A.art} palette={FAR_GALAXY_A.palette} x={12} y={84} center />
      <Art art={FAR_GALAXY_B.art} palette={FAR_GALAXY_B.palette} x={86} y={72} center />
      <Art art={FAR_BLUE.art} palette={FAR_BLUE.palette} x={9} y={62} center />
      <Art art={CLUSTER_A.art} palette={CLUSTER_A.palette} x={10} y={50} center />
      <Art art={CLUSTER_B.art} palette={CLUSTER_B.palette} x={90} y={50} center />
      {/* soft light the galaxy sits in: magenta core fading to teal */}
      <div
        className="absolute"
        style={{
          left: "50%",
          bottom: `${GALAXY_Y}%`,
          width: `min(${px(GALAXY_COLS * 1.5)}, 140%)`,
          aspectRatio: "2.6 / 1",
          transform: "translate(-50%, 50%)",
          background:
            "radial-gradient(closest-side, rgba(255,150,220,0.34), rgba(150,110,255,0.2) 45%, rgba(90,220,230,0.08) 75%, rgba(90,220,230,0) 100%)",
        }}
      />
      <Art
        art={GALAXY.art}
        palette={GALAXY.palette}
        x={50}
        y={GALAXY_Y}
        center
        style={{ width: `min(${px(GALAXY_COLS)}, 94%)` }}
      />
      {/* landscape: bottom left (the projector stacks answer boxes down the right); portrait: tucked under the galaxy */}
      <div className="absolute portrait:bottom-[8%] portrait:left-[76%] landscape:bottom-[22%] landscape:left-[15%]" style={{ transform: "translate(-50%, 50%)" }}>
        <div className="sky-float" style={{ ["--float" as string]: "3.2s" }}>
          <Art art={BIG_RINGED.art} palette={BIG_RINGED.palette} x={0} y={0} className="relative" />
        </div>
      </div>
      {GALAXY_GLINTS.map((g, i) => (
        <Art
          key={`glint${i}`}
          art={SPARKLE_8}
          palette={SPARKLE_TINTS[g.tint]!}
          x={g.x}
          y={g.y}
          center
          className="animate-twinkle"
          style={{ animationDelay: `${g.delay}s` }}
        />
      ))}
      {SPARKLE_SPOTS.map((s, i) => (
        <Art
          key={i}
          art={SPARKLES[s.kind]!}
          palette={SPARKLE_TINTS[s.tint]!}
          x={s.x}
          y={s.y}
          center
          className="animate-twinkle"
          style={{ animationDelay: `${s.delay}s` }}
        />
      ))}
    </Zone>
  );
}
