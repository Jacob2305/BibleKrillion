/**
 * The climb world is the background of every screen. It rests at sea level
 * (Plankton) and the camera glides between zones instead of cutting:
 *
 * - `<World>` draws the tower of zones and animates its camera to `target`.
 * - `useRevealClimb()` runs one reveal: a pause on the waves, the climb to the
 *   tier's zone, the landing (flash, sparks, stamp). It stays there until the
 *   reveal ends, then the camera glides back down to the sea.
 * - `<RevealHud>` is what sits on top during a reveal: the answer, the
 *   altimeter, the dove, the landing effects and the screen's buttons.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { CLIMB_START, CLIMB_ZONES, climbDurationMs, climbTarget, easeClimb, metersAtCamera } from "../../../lib/game/climb";
import { TIER_INFO, type AnswerTier, type ResultTier } from "../../../lib/game/scoring";
import { Sprite } from "../pixel";
import { TIER_STYLE } from "../tierStyle";
import { DOVE_COLORS, DOVE_DOWN, DOVE_UP } from "./art";
import { ClimbWorld, px } from "./Scenes";
import { playSfx } from "../../lib/sound";

export type ClimbPhase = "idle" | "ready" | "climbing" | "landed";

const PAUSE_MS = 500;

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

const formatMeters = (c: number) => `${metersAtCamera(c).toLocaleString("en-US")} m`;

/** Going up is slow and dramatic; going back down to the sea is quick. */
function glideMs(from: number, to: number): number {
  const d = Math.abs(to - from);
  return to > from ? 650 + 520 * d : 450 + 170 * d;
}

// ───────────────────────── the world ─────────────────────────

export interface WorldProps {
  /** Camera position in zones (see lib/game/climb.ts). */
  target: number;
  /** Jump there without animating. */
  instant?: boolean;
  durationMs?: number;
  /** Show each tier's line and label (during a reveal). */
  markers?: boolean;
  /** Extra text on each tier's marker, e.g. "3 climbers". */
  notes?: Partial<Record<AnswerTier, string>>;
  /** Let the player scroll / drag the map to look around (before and after a question). */
  explore?: boolean;
  /** Where the "Back to my spot" button sits while exploring. */
  backClass?: string;
  onFrame?: (camera: number) => void;
  onArrive?: () => void;
  /** Told when the player starts / stops looking around. */
  onExplore?: (exploring: boolean) => void;
}

/** How far below the start you can look: just the sea bed and a little ground. */
const LOWEST = CLIMB_START - 0.12;
const HIGHEST = CLIMB_ZONES.length - 1;
const clampCamera = (c: number) => Math.min(HIGHEST, Math.max(LOWEST, c));

/** Taps and drags on these go to the page, not the map. */
const INTERACTIVE = "button, a, input, textarea, select, label, summary, [role=dialog], [data-no-explore]";

export function World({
  target,
  instant = false,
  durationMs,
  markers = false,
  notes,
  explore = false,
  backClass = "bottom-6",
  onFrame,
  onArrive,
  onExplore,
}: WorldProps) {
  const worldRef = useRef<HTMLDivElement>(null);
  /** Where the camera is drawn right now. */
  const camera = useRef(target);
  const callbacks = useRef({ onFrame, onArrive });
  callbacks.current = { onFrame, onArrive };
  const [reached, setReached] = useState(() => Math.floor(target + 1e-6));

  // Looking around adds an offset to the screen's own camera target. It lives in a
  // ref and the camera is moved straight on the DOM, so scrolling and dragging never
  // re-render the world (that, plus restarting an animation on every wheel event,
  // is what made it jumpy before).
  const offset = useRef(0);
  const targetRef = useRef(target);
  targetRef.current = target;
  const frame = useRef(0);
  const [exploring, setExploring] = useState(false);
  /** The transform is only set by `place` after the first render, so a re-render never moves the camera back a frame. */
  const [initialStyle] = useState<CSSProperties>(() => ({ transform: `translate3d(0, ${target * 100}%, 0)` }));

  const place = useCallback((c: number, own: boolean) => {
    camera.current = c;
    if (worldRef.current) worldRef.current.style.transform = `translate3d(0, ${c * 100}%, 0)`;
    if (own) callbacks.current.onFrame?.(c);
    const r = Math.floor(c + 1e-6);
    setReached((prev) => (prev === r ? prev : r));
  }, []);

  const stop = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
  };

  /** An eased move of fixed length (the screen's own moves, and gliding back home). */
  const glide = useCallback(
    (to: number, ms: number, own: boolean) => {
      stop();
      const from = camera.current;
      if (ms <= 0 || prefersReducedMotion() || Math.abs(from - to) < 1e-4) {
        place(to, own);
        if (own) callbacks.current.onArrive?.();
        return;
      }
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / ms);
        place(from + (to - from) * easeClimb(t), own);
        if (t < 1) frame.current = requestAnimationFrame(step);
        else {
          frame.current = 0;
          if (own) callbacks.current.onArrive?.();
        }
      };
      frame.current = requestAnimationFrame(step);
    },
    [place],
  );

  /** Follow the explore target smoothly (exponential easing), for the wheel and for flicks. */
  const follow = useCallback(() => {
    if (frame.current) return;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      const goal = clampCamera(targetRef.current + offset.current);
      const k = 1 - Math.exp(-dt / 90);
      const next = camera.current + (goal - camera.current) * k;
      if (Math.abs(goal - next) < 0.0005) {
        place(goal, false);
        frame.current = 0;
        return;
      }
      place(next, false);
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }, [place]);

  const setOffset = useCallback(
    (o: number) => {
      offset.current = o;
      const on = Math.abs(o) > 0.02;
      setExploring((prev) => (prev === on ? prev : on));
    },
    [],
  );

  // The screen's own camera move: drop any looking around and go there.
  useLayoutEffect(() => {
    setOffset(0);
    const from = camera.current;
    glide(target, instant ? 0 : (durationMs ?? glideMs(from, target)), true);
    return stop;
  }, [target, instant, durationMs, glide, setOffset]);

  // Exploring switched off while looking around: glide back to the screen's spot.
  useEffect(() => {
    if (explore || offset.current === 0) return;
    setOffset(0);
    glide(targetRef.current, glideMs(camera.current, targetRef.current), false);
  }, [explore, glide, setOffset]);

  // Scroll, drag or swipe the background to look around.
  useEffect(() => {
    if (!explore) return;
    const base = () => targetRef.current;
    /** Move the explore goal by `dz` zones (clamped to the map). */
    const nudge = (dz: number) => {
      const goal = clampCamera(base() + offset.current + dz);
      setOffset(goal - base());
    };
    /** Drags follow the finger 1:1: move the camera itself, no easing. */
    const drag = (dz: number) => {
      stop();
      const c = clampCamera(camera.current + dz);
      setOffset(c - base());
      place(c, false);
    };
    const onMap = (el: EventTarget | null) => !(el instanceof Element && el.closest(INTERACTIVE));
    const pageScrolls = () => document.documentElement.scrollHeight > window.innerHeight + 4;

    const onWheel = (e: WheelEvent) => {
      if (!onMap(e.target) || pageScrolls()) return;
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY;
      nudge(-dy / window.innerHeight); // scroll down = look down (towards the sea)
      follow();
    };

    // Drags (touch and mouse) with a little momentum when let go.
    let dragY: number | null = null;
    let velocity = 0; // zones per ms
    let lastT = 0;
    const dragStart = (y: number) => {
      dragY = y;
      velocity = 0;
      lastT = performance.now();
    };
    const dragMove = (y: number) => {
      if (dragY === null || y === dragY) return;
      const dz = (y - dragY) / window.innerHeight; // the world follows your finger
      const now = performance.now();
      const dt = Math.max(1, now - lastT);
      velocity = 0.7 * velocity + 0.3 * (dz / dt);
      lastT = now;
      dragY = y;
      drag(dz);
    };
    const dragEnd = () => {
      if (dragY === null) return;
      dragY = null;
      if (performance.now() - lastT < 80 && Math.abs(velocity) > 0.0004) {
        nudge(velocity * 220); // coast a little in the direction of the flick
        follow();
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1 && onMap(e.target)) dragStart(e.touches[0]!.clientY);
      else dragY = null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (dragY === null || e.touches.length !== 1) return;
      e.preventDefault(); // the map moves, not the page
      dragMove(e.touches[0]!.clientY);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0 || !onMap(e.target)) return;
      dragStart(e.clientY);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || dragY === null) return;
      dragMove(e.clientY);
      window.getSelection()?.removeAllRanges();
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", dragEnd);
    window.addEventListener("touchcancel", dragEnd);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", dragEnd);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", dragEnd);
      window.removeEventListener("touchcancel", dragEnd);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", dragEnd);
    };
  }, [explore, follow, place, setOffset]);

  const onExploreRef = useRef(onExplore);
  onExploreRef.current = onExplore;
  const showExploring = explore && exploring;
  useEffect(() => onExploreRef.current?.(showExploring), [showExploring]);
  const backHome = () => {
    setOffset(0);
    glide(targetRef.current, glideMs(camera.current, targetRef.current), false);
  };

  return (
    <>
      <div aria-hidden="true" className="climb pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#04213a]">
        <div ref={worldRef} className="absolute inset-0 will-change-transform" style={initialStyle}>
          <ClimbWorld />
          {(markers || showExploring) &&
            CLIMB_ZONES.map((z, i) => (
              <Marker key={z.tier} index={i} tier={z.tier} place={z.place} note={notes?.[z.tier]} passed={markers && reached >= i} />
            ))}
        </div>
      </div>
      {showExploring && (
        <button
          type="button"
          onClick={backHome}
          className={`pixel-button fixed left-1/2 z-[35] -translate-x-1/2 bg-cloud-50 px-4 py-2 font-bold whitespace-nowrap text-night-950 focus-visible:outline-4 focus-visible:outline-sun-300 ${backClass}`}
        >
          ⤓ Back to my spot
        </button>
      )}
    </>
  );
}

/** The line across each zone at the height the dove lands on. */
function Marker({ index, tier, place, note, passed }: { index: number; tier: AnswerTier; place: string; note?: string; passed: boolean }) {
  return (
    <div className="absolute inset-x-0 top-0 h-full" style={{ transform: `translateY(${-index * 100}%)` }}>
      <div className="absolute inset-x-0" style={{ bottom: "50%" }}>
        <div
          className="absolute inset-x-0 bottom-0"
          style={{
            height: px(1),
            backgroundImage: `repeating-linear-gradient(to right, ${passed ? "#ffd866" : "rgba(255,248,236,0.45)"} 0 ${px(4)}, transparent ${px(4)} ${px(8)})`,
          }}
        />
        <div
          className={`climb-label absolute bottom-2 left-3 max-w-[42%] leading-tight [text-shadow:2px_2px_0_rgb(0_0_0/0.65)] sm:left-6 ${passed ? "text-sun-300" : "text-cloud-50/80"}`}
        >
          <p className="climb-label-big font-bold">
            <span aria-hidden="true">{TIER_INFO[tier].emoji}</span> {TIER_INFO[tier].label}
          </p>
          <p>
            {place} · {TIER_INFO[tier].points} pts
          </p>
          {note && <p className="text-cloud-50">{note}</p>}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── one reveal ─────────────────────────

export interface RevealClimb {
  phase: ClimbPhase;
  /** The player is scrolling the map away from where they landed. */
  exploring: boolean;
  tier: ResultTier;
  size: "phone" | "stage";
  world: WorldProps;
  meterRef: Ref<HTMLSpanElement>;
  skip: () => void;
}

/**
 * Drives the world through one reveal while `active`. `roundKey` restarts it
 * for a new round. With `seenKey`, a reveal that already played (e.g. before a
 * page reload) lands straight away instead of playing again.
 */
export function useRevealClimb({
  tier,
  active,
  roundKey,
  size = "phone",
  seenKey,
}: {
  tier: ResultTier;
  active: boolean;
  roundKey: string | number;
  size?: "phone" | "stage";
  seenKey?: string;
}): RevealClimb {
  const [phase, setPhase] = useState<ClimbPhase>("idle");
  const [exploring, setExploring] = useState(false);
  const [camera, setCamera] = useState<{
    target: number;
    instant: boolean;
    durationMs?: number;
  }>({ target: CLIMB_START, instant: true });
  const meterRef = useRef<HTMLSpanElement>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const timers = useRef<number[]>([]);
  const scale = size === "stage" ? 1.35 : 1;
  /** Sound for the landing (not when re-showing a reveal that already played). */
  const announce = useRef(false);
  const lastZone = useRef(-1);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  useEffect(() => {
    clearTimers();
    if (!active) {
      setPhase("idle");
      setCamera({ target: CLIMB_START, instant: false });
      return;
    }
    const target = climbTarget(tier);
    let seen = false;
    try {
      seen = !!seenKey && window.sessionStorage.getItem(seenKey) !== null;
    } catch {
      /* storage unavailable */
    }
    announce.current = !seen;
    lastZone.current = -1;
    if (seen || prefersReducedMotion()) {
      setPhase("landed");
      setCamera({ target, instant: true });
      return;
    }
    setPhase("ready");
    setCamera({ target: CLIMB_START, instant: true });
    timers.current.push(
      window.setTimeout(() => {
        setPhase("climbing");
        if (tier === "miss")
          timers.current.push(window.setTimeout(() => setPhase("landed"), 650)); // the dove dives into the sea
        else
          setCamera({
            target,
            instant: false,
            durationMs: climbDurationMs(tier, scale),
          });
      }, PAUSE_MS),
    );
    return clearTimers;
  }, [active, tier, roundKey, scale, seenKey]);

  useEffect(() => {
    if (phase !== "landed" || !announce.current) return;
    announce.current = false;
    playSfx({ name: "land", tier });
  }, [phase, tier]);

  // Remember a reveal that has played, so a reload doesn't play it again.
  useEffect(() => {
    if (phase !== "landed" || !seenKey) return;
    try {
      window.sessionStorage.setItem(seenKey, "1");
    } catch {
      /* storage unavailable */
    }
  }, [phase, seenKey]);

  const skip = useCallback(() => {
    if (phaseRef.current !== "ready" && phaseRef.current !== "climbing") return;
    clearTimers();
    setPhase("landed");
    setCamera({ target: climbTarget(tier), instant: true });
  }, [tier]);

  // Any key skips the climb; keys are swallowed so they don't also press a button.
  useEffect(() => {
    if (phase !== "ready" && phase !== "climbing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.key === "Tab") return;
      e.preventDefault();
      e.stopPropagation();
      skip();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [phase, skip]);

  const onFrame = useCallback((c: number) => {
    if (meterRef.current) meterRef.current.textContent = formatMeters(c);
    const zone = Math.floor(c + 1e-6);
    if (phaseRef.current === "climbing" && zone > lastZone.current) {
      if (zone >= 0) playSfx({ name: "zone", zone });
      lastZone.current = zone;
    }
  }, []);
  const onArrive = useCallback(() => {
    if (phaseRef.current === "climbing" && tier !== "miss") setPhase("landed");
  }, [tier]);

  return {
    phase,
    exploring,
    tier,
    size,
    meterRef,
    skip,
    world: {
      ...camera,
      markers: phase !== "idle",
      onFrame,
      onArrive,
      onExplore: setExploring,
    },
  };
}

// ───────────────────────── what sits on top ─────────────────────────

/** Flash strength and particle count: the rarer the tier, the bigger the bang. */
const IMPACT: Record<ResultTier, { flash: number; sparks: number; color: string }> = {
  plankton: { flash: 0.35, sparks: 8, color: "#7fffd4" },
  too_clever: { flash: 0.45, sparks: 10, color: "#fcd34d" },
  schooler: { flash: 0.55, sparks: 12, color: "#7dd3fc" },
  rare: { flash: 0.7, sparks: 16, color: "#c4b5fd" },
  deep_cut: { flash: 0.85, sparks: 20, color: "#f0abfc" },
  one_in_a_million: { flash: 1, sparks: 28, color: "#ffd866" },
  miss: { flash: 0, sparks: 12, color: "#bfe9ff" },
};

export function RevealHud({
  climb,
  kicker,
  headline,
  caption,
  details,
  actions,
  topClass = "pt-16",
  hideLanding = false,
  hideClimber = false,
}: {
  climb: RevealClimb;
  /** Small line above the headline, e.g. "Your answer". */
  kicker?: string;
  /** The player's answer, or the prompt on the projector. */
  headline: string;
  /** Under the points once landed. */
  caption?: ReactNode;
  /** Small notes under the caption (gem note, AI judge…). */
  details?: ReactNode;
  /** Buttons, pinned to the bottom once landed. */
  actions?: ReactNode;
  /** Room for the screen's own header. */
  topClass?: string;
  /** Hide everything but the world (the projector does this to show the answers). */
  hideLanding?: boolean;
  /**
   * No dove in the middle (live-room phones): the tier badge and points then sit
   * straight under the answer panel, so long notes never run into anything.
   */
  hideClimber?: boolean;
}) {
  const { phase, tier, size, meterRef, skip, exploring } = climb;
  if (phase === "idle" || hideLanding) return null;
  const stage = size === "stage";
  const miss = tier === "miss";
  const landed = phase === "landed";
  const impact = IMPACT[tier];
  const info = TIER_INFO[tier];
  // Tier badge, points and notes once landed.
  const result = (
    <>
      <div className="climb-stamp inline-block">
        <span
          className={`inline-flex items-center gap-3 font-bold whitespace-nowrap shadow-[6px_6px_0_rgba(0,0,0,0.45)] [text-shadow:none] ${TIER_STYLE[tier].badge} ${stage ? "px-10 py-3 text-6xl" : "px-6 py-2 text-4xl"}`}
        >
          <span aria-hidden="true">{info.emoji}</span>
          {info.label}
        </span>
      </div>
      <div className={`climb-rise pixel-panel mx-auto mt-4 w-fit max-w-md ${stage ? "px-10 py-4" : "px-5 py-2"}`}>
        <p className={`font-mono text-cloud-50 tabular-nums ${stage ? "text-5xl" : "text-3xl"}`}>+{info.points} pts</p>
        {caption && <p className={`text-cloud-50/90 ${stage ? "text-4xl" : "text-xl"}`}>{caption}</p>}
        {details && <div className="mt-1 space-y-1 text-base">{details}</div>}
      </div>
    </>
  );
  return (
    <div
      className={`climb fixed inset-0 z-30 select-none ${landed && tier === "one_in_a_million" ? "climb-quake" : ""} ${landed ? "pointer-events-none" : ""}`}
    >
      {/* while climbing, a tap anywhere skips */}
      {!landed && <button type="button" className="absolute inset-0 cursor-pointer" onClick={skip} aria-label="Skip the climb" />}

      <div className="pointer-events-none absolute inset-0 transition-opacity duration-300" style={{ opacity: exploring ? 0 : 1 }}>
        <div className={`pointer-events-none absolute inset-x-0 top-0 px-4 text-center [text-shadow:3px_3px_0_rgb(0_0_0/0.55)] ${topClass}`}>
          <div className={`pixel-panel inline-block max-w-full ${stage ? "px-10 py-5" : "px-5 py-3"}`}>
            {kicker && <p className={`font-semibold tracking-widest text-sun-300 uppercase ${stage ? "text-3xl" : "text-sm"}`}>{kicker}</p>}
            <h1 className={`mx-auto max-w-[22ch] font-display leading-tight font-bold text-balance text-cloud-50 ${stage ? "text-6xl" : "text-4xl"}`}>
              {headline}
            </h1>
            <p className={`mt-1 font-mono text-sun-300 tabular-nums ${stage ? "text-5xl" : "text-3xl"}`} aria-hidden="true">
              ▲ <span ref={meterRef}>{formatMeters(landed ? climbTarget(tier) : CLIMB_START)}</span>
            </p>
          </div>
          {hideClimber && landed && (
            <div className="mt-4" role="status">
              {result}
            </div>
          )}
        </div>

        {/* the climber, always in the middle of the screen */}
        {!hideClimber && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ width: px(DOVE_UP[0].length * (stage ? 0.8 : 1)) }}
        >
          <div
            className={phase === "ready" || (landed && !miss) ? "animate-bob" : ""}
            style={
              miss
                ? {
                    transform: phase === "ready" ? "none" : "translateY(140%)",
                    opacity: phase === "ready" ? 1 : 0,
                    transition: "transform 520ms cubic-bezier(.5,0,.9,.4), opacity 300ms 260ms",
                  }
                : undefined
            }
          >
            <div className="relative drop-shadow-[3px_3px_0_rgba(0,0,0,0.45)]">
              <Sprite art={DOVE_UP} palette={DOVE_COLORS} className={`block w-full ${phase === "climbing" && !miss ? "climb-flap-a" : ""}`} />
              <Sprite
                art={DOVE_DOWN}
                palette={DOVE_COLORS}
                className={`absolute inset-0 block w-full opacity-0 ${phase === "climbing" && !miss ? "climb-flap-b" : ""}`}
              />
            </div>
          </div>
        </div>
        )}

        {landed && (
          <>
            <div aria-hidden="true" className="pointer-events-none">
              {impact.flash > 0 && (
                <div
                  className="climb-flash absolute inset-0"
                  style={
                    {
                      "--flash": impact.flash,
                      background: tier === "one_in_a_million" ? "#fff1b8" : "#ffffff",
                    } as CSSProperties
                  }
                />
              )}
              {tier === "one_in_a_million" && <div className="climb-rays absolute top-1/2 left-1/2" />}
              <Sparks count={impact.sparks} color={impact.color} up={miss} />
              <div className="climb-ring absolute top-1/2 left-1/2" style={{ borderColor: impact.color }} />
            </div>
            {!hideClimber && (
              <div className={`pointer-events-none absolute inset-x-0 px-4 text-center ${stage ? "top-[62%]" : "top-[57%]"}`} role="status">
                {result}
              </div>
            )}
          </>
        )}
      </div>

      {landed && (
        <>
          {actions && (
            <div className="climb-rise pointer-events-auto absolute inset-x-0 bottom-0 px-4 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <div className="mx-auto max-w-md space-y-3">{actions}</div>
            </div>
          )}
        </>
      )}

      {!landed && (
        <p className="pointer-events-none absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] text-center text-sm text-cloud-50/60 [text-shadow:2px_2px_0_rgb(0_0_0/0.6)]">
          Tap to skip
        </p>
      )}
    </div>
  );
}

function Sparks({ count, color, up }: { count: number; color: string; up: boolean }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const angle = up ? Math.PI * (1.15 + (0.7 * i) / Math.max(1, count - 1)) : (i / count) * Math.PI * 2;
        const dist = (up ? 16 : 22) + (i % 3) * 7;
        return (
          <span
            key={i}
            className="climb-spark absolute top-1/2 left-1/2"
            style={
              {
                width: px(i % 4 === 0 ? 3 : 2),
                height: px(i % 4 === 0 ? 3 : 2),
                background: i % 5 === 0 ? "#fff8ec" : color,
                "--dx": `${Math.cos(angle) * dist}vmin`,
                "--dy": `${Math.sin(angle) * dist}vmin`,
              } as CSSProperties
            }
          />
        );
      })}
    </>
  );
}

/** A full-screen panel over the world, e.g. "every possible answer". Escape or Back closes it. */
export function AnswersSheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      // Keep keyboard focus inside the panel (its only control is Back).
      if (e.key === "Tab") {
        e.preventDefault();
        closeRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-40 overflow-y-auto bg-night-950">
      <div className="mx-auto max-w-xl px-4 pt-5 pb-28">
        <h2 className="mb-4 text-2xl font-bold">{title}</h2>
        {children}
      </div>
      <div className="fixed inset-x-0 bottom-0 bg-gradient-to-t from-night-950 to-transparent px-4 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-md">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="pixel-button w-full bg-cloud-50 px-6 py-4 text-xl font-bold text-night-950 focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-sun-300"
          >
            ← Back
          </button>
        </div>
      </div>
    </div>
  );
}
