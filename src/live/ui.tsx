/** Pieces shared by the phone, host console and projector views. */
import { useEffect, useState } from "react";
import type { LiveLeaderRow, LiveTeamRow } from "../../lib/game/live-types";
import { METERS_PER_POINT, PROMPTS_PER_DIVE, diveRatingLabel } from "../../lib/game/scoring";
import { formatMeters } from "../game/Altitude";
import type { Connection } from "./useLiveRoom";

export const metersOf = (points: number) => formatMeters(points * METERS_PER_POINT);

/** Dive rating bands are set for 7 prompts; scale shorter or longer games to match. */
export const liveRatingLabel = (total: number, rounds: number) =>
  diveRatingLabel(Math.round((total * PROMPTS_PER_DIVE) / Math.max(1, rounds)));

export function QrCode({ text, className = "" }: { text: string; className?: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void import("qrcode").then((QR) =>
      QR.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#020c18", light: "#ffffff" } }).then(
        (s) => live && setSvg(s),
      ),
    );
    return () => {
      live = false;
    };
  }, [text]);
  return (
    <div
      role="img"
      aria-label={`QR code for ${text}`}
      className={`aspect-square overflow-hidden rounded-2xl bg-white p-2 [&>svg]:h-full [&>svg]:w-full ${className}`}
      // The SVG comes from the qrcode library, generated from our own URL.
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}

export function ConnectionNote({ connection, error }: { connection: Connection; error: string | null }) {
  if (error) {
    return (
      <p role="status" className="text-sm text-amber-200">
        {error}
      </p>
    );
  }
  if (connection === "live") return null;
  return (
    <p role="status" className="text-xs text-cloud-50/40">
      {connection === "connecting" ? "Connecting…" : "Syncing every few seconds"}
    </p>
  );
}

export function Leaderboard({
  rows,
  limit = 10,
  highlightId,
  size = "md",
}: {
  rows: readonly LiveLeaderRow[];
  limit?: number;
  highlightId?: string;
  size?: "md" | "xl";
}) {
  const shown = rows.slice(0, limit);
  const mine = highlightId ? rows.find((r) => r.id === highlightId) : undefined;
  const big = size === "xl";
  const row = (r: LiveLeaderRow) => {
    const isMine = r.id === highlightId;
    return (
      <li
        key={r.id}
        className={`animate-rise flex items-center gap-3 rounded-2xl px-4 ${big ? "py-3 text-3xl" : "py-2.5 text-base"} ${
          isMine ? "bg-sun-300/20 ring-2 ring-sun-300" : "bg-night-950/75"
        }`}
        style={{ animationDelay: `${Math.min(r.rank, 12) * 70}ms` }}
      >
        <span className={`${big ? "w-14" : "w-8"} shrink-0 font-mono text-cloud-50/60 tabular-nums`}>{r.rank}</span>
        <span className="min-w-0 flex-1 truncate font-semibold">
          {r.nickname}
          {r.team && <span className={`ml-2 font-normal text-cloud-50/70 ${big ? "text-xl" : "text-xs"}`}>{r.team}</span>}
        </span>
        {r.last !== null && r.last > 0 && (
          <span className={`font-mono text-sun-300/80 tabular-nums ${big ? "text-xl" : "text-xs"}`}>+{r.last}</span>
        )}
        <span className={`font-mono text-sun-300 tabular-nums ${big ? "w-48" : "w-24"} text-right`}>{metersOf(r.total)}</span>
      </li>
    );
  };
  return (
    <ol className={big ? "space-y-2.5" : "space-y-1.5"} aria-label="Leaderboard">
      {shown.map(row)}
      {mine && mine.rank > limit && (
        <>
          <li aria-hidden="true" className="text-center text-cloud-50/40">
            ⋯
          </li>
          {row(mine)}
        </>
      )}
    </ol>
  );
}

export function TeamBoard({ rows, size = "md" }: { rows: readonly LiveTeamRow[]; size?: "md" | "xl" }) {
  if (rows.length === 0) return null;
  const big = size === "xl";
  return (
    <ol className="space-y-1.5" aria-label="Team standings">
      {rows.map((t) => (
        <li
          key={t.team}
          className={`animate-rise flex items-center gap-3 rounded-2xl bg-night-950/75 px-4 ${big ? "py-3 text-2xl" : "py-2 text-sm"}`}
          style={{ animationDelay: `${Math.min(t.rank, 12) * 70 + 300}ms` }}
        >
          <span className="w-8 shrink-0 font-mono text-cloud-50/60 tabular-nums">{t.rank}</span>
          <span className="min-w-0 flex-1 truncate font-semibold">{t.team}</span>
          <span className="text-cloud-50/50">
            {t.members} {t.members === 1 ? "climber" : "climbers"}
          </span>
          <span className="font-mono text-sun-300 tabular-nums">{metersOf(t.average)} avg</span>
        </li>
      ))}
    </ol>
  );
}

const MEDALS = ["🥇", "🥈", "🥉"];

/** Top three, 2nd · 1st · 3rd. */
export function Podium({ rows, rounds, size = "md" }: { rows: readonly LiveLeaderRow[]; rounds: number; size?: "md" | "xl" }) {
  const top = rows.slice(0, 3);
  if (top.length === 0) return <p className="text-center text-cloud-50/60">Nobody climbed this time.</p>;
  const order = [top[1], top[0], top[2]];
  const big = size === "xl";
  const heights = big ? ["h-56", "h-80", "h-40"] : ["h-28", "h-40", "h-20"];
  return (
    <div className="flex items-end justify-center gap-3" aria-label="Podium">
      {order.map((r, i) =>
        r ? (
          <div key={r.id} className={`flex min-w-0 flex-1 flex-col items-center ${big ? "max-w-xs" : "max-w-[8rem]"}`}>
            <span className={big ? "text-6xl" : "text-3xl"} aria-hidden="true">
              {MEDALS[r.rank - 1]}
            </span>
            <span className={`mt-1 w-full truncate text-center font-bold ${big ? "text-4xl" : "text-base"}`}>{r.nickname}</span>
            <span className={`font-mono text-sun-300 tabular-nums ${big ? "text-2xl" : "text-sm"}`}>{metersOf(r.total)}</span>
            <span className={`text-cloud-50/60 ${big ? "text-lg" : "text-xs"}`}>{liveRatingLabel(r.total, rounds)}</span>
            <div
              className={`mt-2 w-full rounded-t-2xl bg-gradient-to-b from-sun-300/50 to-night-700/40 ring-2 ring-sun-300/30 ${heights[i]}`}
            />
          </div>
        ) : (
          <div key={`empty-${i}`} className="flex-1" />
        ),
      )}
    </div>
  );
}
