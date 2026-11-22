import { useCallback, useEffect, useState } from "react";
import type { DailyFinishResponse } from "../../lib/game/api-types";
import { msUntilNextDay, shareText } from "../../lib/game/daily";
import { pointsForTier } from "../../lib/game/scoring";
import { BigButton } from "../game/DivePlayer";
import { DiveResults } from "../game/DiveResults";
import { Distribution } from "../game/Distribution";
import { finishDaily } from "../lib/api";
import { navigate } from "../lib/router";
import { setDailyRecord } from "../lib/storage";

/** Today's results: score, share card, standing, and how everyone answered. */
export function DailyFinish({ token }: { token: string }) {
  const [data, setData] = useState<DailyFinishResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await finishDaily(token);
      setData(res);
      setDailyRecord({ day: res.day, status: "done", token, total: res.total, tiers: res.rounds.map((r) => r.tier) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load today's results.");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div role="alert" className="space-y-4 rounded-2xl bg-rose-950/50 p-5 ring-2 ring-rose-400/40">
        <p className="font-medium text-rose-100">{error}</p>
        <BigButton onClick={() => void load()}>Try again</BigButton>
      </div>
    );
  }
  if (!data) {
    return (
      <p className="py-24 text-center text-cloud-50/70" role="status">
        Gathering your results…
      </p>
    );
  }

  const results = data.rounds.map((r) => ({ ...r, points: pointsForTier(r.tier), typed: null }));
  const text = shareText({ day: data.day, tiers: data.rounds.map((r) => r.tier), total: data.total, url: `${window.location.origin}/daily` });

  return (
    <div className="space-y-8">
      <DiveResults results={results}>
        <ShareCard text={text} />
        <Standing players={data.players} shallower={data.shallower} />
        <NextDive />
      </DiveResults>

      <section>
        <h2 className="mb-1 text-xl font-semibold">How everyone answered today</h2>
        <p className="mb-3 text-sm text-cloud-50/60">Just for fun: popularity never changes the points.</p>
        <Distribution distribution={data.distribution} rounds={data.rounds} />
      </section>

      <div className="space-y-3">
        <BigButton onClick={() => navigate("/practice")}>Keep climbing: Practice</BigButton>
        <button
          type="button"
          onClick={() => navigate("/")}
          className="w-full rounded-2xl px-6 py-3 text-cloud-50/80 ring-2 ring-white/20 hover:bg-white/10 focus-visible:ring-4 focus-visible:ring-white/60 focus-visible:outline-none"
        >
          Back to the ground
        </button>
      </div>
    </div>
  );
}

function ShareCard({ text }: { text: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
    window.setTimeout(() => setStatus("idle"), 2500);
  };
  return (
    <section className="space-y-3 rounded-2xl bg-night-950/80 p-4 ring-2 ring-white/10" aria-label="Share your climb">
      <pre className="font-sans text-center text-lg leading-relaxed whitespace-pre-wrap select-all">{text}</pre>
      <BigButton onClick={() => void copy()}>{status === "copied" ? "Copied! Paste it anywhere" : "Share (copy result)"}</BigButton>
      <p aria-live="polite" className="text-center text-sm text-cloud-50/60">
        {status === "failed" ? "Couldn't copy automatically. Select the text above and copy it." : "No answers are revealed in the share text."}
      </p>
    </section>
  );
}

function Standing({ players, shallower }: { players: number; shallower: number }) {
  const others = players - 1;
  const count = `${players.toLocaleString("en-US")} climbers`;
  const pct = others > 0 ? Math.round((shallower / others) * 100) : 0;
  const message =
    others <= 0
      ? "You're today's first climber!"
      : shallower === 0
        ? `${count} have climbed today. Tomorrow's a fresh ascent!`
        : `${count} today · you rose higher than ${pct}% of the others.`;
  return <p className="text-center text-cloud-50/80">{message}</p>;
}

function NextDive() {
  const [left, setLeft] = useState(() => msUntilNextDay(Date.now()));
  useEffect(() => {
    const id = window.setInterval(() => setLeft(msUntilNextDay(Date.now())), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const h = Math.floor(left / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  return (
    <p className="text-center text-sm text-cloud-50/60">
      Next Daily Ascent in {h}h {m}m (midnight Eastern).
    </p>
  );
}
