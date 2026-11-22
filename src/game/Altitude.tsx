import { useEffect, useRef, useState } from "react";
import { METERS_PER_POINT, maxDivePoints } from "../../lib/game/scoring";
import { Dove } from "./pixel";

const MAX_ALTITUDE = maxDivePoints() * METERS_PER_POINT; // 7,000 m
const TICKS = [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000];
const SEGMENTS = 28;

/** Counts a number up smoothly (skipped when the user prefers reduced motion). */
export function useAnimatedNumber(target: number, durationMs = 1200): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const from = fromRef.current;
    if (reduce || from === target) {
      fromRef.current = target;
      setValue(target);
      return;
    }
    const startAt = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - startAt) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (t < 1) frame = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      fromRef.current = target;
    };
  }, [target, durationMs]);
  return value;
}

export function formatMeters(meters: number): string {
  return `${meters.toLocaleString("en-US")} m`;
}

/** 0–1: how far up the 7,000 m climb these points are. */
export const climbProgress = (points: number) => Math.min(1, (points * METERS_PER_POINT) / MAX_ALTITUDE);

/** Vertical altitude meter: segments light up and a dove climbs as points come in. */
export function AltitudeGauge({ points }: { points: number }) {
  const ratio = climbProgress(points);
  const lit = Math.round(ratio * SEGMENTS);
  return (
    <div className="relative h-full w-12 shrink-0 select-none" aria-hidden="true">
      <div className="absolute inset-y-3 left-1/2 flex w-2 -translate-x-1/2 flex-col-reverse gap-[2px]">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span key={i} className={`flex-1 ${i < lit ? "bg-sun-300" : "bg-cloud-50/15"}`} />
        ))}
      </div>
      {TICKS.map((m) => (
        <div
          key={m}
          className="absolute right-0 left-0 flex items-center justify-end font-mono text-[11px] leading-none text-cloud-50/50"
          style={{ bottom: `calc(0.75rem + (100% - 1.5rem) * ${m / MAX_ALTITUDE})` }}
        >
          <span className="translate-y-1/2">{m === 0 ? "0" : `${m / 1000}k`}</span>
        </div>
      ))}
      <div
        className="absolute left-1/2 w-9 transition-[bottom] duration-[1400ms] ease-out motion-reduce:transition-none"
        style={{ bottom: `calc(0.75rem + (100% - 1.5rem) * ${ratio})`, transform: "translate(-50%, 50%)" }}
      >
        <Dove className="w-full drop-shadow-[2px_2px_0_rgba(0,0,0,0.4)]" />
      </div>
    </div>
  );
}
