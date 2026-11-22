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

const LOWEST = CLIMB_START - 0.4;
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
  const camera = useRef(target);
  const callbacks = useRef({ onFrame, onArrive });
  callbacks.current = { onFrame, onArrive };
  const [reached, setReached] = useState(() => Math.floor(target + 1e-6));

  // Exploring adds an offset to the screen's own camera target. Any change of target (or turning
  // exploring off) drops the offset, and the screen's own move wins.
  const offset = useRef(0);
  const how = useRef<"base" | "drag" | "wheel" | "glide">("base");
  const base = useRef({ target, instant, durationMs, explore });
  const [tick, setTick] = useState(0);
  if (base.current.target !== target || base.current.instant !== instant || base.current.durationMs !== durationMs) {
    base.current = { target, instant, durationMs, explore };
    offset.current = 0;
    how.current = "base";
  } else if (base.current.explore !== explore) {
    base.current = { ...base.current, explore };
    if (!explore && offset.current !== 0) {
      offset.current = 0;
      how.current = "glide";
    }
  }
  const effective = clampCamera(target + offset.current);

  useLayoutEffect(() => {
    const mode = how.current;
    const own = mode === "base"; // the screen's move (not the player looking around)
    const place = (c: number) => {
      camera.current = c;
      if (worldRef.current) worldRef.current.style.transform = `translate3d(0, ${c * 100}%, 0)`;
      if (own) callbacks.current.onFrame?.(c);
      const r = Math.floor(c + 1e-6);
      setReached((prev) => (prev === r ? prev : r));
    };
    const arrive = () => {
      if (own) callbacks.current.onArrive?.();
    };
    const from = camera.current;
    if ((own && instant) || mode === "drag" || prefersReducedMotion() || Math.abs(from - effective) < 1e-4) {
      place(effective);
      arrive();
      return;
    }
    const ms = mode === "wheel" ? 140 : own ? (durationMs ?? glideMs(from, effective)) : glideMs(from, effective);
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      place(from + (effective - from) * (mode === "wheel" ? t : easeClimb(t)));
      if (t < 1) frame = requestAnimationFrame(step);
      else arrive();
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [effective, instant, durationMs, tick]);

  // Scroll, drag or swipe the background to look around.
  useEffect(() => {
    if (!explore) return;
    const nudge = (dz: number, mode: "drag" | "wheel") => {
      const next = clampCamera(target + offset.current + dz) - target;
      if (Math.abs(next - offset.current) < 1e-5) return;
      offset.current = next;
      how.current = mode;
      setTick((n) => n + 1);
    };
    const onMap = (el: EventTarget | null) => !(el instanceof Element && el.closest(INTERACTIVE));
    const pageScrolls = () => document.documentElement.scrollHeight > window.innerHeight + 4;

    const onWheel = (e: WheelEvent) => {
      if (!onMap(e.target) || pageScrolls()) return;
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY;
      nudge(-dy / window.innerHeight, "wheel"); // scroll down = look down (towards the sea)
    };
    let touchY: number | null = null;
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches.length === 1 && onMap(e.target) ? e.touches[0]!.clientY : null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (touchY === null || e.touches.length !== 1) return;
      const y = e.touches[0]!.clientY;
      e.preventDefault(); // the map moves, not the page
      nudge((y - touchY) / window.innerHeight, "drag"); // the world follows your finger
      touchY = y;
    };
    const onTouchEnd = () => {
      touchY = null;
    };
    let mouseY: number | null = null;
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0 || !onMap(e.target)) return;
      mouseY = e.clientY;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (mouseY === null || e.clientY === mouseY) return;
      nudge((e.clientY - mouseY) / window.innerHeight, "drag");
      mouseY = e.clientY;
      window.getSelection()?.removeAllRanges();
    };
    const onPointerUp = () => {
      mouseY = null;
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [explore, target]);

  const exploring = explore && Math.abs(offset.current) > 0.02;
  const onExploreRef = useRef(onExplore);
  onExploreRef.current = onExplore;
  useEffect(() => onExploreRef.current?.(exploring), [exploring]);
  const backHome = () => {
    offset.current = 0;
    how.current = "glide";
    setTick((n) => n + 1);
  };

  return (
    <>
      <div aria-hidden="true" className="climb pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#04213a]">
        <div ref={worldRef} className="absolute inset-0 will-change-transform" style={{ transform: `translate3d(0, ${camera.current * 100}%, 0)` }}>
          <ClimbWorld />
          {(markers || exploring) &&
            CLIMB_ZONES.map((z, i) => (
              <Marker key={z.tier} index={i} tier={z.tier} place={z.place} note={notes?.[z.tier]} passed={markers && reached >= i} />
            ))}
        </div>
      </div>
      {exploring && (
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
}) {
  const { phase, tier, size, meterRef, skip, exploring } = climb;
  if (phase === "idle" || hideLanding) return null;
  const stage = size === "stage";
  const miss = tier === "miss";
  const landed = phase === "landed";
  const impact = IMPACT[tier];
  const info = TIER_INFO[tier];
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
        </div>

        {/* the climber, always in the middle of the screen */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ width: px(18 * (stage ? 1.6 : 2)) }}
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
            <div className={`pointer-events-none absolute inset-x-0 px-4 text-center ${stage ? "top-[62%]" : "top-[57%]"}`} role="status">
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
            </div>
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
