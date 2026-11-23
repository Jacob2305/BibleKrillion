/**
 * Shared building blocks for the climb zones (see Scenes.tsx). One art pixel
 * is `--px` (set on the climb overlay), so all sprites share the same pixel size.
 */
import type { CSSProperties, ReactNode } from "react";
import { Sprite, type Palette } from "../pixel";
import { starfield } from "./art";

/** `n` art pixels as a CSS length. */
export const px = (n: number) => `calc(${n} * var(--px))`;

/** Colours where one zone meets the next (bottom of the deep … top of the cosmos). */
export const EDGES = ["#020c18", "#04213a", "#e48a8f", "#9a7fc8", "#4a56b0", "#1a1650", "#090726", "#1b0733"];

/** A sprite placed in a zone: `x`/`y` are % from the left / bottom; `scale` art pixels per pixel. */
export function Art({
  art,
  palette,
  x,
  y,
  scale = 1,
  center = false,
  className = "",
  style,
}: {
  art: readonly string[];
  palette: Palette;
  x: number | string;
  y: number | string;
  scale?: number;
  center?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const cols = Math.max(...art.map((r) => r.length));
  return (
    <div
      className={`absolute ${className}`}
      style={{
        left: typeof x === "number" ? `${x}%` : x,
        bottom: typeof y === "number" ? `${y}%` : y,
        width: px(cols * scale),
        transform: center ? "translate(-50%, 50%)" : undefined,
        ...style,
      }}
    >
      <Sprite art={art} palette={palette} className="block w-full" />
    </div>
  );
}

/** A pixel grid as a CSS background tile. */
export function tileUrl(art: readonly string[], palette: Palette): string {
  const w = Math.max(...art.map((r) => r.length));
  let rects = "";
  art.forEach((row, y) => [...row].forEach((ch, x) => palette[ch] && (rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${palette[ch]}"/>`)));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${art.length}" shape-rendering="crispEdges">${rects}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function Zone({ index, children }: { index: number; children: ReactNode }) {
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ transform: `translateY(${-index * 100}%)`, background: `linear-gradient(to top, ${EDGES[index + 1]}, ${EDGES[index + 2]})` }}
    >
      {children}
    </div>
  );
}

export function Stars({ count, seed, fromBottom, color = "#fff8ec" }: { count: number; seed: number; fromBottom?: number; color?: string }) {
  return (
    <>
      {starfield(count, seed, { fromBottom }).map((s, i) => (
        <span
          key={i}
          className={`absolute ${s.twinkle ? "animate-twinkle" : ""}`}
          style={{ left: `${s.x}%`, bottom: `${s.y}%`, width: px(s.big ? 2 : 1), height: px(s.big ? 2 : 1), background: color, animationDelay: `${s.delay}s` }}
        />
      ))}
    </>
  );
}
