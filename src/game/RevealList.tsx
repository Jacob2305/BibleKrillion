import type { PromptReveal } from "../../lib/game/api-types";
import { ANSWER_TIERS, TIER_INFO } from "../../lib/game/scoring";
import { TierBadge } from "./TierBadge";
import { TIER_STYLE } from "./tierStyle";

const DEEPEST_FIRST = [...ANSWER_TIERS].reverse();

/**
 * Every valid answer for a prompt, grouped deepest tier first. The player's own
 * answer is highlighted; gems show their note. `counts` (how many players gave
 * each answer) arrives with Daily/Live modes and never affects points.
 */
export function RevealList({
  reveal,
  mine,
  counts,
}: {
  reveal: PromptReveal;
  mine?: string | null;
  counts?: Record<string, number>;
}) {
  return (
    <div className="space-y-4">
      {DEEPEST_FIRST.map((tier) => {
        const answers = reveal.answers.filter((a) => a.tier === tier);
        if (answers.length === 0) return null;
        return (
          <section key={tier} aria-label={TIER_INFO[tier].label}>
            <h3 className="mb-1.5 flex items-center gap-2 text-sm">
              <TierBadge tier={tier} />
              <span className="text-cloud-50/75">{TIER_INFO[tier].points} pts</span>
            </h3>
            <ul className="space-y-1.5">
              {answers.map((a) => {
                const isMine = a.canonical === mine;
                return (
                  <li
                    key={a.canonical}
                    className={`rounded-xl border px-3 py-2 ${TIER_STYLE[tier].row} ${isMine ? "bg-white/15 ring-2 ring-sun-300" : "bg-night-950/70"}`}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">
                        {a.canonical}
                        {a.aiJudged && (
                          <span className="ml-2 text-xs text-sky-200" title="Not in the list; accepted by the AI judge">
                            ✨ AI judge
                          </span>
                        )}
                        {isMine && <span className="ml-2 text-xs font-bold text-sun-300 uppercase">your answer</span>}
                      </span>
                      <span className="flex shrink-0 items-baseline gap-2 text-xs text-cloud-50/75">
                        {counts && <span className="tabular-nums">{counts[a.canonical] ?? 0}×</span>}
                        <span>{a.reference}</span>
                      </span>
                    </div>
                    {a.genericFor && (
                      <p className="mt-0.5 text-xs text-cloud-50/75">Could mean: {a.genericFor.join(" · ")}. Be specific to rise higher.</p>
                    )}
                    {a.gemNote && !isMine && <p className="mt-1 text-sm text-amber-100/90">💎 {a.gemNote}</p>}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
