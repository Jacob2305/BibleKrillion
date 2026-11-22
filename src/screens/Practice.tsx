import { DivePlayer, BigButton } from "../game/DivePlayer";
import { DiveResults } from "../game/DiveResults";
import { practiceApi } from "../lib/api";
import { navigate } from "../lib/router";

export default function Practice() {
  return (
    <DivePlayer
      api={practiceApi}
      modeLabel="Practice"
      intro={
        <div className="space-y-4">
          <h1 className="font-display text-4xl font-bold">Practice ascent</h1>
          <p className="text-lg text-cloud-50/80">
            7 random prompts, 25 seconds each. Type any right answer; the rarer it is, the higher you rise.
          </p>
          <ul className="space-y-1.5 text-cloud-50/70">
            <li>• Not in the bank? Keep trying until time runs out.</li>
            <li>• Close spellings count. Shared names like “James” count too, but being specific rises higher.</li>
            <li>• Practice scores aren't saved. Play as often as you like.</li>
          </ul>
        </div>
      }
      renderFinished={({ results, restart }) => (
        <DiveResults results={results}>
        <div className="space-y-3">
          <p className="text-center text-sm text-cloud-50/60">Practice scores aren't saved.</p>
          <BigButton onClick={restart}>Climb again</BigButton>
          <button
            type="button"
            onClick={() => navigate("/")}
            className="w-full rounded-2xl px-6 py-3 text-cloud-50/80 ring-2 ring-white/20 hover:bg-white/10 focus-visible:ring-4 focus-visible:ring-white/60 focus-visible:outline-none"
          >
            Back to the ground
          </button>
        </div>
        </DiveResults>
      )}
    />
  );
}
