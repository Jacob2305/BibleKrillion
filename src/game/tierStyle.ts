import type { ResultTier } from "../../lib/game/scoring";

/** Tailwind classes per tier: shallow water is pale, the deep glows. */
export const TIER_STYLE: Record<ResultTier, { badge: string; row: string; text: string }> = {
  plankton: { badge: "bg-teal-200 text-teal-950", row: "border-teal-200/30", text: "text-teal-200" },
  too_clever: { badge: "bg-amber-300 text-amber-950", row: "border-amber-300/30", text: "text-amber-300" },
  schooler: { badge: "bg-sky-300 text-sky-950", row: "border-sky-300/30", text: "text-sky-300" },
  rare: { badge: "bg-violet-300 text-violet-950", row: "border-violet-300/40", text: "text-violet-300" },
  deep_cut: { badge: "bg-fuchsia-400 text-fuchsia-950", row: "border-fuchsia-400/40", text: "text-fuchsia-300" },
  one_in_a_million: {
    badge: "bg-gradient-to-r from-yellow-200 via-amber-300 to-yellow-200 text-amber-950 shadow-[0_0_18px_rgba(252,211,77,0.55)]",
    row: "border-amber-300/70",
    text: "text-amber-200",
  },
  miss: { badge: "bg-slate-600 text-slate-100", row: "border-slate-500/40", text: "text-slate-300" },
};
