/**
 * The projector's room reveal: the world climbs from the sea and stops at every
 * tier somebody reached, lowest first, holding at each so the room can read
 * who got there, then glides on up to the next one. It never cuts.
 *
 * Phases: "ready" (a beat on the waves) → per stop: "climbing" → "holding"
 * → … → "done" (after the top stop has had its moment; the screen then shows
 * the full answer board). With no stops it goes straight to "done".
 */
import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import { CLIMB_START, metersAtCamera, zoneIndex } from "../../../lib/game/climb";
import type { AnswerTier } from "../../../lib/game/scoring";
import { playSfx } from "../../lib/sound";
import type { WorldProps } from "./Climb";

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
  /** Jump straight to the top and the full board. */
  skip: () => void;
}

export function useStagedClimb({
  stops,
  active,
  roundKey,
  holdMs,
  finalMs = 3500,
}: {
  /** Tiers somebody reached, lowest first. */
  stops: readonly AnswerTier[];
  active: boolean;
  roundKey: string | number;
  /** How long to hold at a (non-final) stop. */
  holdMs: (tier: AnswerTier) => number;
  /** How long the top stop stays before the full board. */
  finalMs?: number;
}): StagedClimb {
  const [phase, setPhase] = useState<StagedPhase>("idle");
  const [index, setIndex] = useState(-1);
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
  const lastZone = useRef(-1);

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
    state.current = { phase: "holding", index: i };
    setPhase("holding");
    playSfx({ name: "land", tier });
    if (i + 1 < list.length) later(() => goTo(i + 1), holdRef.current(tier));
    else later(() => setPhase("done"), finalMs);
  }, [goTo, finalMs]);

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
    world: { ...camera, markers: phase !== "idle", onFrame, onArrive },
  };
}
