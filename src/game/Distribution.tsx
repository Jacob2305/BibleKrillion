import type { CompletedRound, PromptDistribution } from "../../lib/game/api-types";
import { TierBadge } from "./TierBadge";

/**
 * How everyone answered today's prompts. Counts are just for fun: they never
 * change anyone's points.
 */
export function Distribution({ distribution, rounds }: { distribution: PromptDistribution[]; rounds: CompletedRound[] }) {
  return (
    <div className="space-y-3">
      {distribution.map((d, i) => {
        const mine = rounds[i]?.answer?.canonical ?? null;
        const top = Math.max(1, ...d.answers.map((a) => a.count));
        return (
          <details key={d.promptId} className="group rounded-2xl bg-night-950/75 ring-2 ring-white/10" open={i === 0}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus-visible:outline-2 focus-visible:outline-sun-300">
              <span className="font-medium">
                {i + 1}. {d.prompt}
              </span>
              <span aria-hidden="true" className="text-cloud-50/50 transition group-open:rotate-90">
                ›
              </span>
            </summary>
            <ul className="space-y-2 px-4 pb-4">
              {d.answers.map((a) => {
                const isMine = a.canonical === mine;
                const pct = d.players ? Math.round((a.count / d.players) * 100) : 0;
                return (
                  <li key={a.canonical ?? "__miss"}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                      <span className={`truncate ${isMine ? "font-bold text-sun-300" : ""}`}>
                        {a.canonical ?? "Ran out of time"}
                        {isMine && <span className="ml-1.5 text-xs uppercase">you</span>}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <TierBadge tier={a.tier} />
                        <span className="w-16 text-right tabular-nums text-cloud-50/70">
                          {a.count} · {pct}%
                        </span>
                      </span>
                    </div>
                    <div className="h-2 rounded-none bg-white/10" aria-hidden="true">
                      <div
                        className={`h-full rounded-none ${isMine ? "bg-sun-300" : "bg-sky-300/60"}`}
                        style={{ width: `${(a.count / top) * 100}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
