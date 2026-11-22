import type { ReactNode } from "react";
import { METERS_PER_POINT, TIER_INFO, diveRating, maxDivePoints } from "../../lib/game/scoring";
import { formatMeters, useAnimatedNumber } from "./Altitude";
import { TierBadge } from "./TierBadge";
import type { RoundResult } from "./useDive";

export function DiveResults({ results, children }: { results: RoundResult[]; children?: ReactNode }) {
  const total = results.reduce((s, r) => s + r.points, 0);
  const shown = useAnimatedNumber(total, 1600);
  const rating = diveRating(total);
  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-night-950/80 p-6 text-center ring-2 ring-white/10">
        <p className="text-sm tracking-widest text-cloud-50/60 uppercase">You reached</p>
        <p className="font-mono text-6xl text-sun-300 tabular-nums">{formatMeters(shown * METERS_PER_POINT)}</p>
        <p className="mt-1 text-cloud-50/70 tabular-nums">
          {total} / {maxDivePoints(results.length)} points
        </p>
        <div className="mt-4 flex flex-col items-center gap-1">
          <span className="text-sm text-cloud-50/60">Ascent rating</span>
          <TierBadge tier={rating} size="lg" />
        </div>
      </section>

      <ol className="space-y-2">
        {results.map((r, i) => (
          <li key={r.prompt.id} className="flex items-center gap-3 rounded-2xl bg-night-950/75 px-3 py-2.5 ring-2 ring-white/5">
            <span className="text-xl" aria-hidden="true">
              {TIER_INFO[r.tier].emoji}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-cloud-50/60">
                {i + 1}. {r.prompt.prompt}
              </p>
              <p className="truncate font-medium">{r.answer ? r.answer.canonical : "No answer"}</p>
            </div>
            <span className="font-mono text-sm tabular-nums text-cloud-50/80">+{r.points}</span>
          </li>
        ))}
      </ol>

      {children}
    </div>
  );
}
