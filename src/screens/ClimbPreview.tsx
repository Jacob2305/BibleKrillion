import { useState } from "react";
import { TIER_INFO, TIER_ORDER, type ResultTier } from "../../lib/game/scoring";
import { RevealHud, World, useRevealClimb } from "../game/climb/Climb";
import { ProjectorRevealDemo } from "./Screen";

/** /dev/climb (dev server only): play the reveal climb for any tier. */
export default function ClimbPreview() {
  const params = new URLSearchParams(window.location.search);
  const [tier, setTier] = useState<ResultTier | null>((params.get("tier") as ResultTier | null) ?? null);
  const [stage, setStage] = useState(params.get("size") === "stage");
  const [run, setRun] = useState(0);
  const climb = useRevealClimb({ tier: tier ?? "miss", active: tier !== null, roundKey: run, size: stage ? "stage" : "phone" });
  // ?room=1 plays the projector's staged room climb (?room=none: nobody scored).
  const room = params.get("room");
  if (room !== null) return <ProjectorRevealDemo nobody={room === "none"} />;
  // ?zone=N shows one zone of the map, still, with no HUD (for checking the art).
  const zone = params.get("zone");
  if (zone !== null) return <World target={Number(zone)} instant />;
  return (
    <div className="relative min-h-dvh">
      <World {...climb.world} notes={stage ? { plankton: "14 climbers", schooler: "6 climbers", deep_cut: "2 climbers" } : undefined} />
      {tier === null && (
        <main className="relative z-10 mx-auto max-w-xl space-y-4 px-4 py-8">
          <h1 className="text-3xl font-bold">Reveal climb preview</h1>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={stage} onChange={(e) => setStage(e.target.checked)} /> Projector size
          </label>
          <div className="grid grid-cols-2 gap-2">
            {TIER_ORDER.map((t) => (
              <button
                key={t}
                type="button"
                className="pixel-button bg-sun-400 px-3 py-2 font-bold text-night-950"
                onClick={() => {
                  setTier(t);
                  setRun((n) => n + 1);
                }}
              >
                {TIER_INFO[t].emoji} {TIER_INFO[t].label}
              </button>
            ))}
          </div>
        </main>
      )}
      {tier !== null && (
        <RevealHud
          climb={climb}
          topClass={stage ? "pt-10" : "pt-6"}
          kicker={stage ? "Prompt 3 of 7" : "Your answer"}
          headline={stage ? "An example prompt goes here" : tier === "miss" ? "No answer" : "Example answer"}
          caption={stage ? "Example ×2" : undefined}
          actions={
            <button type="button" className="pixel-button w-full bg-sun-400 px-6 py-4 text-xl font-bold text-night-950" onClick={() => setTier(null)}>
              Back down to the sea
            </button>
          }
        />
      )}
    </div>
  );
}
