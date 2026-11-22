/**
 * The background of every screen: the climb world resting at sea level
 * (Plankton). Game screens drive the camera themselves with `<World>`; plain
 * pages use this static view.
 */
import type { ReactNode } from "react";
import { CLIMB_START } from "../../lib/game/climb";
import { World } from "./climb/Climb";

export function Sky() {
  return <World target={CLIMB_START} instant />;
}

/** A full-height page over the sea-level world. */
export function SkyPage({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative min-h-dvh ${className}`}>
      <Sky />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
