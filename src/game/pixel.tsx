/**
 * Tiny pixel-art renderer: each sprite is a text grid, one character per pixel,
 * drawn as crisp SVG squares (runs of the same colour merged into one rect).
 * All art here is original to this project.
 */
import { useMemo, type CSSProperties } from "react";

export type Palette = Record<string, string>;

export function Sprite({
  art,
  palette,
  className = "",
  title,
  style,
}: {
  art: readonly string[];
  palette: Palette;
  className?: string;
  title?: string;
  style?: CSSProperties;
}) {
  const { rects, w, h } = useMemo(() => {
    const out: { x: number; y: number; w: number; fill: string }[] = [];
    art.forEach((row, y) => {
      let x = 0;
      while (x < row.length) {
        const fill = palette[row[x]!];
        if (!fill) {
          x++;
          continue;
        }
        let end = x + 1;
        while (end < row.length && row[end] === row[x]) end++;
        out.push({ x, y, w: end - x, fill });
        x = end;
      }
    });
    return { rects: out, w: Math.max(...art.map((r) => r.length)), h: art.length };
  }, [art, palette]);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      className={`pixelated ${className}`}
      style={style}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      {rects.map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
      ))}
    </svg>
  );
}

// ───────────────────────── art ─────────────────────────

/** A dove in flight, wing raised (faces right). */
export const DOVE = [
  "..W...............",
  "..WW..............",
  "...WW.............",
  "...WWW............",
  "....WWW...........",
  "....WWWW.....WW...",
  ".....WWWW...WWWW..",
  "WW...WWWWWWWWWKWOO",
  ".WWWWWWWWWWWWWWW..",
  "..WWWWWWWWWWWWW...",
  "...GGWWWWWWWGG....",
  "......GGGGG.......",
] as const;
export const DOVE_PALETTE: Palette = { W: "#fff8ec", G: "#c8c2ea", K: "#13163f", O: "#ffbf3c" };

export const CLOUD_BIG = [
  "......CCCC..........",
  "....CCCCCCCC..CCC...",
  "..CCCCCCCCCCCCCCCCC.",
  ".CCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCC",
  "SSCCCCCCCCCCCCCCCCSS",
  ".SSSSSSSSSSSSSSSSSS.",
] as const;

export const CLOUD_SMALL = [
  "....CCCC......",
  "..CCCCCCCCC...",
  ".CCCCCCCCCCCC.",
  "CCCCCCCCCCCCCC",
  ".SSSSSSSSSSSS.",
] as const;

export const CLOUD_PALETTE: Palette = { C: "#fff8ec", S: "#cfc6ee" };

export const SUN = [
  "...YYYY...",
  ".YYYYYYYY.",
  ".YLLYYYYY.",
  "YLLYYYYYYY",
  "YYYYYYYYYY",
  "YYYYYYYYYY",
  "YYYYYYYYOY",
  ".YYYYYYOO.",
  ".YYYYYYYY.",
  "...YYYY...",
] as const;
export const SUN_PALETTE: Palette = { Y: "#ffbf3c", L: "#fff1b8", O: "#f08a3c" };

export function Dove({ className = "", title }: { className?: string; title?: string }) {
  return <Sprite art={DOVE} palette={DOVE_PALETTE} className={className} title={title} />;
}
