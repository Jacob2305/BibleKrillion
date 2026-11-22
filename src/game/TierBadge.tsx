import { TIER_INFO, type ResultTier } from "../../lib/game/scoring";
import { TIER_STYLE } from "./tierStyle";

export function TierBadge({ tier, size = "sm" }: { tier: ResultTier; size?: "sm" | "lg" }) {
  const info = TIER_INFO[tier];
  const sizing = size === "lg" ? "px-4 py-1.5 text-base" : "px-2.5 py-0.5 text-xs";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-none font-semibold whitespace-nowrap [text-shadow:none] ${sizing} ${TIER_STYLE[tier].badge}`}>
      <span aria-hidden="true">{info.emoji}</span>
      {info.label}
    </span>
  );
}
