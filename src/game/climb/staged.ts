/**
 * The projector's room reveal: the world climbs from the sea and stops at every
 * tier somebody reached, lowest first, holding at each so the room can read
 * who got there, then glides on up to the next one. It never cuts.
 *
 * Phases: "ready" (a beat on the waves) → per stop: "climbing" → "holding"
 * → … → "done" (arrived at the top stop, and it stays there). With no stops
 * it goes straight to "done". A round that has already climbed (e.g. the host
 * showed the leaderboard, then went back) starts at the top, without replaying.
 */
import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import type { LiveRoundReveal } from "../../../lib/game/live-types";
import { CLIMB_START, climbTarget, metersAtCamera, zoneIndex } from "../../../lib/game/climb";
import { ANSWER_TIERS, type AnswerTier, type ResultTier } from "../../../lib/game/scoring";
import { playSfx } from "../../lib/sound";
import { prefersReducedMotion, type ClimbPhase, type RevealClimb, type WorldProps } from "./Climb";

export type StagedPhase = "idle" | "ready" | "climbing" | "holding" | "done";

const PAUSE_MS = 700;

/** Up is slow enough to feel the climb; longer gaps take a little longer. */
export function stagedClimbMs(fromZone: number, toZone: number): number {
  return Math.round(900 + 650 * Math.max(0, toZone - fromZone));
}

export interface StagedClimb {
  phase: StagedPhase;
  /** Index into `stops` of the tier being climbed to / shown; -1 before the first. */
  index: number;
  /** The tier being climbed to / shown, if any. */
  tier: AnswerTier | null;
  world: WorldProps;
  meterRef: Ref<HTMLSpanElement>;
  /** Jump straight to the top. */
  skip: () => void;
  /** Counts real arrivals at a stop (not skips or returning to a played round): effects key on it. */
  landing: number;
}

export function useStagedClimb({
  stops,
  active,
  roundKey,
  holdMs,
}: {
  /** Tiers somebody reached, lowest first. */
  stops: readonly AnswerTier[];
  active: boolean;
  roundKey: string | number;
  /** How long to hold at a (non-final) stop. */
  holdMs: (tier: AnswerTier) => number;
}): StagedClimb {
  const [phase, setPhase] = useState<StagedPhase>("idle");
  const [index, setIndex] = useState(-1);
  const [landing, setLanding] = useState(0);
  const [camera, setCamera] = useState<{ target: number; instant: boolean; durationMs?: number }>({ target: CLIMB_START, instant: true });
  const meterRef = useRef<HTMLSpanElement>(null);
  const timers = useRef<number[]>([]);
  const state = useRef({ phase, index });
  state.current = { phase, index };
  // Read the latest stops/holds when advancing, so a late AI-judge approval can still join the climb
  // without restarting it.
  const stopsRef = useRef(stops);
  stopsRef.current = stops;
  const holdRef = useRef(holdMs);
  holdRef.current = holdMs;
  const roundKeyRef = useRef(roundKey);
  roundKeyRef.current = roundKey;
  const lastZone = useRef(-1);
  /** The round whose climb has played, so coming back to it starts at the top. */
  const played = useRef<string | number | null>(null);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));

  const goTo = useCallback((i: number) => {
    const list = stopsRef.current;
    const from = i === 0 ? -1 : zoneIndex(list[i - 1]!);
    const to = zoneIndex(list[i]!);
    state.current = { phase: "climbing", index: i };
    setIndex(i);
    setPhase("climbing");
    setCamera({ target: to, instant: false, durationMs: stagedClimbMs(from, to) });
  }, []);

  useEffect(() => {
    clearTimers();
    lastZone.current = -1;
    if (!active) {
      setPhase("idle");
      setIndex(-1);
      setCamera({ target: CLIMB_START, instant: false });
      return;
    }
    if (stopsRef.current.length === 0) {
      setPhase("done");
      setIndex(-1);
      setCamera({ target: CLIMB_START, instant: true });
      return;
    }
    if (played.current === roundKey) {
      const last = stopsRef.current.length - 1;
      state.current = { phase: "done", index: last };
      setPhase("done");
      setIndex(last);
      // Glide straight back up (never cut); the stops already played.
      setCamera({ target: zoneIndex(stopsRef.current[last]!), instant: false, durationMs: 1400 });
      return;
    }
    setPhase("ready");
    setIndex(-1);
    setCamera({ target: CLIMB_START, instant: true });
    later(() => goTo(0), PAUSE_MS);
    return clearTimers;
  }, [active, roundKey, goTo]);

  const onArrive = useCallback(() => {
    const { phase: p, index: i } = state.current;
    if (p !== "climbing") return;
    const list = stopsRef.current;
    const tier = list[i]!;
    playSfx({ name: "land", tier });
    setLanding((n) => n + 1);
    if (i + 1 < list.length) {
      state.current = { phase: "holding", index: i };
      setPhase("holding");
      later(() => goTo(i + 1), holdRef.current(tier));
    } else {
      // The top: the room stays here.
      state.current = { phase: "done", index: i };
      setPhase("done");
      played.current = roundKeyRef.current;
    }
  }, [goTo]);

  const onFrame = useCallback((c: number) => {
    if (meterRef.current) meterRef.current.textContent = `${metersAtCamera(c).toLocaleString("en-US")} m`;
    const zone = Math.floor(c + 1e-6);
    if (state.current.phase === "climbing" && zone > lastZone.current) {
      if (zone >= 0) playSfx({ name: "zone", zone });
      lastZone.current = zone;
    }
  }, []);

  const skip = useCallback(() => {
    const list = stopsRef.current;
    if (list.length === 0) return;
    clearTimers();
    const last = list.length - 1;
    played.current = roundKeyRef.current;
    state.current = { phase: "done", index: last };
    setIndex(last);
    setPhase("done");
    setCamera({ target: zoneIndex(list[last]!), instant: true });
  }, []);

  const list = stopsRef.current;
  return {
    phase,
    index,
    tier: index >= 0 ? (list[index] ?? null) : null,
    meterRef,
    skip,
    landing,
    world: { ...camera, markers: phase !== "idle", onFrame, onArrive },
  };
}

// ───────────────────────── phones: follow the room, then go to your spot ─────────────────────────

/**
 * The room's stops from a reveal, worked out exactly like the projector does, so a
 * phone and the big screen stop at the same tiers for about the same time.
 */
export function roomStops(r: LiveRoundReveal | undefined): {
  stops: AnswerTier[];
  reached: Partial<Record<AnswerTier, number>>;
  holdMs: (tier: AnswerTier) => number;
} {
  const given = r ? r.reveal.answers.filter((a) => r.counts[a.canonical]) : [];
  const reached: Partial<Record<AnswerTier, number>> = {};
  for (const a of given) reached[a.tier] = (reached[a.tier] ?? 0) + r!.counts[a.canonical]!;
  return {
    stops: ANSWER_TIERS.filter((t) => reached[t]),
    reached,
    holdMs: (tier) => Math.min(3600, 2000 + 250 * Math.max(0, given.filter((a) => a.tier === tier).length - 3)),
  };
}

export interface FollowClimb extends RevealClimb {
  /** Still following the room's climb (the player's own result isn't shown yet). */
  following: boolean;
  /** The room's climb, for its altimeter and the tier it's passing while following. */
  room: StagedClimb;
}

/**
 * A live-room phone at the reveal: first rises with the room (the same stops and
 * holds as the projector, so everyone watches together), then from the top glides
 * down — or up — to the player's own tier (the sea for a miss) and lands there.
 *
 * With `seenKey`, a reveal that already played on this phone (a refresh, or the
 * host going to the leaderboard and back) goes straight to the player's spot.
 */
export function useFollowClimb({
  stops,
  holdMs,
  tier,
  active,
  roundKey,
  seenKey,
}: {
  stops: readonly AnswerTier[];
  holdMs: (tier: AnswerTier) => number;
  /** This player's result. */
  tier: ResultTier;
  active: boolean;
  roundKey: string | number;
  seenKey?: string;
}): FollowClimb {
  /** "follow" the room → "gliding" to my spot → "landed" (or straight to "landed" if already seen). */
  const [mode, setMode] = useState<"idle" | "follow" | "gliding" | "landed">("idle");
  const [exploring, setExploring] = useState(false);
  const [camera, setCamera] = useState<{ target: number; instant: boolean; durationMs?: number }>({ target: CLIMB_START, instant: true });
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const meterRef = useRef<HTMLSpanElement>(null);
  const timers = useRef<number[]>([]);
  const announce = useRef(false);
  const decision = useRef<{ key: string; seen: boolean } | null>(null);
  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  // Decide once per round whether to follow the room or go straight to my spot.
  useEffect(() => {
    clearTimers();
    if (!active) {
      setMode("idle");
      setCamera({ target: CLIMB_START, instant: false });
      return;
    }
    // Decided once per round (effects can run twice in development).
    const key = `${roundKey}|${seenKey ?? ""}`;
    if (decision.current?.key !== key) {
      let seenBefore = false;
      try {
        seenBefore = !!seenKey && window.sessionStorage.getItem(seenKey) !== null;
      } catch {
        /* storage unavailable */
      }
      decision.current = { key, seen: seenBefore };
    }
    const seen = decision.current.seen;
    announce.current = !seen;
    if (seen) {
      setMode("landed");
      setCamera({ target: climbTarget(tier), instant: true });
      return;
    }
    setMode("follow");
    // Mark it seen now: a refresh mid-climb goes straight to my spot rather than replaying out of step with the room.
    try {
      if (seenKey) window.sessionStorage.setItem(seenKey, "1");
    } catch {
      /* storage unavailable */
    }
    return clearTimers;
    // `tier` is read when the room's climb ends (below); it doesn't restart the follow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, roundKey, seenKey]);

  const room = useStagedClimb({ stops, active: active && mode === "follow", roundKey, holdMs });

  // The room reached its top: glide from there to my own tier.
  const tierRef = useRef(tier);
  tierRef.current = tier;
  useEffect(() => {
    if (mode !== "follow" || room.phase !== "done") return;
    const from = stops.length ? zoneIndex(stops[stops.length - 1]!) : CLIMB_START;
    const to = climbTarget(tierRef.current);
    const reduced = prefersReducedMotion();
    const ms = reduced ? 0 : Math.round(to >= from ? 700 + 450 * (to - from) : 700 + 260 * (from - to));
    setMode("gliding");
    // Hold a beat at the top so the room sees it, then move.
    timers.current.push(
      window.setTimeout(
        () => {
          setCamera({ target: to, instant: reduced, durationMs: ms });
          // The World calls onArrive when it gets there; this is the fallback when there's no move to make.
          timers.current.push(window.setTimeout(() => modeRef.current === "gliding" && setMode("landed"), ms + 250));
        },
        stops.length ? 1600 : 400,
      ),
    );
  }, [mode, room.phase, stops]);

  useEffect(() => {
    if (mode !== "landed" || !announce.current) return;
    announce.current = false;
    playSfx({ name: "land", tier: tierRef.current });
  }, [mode]);

  const onFrame = useCallback((c: number) => {
    if (meterRef.current) meterRef.current.textContent = `${metersAtCamera(c).toLocaleString("en-US")} m`;
  }, []);
  const onArrive = useCallback(() => {
    if (modeRef.current === "gliding") setMode("landed");
  }, []);
  const skip = useCallback(() => {
    clearTimers();
    setMode("landed");
    setCamera({ target: climbTarget(tierRef.current), instant: true });
  }, []);

  const phase: ClimbPhase = mode === "idle" ? "idle" : mode === "landed" ? "landed" : mode === "gliding" ? "climbing" : "ready";
  return {
    phase,
    exploring,
    tier,
    size: "phone",
    meterRef,
    skip,
    following: mode === "follow",
    room,
    world:
      mode === "follow"
        ? room.world
        : {
            ...camera,
            // The tier lines would sit on top of the result panels once landed.
            markers: mode === "gliding",
            onFrame,
            onArrive,
            onExplore: setExploring,
          },
  };
}
