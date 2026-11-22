import { useEffect } from "react";
import { playSfx } from "../lib/sound";

/** The prompt timer: drains, turns red and ticks in the last 5 seconds. */
export function TimerBar({ remainingMs, totalSeconds, size = "md" }: { remainingMs: number; totalSeconds: number; size?: "md" | "xl" }) {
  const ratio = Math.max(0, Math.min(1, remainingMs / (totalSeconds * 1000)));
  const seconds = Math.ceil(remainingMs / 1000);
  const urgent = seconds <= 5;
  const xl = size === "xl";
  useEffect(() => {
    if (seconds > 0 && seconds <= 5) playSfx({ name: "tick" });
  }, [seconds]);
  return (
    <div className={`flex items-center ${xl ? "gap-6" : "gap-3"}`}>
      <div
        className={`${xl ? "h-6" : "h-3"} flex-1 overflow-hidden rounded-none bg-black/40 ring-2 ring-white/10`}
        role="progressbar"
        aria-label="Time left"
        aria-valuemin={0}
        aria-valuemax={totalSeconds}
        aria-valuenow={seconds}
      >
        <div
          className={`h-full rounded-none transition-[width] duration-100 ease-linear ${urgent ? "animate-pulse bg-rose-400" : "bg-sun-300"}`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <span className={`${xl ? "w-28 text-5xl" : "w-10 text-lg"} text-right font-mono tabular-nums ${urgent ? "text-rose-300" : "text-cloud-50/80"}`}>
        {seconds}s
      </span>
    </div>
  );
}
