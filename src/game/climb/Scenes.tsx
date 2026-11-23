/**
 * The six zones of the reveal climb, bottom to top, plus the deep water below
 * the sea. Each zone fills one screen; everything is placed in % so it works
 * on a phone in portrait and on a 16:9 projector. One art pixel is `--px`
 * (set on the climb overlay), so all sprites share the same pixel size.
 *
 * zone.tsx: shared helpers · sea.tsx: deep, sea, creekside · sky.tsx: open sky,
 * edge of space · space.tsx: outer space, cosmos.
 */
import { memo } from "react";
import { Creekside, Deep, Sea } from "./sea";
import { EdgeOfSpace, OpenSky } from "./sky";
import { Cosmos, OuterSpace } from "./space";

export { px } from "./zone";

/** The whole tower, bottom to top. Memoised: it never changes, so camera moves never re-render it. */
export const ClimbWorld = memo(function ClimbWorld() {
  return (
    <>
      <Deep />
      <Sea />
      <Creekside />
      <OpenSky />
      <EdgeOfSpace />
      <OuterSpace />
      <Cosmos />
    </>
  );
});
