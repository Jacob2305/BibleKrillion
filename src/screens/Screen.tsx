import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { normalizeRoomCode } from "../../lib/game/live";
import type { LiveSnapshot } from "../../lib/game/live-types";
import { CLIMB_START, highestTier } from "../../lib/game/climb";
import { ANSWER_TIERS, TIER_INFO, type AnswerTier } from "../../lib/game/scoring";
import { RevealHud, World, useRevealClimb, type RevealClimb, type WorldProps } from "../game/climb/Climb";
import { TierBadge } from "../game/TierBadge";
import { TimerBar } from "../game/TimerBar";
import { APP_NAME } from "../../lib/game/brand";
import { TIER_STYLE } from "../game/tierStyle";
import { useCountdown } from "../lib/useCountdown";
import { joinDisplayUrl, joinUrl } from "../live/liveApi";
import { ConnectionNote, Leaderboard, Podium, QrCode, TeamBoard } from "../live/ui";
import { useLiveRoom } from "../live/useLiveRoom";
import { MuteButton } from "../game/MuteButton";
import { playSfx } from "../lib/sound";

/** /screen?code=XXXX — the projector. Read-only; follows the host's actions. */
export default function Screen() {
  const [code, setCode] = useState(() => normalizeRoomCode(new URLSearchParams(window.location.search).get("code")));
  if (!code) {
    return (
      <CodeForm
        onCode={(c) => {
          window.history.replaceState(null, "", `/screen?code=${c}`);
          setCode(c);
        }}
      />
    );
  }
  return <Projector key={code} code={code} onGone={() => setCode(null)} />;
}

function CodeForm({ onCode }: { onCode: (code: string) => void }) {
  const [value, setValue] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const c = normalizeRoomCode(value);
    if (c) onCode(c);
  };
  return (
    <main className="flex min-h-dvh items-center justify-center bg-night-950 p-8">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-3xl font-bold">Projector screen</h1>
        <label htmlFor="screen-code" className="block text-cloud-50/70">
          Room code
        </label>
        <input
          id="screen-code"
          value={value}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          maxLength={4}
          autoFocus
          className="w-full rounded-2xl bg-white/95 px-4 py-3 text-center font-logo text-4xl tracking-[0.4em] text-night-950 focus:ring-4 focus:ring-sun-300/60 focus:outline-none"
        />
        <button type="submit" className="w-full rounded-2xl bg-sun-400 px-6 py-3 text-lg font-bold text-night-950">
          Show room
        </button>
      </form>
    </main>
  );
}

function Projector({ code, onGone }: { code: string; onGone: () => void }) {
  const [gone, setGone] = useState<string | null>(null);
  const room = useLiveRoom({ kind: "screen", code }, { watchCounts: true, onFatal: (err) => setGone(err.message) });
  const snap = room.snapshot;

  // The room climbs to the rarest tier anyone reached; each tier's marker says how many got there.
  const r = snap?.phase === "reveal" ? snap.reveal : undefined;
  const given = r ? r.reveal.answers.filter((a) => r.counts[a.canonical]) : [];
  const top = highestTier(given.map((a) => a.tier));
  const climb = useRevealClimb({ tier: top ?? "miss", active: !!r && top !== null, roundKey: snap?.roundIndex ?? -1, size: "stage" });
  const reached: Partial<Record<AnswerTier, number>> = {};
  for (const a of given) reached[a.tier] = (reached[a.tier] ?? 0) + r!.counts[a.canonical]!;
  const notes = Object.fromEntries(Object.entries(reached).map(([t, n]) => [t, `${n} ${n === 1 ? "climber" : "climbers"}`]));

  if (gone) {
    return (
      <Stage>
        <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
          <p className="pixel-panel px-10 py-6 text-5xl font-bold">Thanks for climbing! 🕊️</p>
          <p className="text-2xl text-cloud-50/60">{gone}</p>
          <button type="button" onClick={onGone} className="rounded-xl px-4 py-2 text-cloud-50/60 ring-2 ring-white/20">
            Show another room
          </button>
        </div>
      </Stage>
    );
  }
  if (!snap) {
    return (
      <Stage>
        <p className="flex h-full items-center justify-center text-3xl text-cloud-50/60">Connecting to room {code}…</p>
      </Stage>
    );
  }

  let body: ReactNode;
  switch (snap.phase) {
    case "lobby":
      body = <LobbyScreen snap={snap} />;
      break;
    case "question":
      body = <QuestionScreen snap={snap} deadline={room.toLocal(snap.question!.deadline)} />;
      break;
    case "reveal":
      body = <RevealScreen key={snap.roundIndex} snap={snap} climb={climb} />;
      break;
    case "leaderboard":
      body = (
        <BoardScreen title={`Leaderboard · after ${snap.roundIndex + 1} of ${snap.roundCount}`} snap={snap}>
          {snap.leaderboard && <Leaderboard rows={snap.leaderboard} limit={10} size="xl" />}
        </BoardScreen>
      );
      break;
    case "final":
      body = (
        <BoardScreen title="Final results" snap={snap}>
          {snap.leaderboard && <Podium rows={snap.leaderboard} rounds={snap.roundCount} size="xl" />}
        </BoardScreen>
      );
      break;
  }

  return (
    <Stage world={{ ...climb.world, notes }}>
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between gap-6 text-2xl text-cloud-50/70">
          <span className="font-display font-bold text-sun-300">{APP_NAME}</span>
          {snap.phase !== "lobby" && (
            <span>
              Join at <strong className="text-cloud-50">{joinDisplayUrl()}</strong> · code{" "}
              <strong className="font-logo tracking-widest text-sun-300">{snap.code}</strong>
            </span>
          )}
          <span className="flex items-center gap-3">
            <MuteButton className="text-2xl" />
            <FullscreenButton />
          </span>
        </header>
        <div className="min-h-0 flex-1 py-8">{body}</div>
        <footer className="flex justify-between text-lg text-cloud-50/40">
          <span>
            {snap.playerCount} {snap.playerCount === 1 ? "climber" : "climbers"}
          </span>
          <ConnectionNote connection={room.connection} error={room.error} />
        </footer>
      </div>
    </Stage>
  );
}

function LobbyScreen({ snap }: { snap: LiveSnapshot }) {
  const players = snap.players ?? [];
  // Newest first, so whoever just joined sees their name pop up; chips shrink as the room fills.
  const newestFirst = [...players].reverse();
  const seen = useRef(players.length);
  useEffect(() => {
    if (players.length > seen.current) playSfx({ name: "join" });
    seen.current = players.length;
  }, [players.length]);
  const chip = players.length > 80 ? "px-3 py-1 text-lg" : players.length > 40 ? "px-4 py-1.5 text-xl" : "px-5 py-2 text-2xl";
  return (
    <div className="flex h-full items-center gap-16">
      <div className="pixel-panel flex w-2/5 shrink-0 flex-col items-center gap-6 p-8 text-center">
        <p className="text-4xl text-cloud-50/80">
          Join at <strong className="text-cloud-50">{joinDisplayUrl()}</strong>
        </p>
        <p className="font-logo text-[10rem] leading-none font-bold tracking-[0.15em] text-sun-300">{snap.code}</p>
        <QrCode text={joinUrl(snap.code)} className="w-72" />
        <p className="text-2xl text-cloud-50/60">
          {snap.roundCount} prompts · {snap.seconds} seconds each · rarer answers rise higher
        </p>
      </div>
      <div className="pixel-panel min-w-0 flex-1 self-stretch p-8">
        <p className="mb-6 text-4xl font-bold">
          {players.length === 0 ? "Waiting for climbers…" : `${players.length} ${players.length === 1 ? "climber" : "climbers"} ready`}
        </p>
        <ul className="flex max-h-[62vh] flex-wrap content-start gap-2.5 overflow-hidden [mask-image:linear-gradient(to_bottom,black_85%,transparent)]">
          {newestFirst.map((p) => (
            <li key={p.id} className={`animate-rise rounded-none bg-white/10 ring-2 ring-white/15 ${chip}`}>
              {p.nickname}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function QuestionScreen({ snap, deadline }: { snap: LiveSnapshot; deadline: number }) {
  const q = snap.question!;
  const remaining = useCountdown(deadline);
  useEffect(() => playSfx({ name: "start" }), [q.index]);
  const answered = snap.answeredCount ?? 0;
  return (
    <div className="pixel-panel flex h-full flex-col justify-center gap-12 p-12">
      <div>
        <p className="mb-4 text-3xl font-semibold tracking-widest text-sun-300/80 uppercase">
          Prompt {q.index + 1} of {snap.roundCount} · {q.prompt.category}
        </p>
        <h1 className="font-display text-7xl leading-tight font-bold text-balance">{q.prompt.prompt}</h1>
      </div>
      {remaining > 0 ? (
        <div className="space-y-6 text-3xl">
          <TimerBar remainingMs={remaining} totalSeconds={q.seconds} size="xl" />
          <p className="text-cloud-50/80">
            <strong className="text-sun-300 tabular-nums">{answered}</strong> of {snap.playerCount} locked in
          </p>
        </div>
      ) : (
        <div className="text-center">
          <p className="text-7xl font-bold">⏱ Time's up!</p>
          <p className="mt-4 text-3xl text-cloud-50/70">
            {answered} of {snap.playerCount} locked in · answers coming up…
          </p>
        </div>
      )}
    </div>
  );
}

const DEEPEST_FIRST = [...ANSWER_TIERS].reverse();

function RevealScreen({ snap, climb }: { snap: LiveSnapshot; climb: RevealClimb }) {
  const r = snap.reveal!;
  const given = r.reveal.answers.filter((a) => r.counts[a.canonical]);
  const missed = r.reveal.answers.filter((a) => !r.counts[a.canonical]);
  // Someone scored → the room climbs first (see Projector). After the landing has had its moment,
  // the answers come in over the zone the room reached.
  const climbs = given.length > 0;
  const [showList, setShowList] = useState(!climbs);
  useEffect(() => {
    if (climb.phase !== "landed") return;
    const t = window.setTimeout(() => setShowList(true), 2600);
    return () => clearTimeout(t);
  }, [climb.phase]);
  let delay = 0;
  if (climbs && !showList) {
    const best = given
      .filter((a) => a.tier === climb.tier)
      .sort((a, b) => r.counts[b.canonical]! - r.counts[a.canonical]!)
      .slice(0, 3);
    return (
      <RevealHud
        climb={climb}
        topClass="pt-28"
        kicker={`Prompt ${snap.roundIndex + 1} of ${snap.roundCount} · how high did the room climb?`}
        headline={r.reveal.prompt}
        caption={best.map((a) => `${a.canonical} ×${r.counts[a.canonical]}`).join(" · ")}
      />
    );
  }
  return (
    <div className="relative flex h-full min-h-0 flex-col gap-6">
      {/* dim the scene so the answers read well */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-night-950/55" />
      <div className="flex items-baseline justify-between gap-6">
        <h1 className="font-display text-5xl font-bold text-balance">{r.reveal.prompt}</h1>
        <p className="shrink-0 text-2xl text-cloud-50/70">
          {r.answered} of {r.players} answered
        </p>
      </div>
      <div className="min-h-0 flex-1 columns-3 gap-6 overflow-hidden">
        {DEEPEST_FIRST.map((tier) => {
          const answers = given.filter((a) => a.tier === tier);
          if (answers.length === 0) return null;
          return (
            <section key={tier} className="mb-5 break-inside-avoid">
              <h2 className="mb-2 flex items-center gap-3">
                <TierBadge tier={tier} size="lg" />
                <span className="text-xl text-cloud-50/50">{TIER_INFO[tier].points} pts</span>
              </h2>
              <ul className="space-y-2">
                {answers.map((a) => (
                  <li
                    key={a.canonical}
                    className={`animate-rise rounded-2xl border-2 bg-night-950/80 px-4 py-2 ${TIER_STYLE[tier].row}`}
                    style={{ animationDelay: `${(delay += 120)}ms` }}
                  >
                    <div className="flex items-baseline justify-between gap-3 text-3xl">
                      <span className="font-semibold">
                        {a.canonical}
                        {a.aiJudged && <span className="ml-3 text-xl text-sky-200">✨ AI judge</span>}
                      </span>
                      <span className="font-mono text-cloud-50/70 tabular-nums">×{r.counts[a.canonical]}</span>
                    </div>
                    {r.finders[a.canonical] && <p className="text-xl text-cloud-50/60">{r.finders[a.canonical]!.join(" · ")}</p>}
                    {a.gemNote && <p className="mt-1 text-xl text-amber-100">💎 {a.gemNote}</p>}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {given.length === 0 && <p className="text-4xl text-cloud-50/70">Nobody locked in an answer.</p>}
      </div>
      {missed.length > 0 && (
        <p className="line-clamp-2 text-xl text-cloud-50/50">
          <span className="font-semibold text-cloud-50/70">Nobody said: </span>
          {missed.map((a) => `${a.canonical}${a.tier === "one_in_a_million" ? " 💎" : ""}`).join(" · ")}
        </p>
      )}
    </div>
  );
}

function BoardScreen({ title, snap, children }: { title: string; snap: LiveSnapshot; children: ReactNode }) {
  const teams = snap.teamBoard && snap.teamBoard.length > 0;
  return (
    <div className="flex h-full min-h-0 flex-col gap-8">
      <h1 className="pixel-panel mx-auto px-10 py-4 text-center font-display text-6xl font-bold">{title}</h1>
      <div className={`grid min-h-0 flex-1 gap-10 ${teams ? "grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : ""}`}>
        <div className="min-h-0 overflow-hidden">{children}</div>
        {teams && (
          <section className="min-h-0 overflow-hidden">
            <h2 className="mb-4 text-3xl font-semibold">Teams</h2>
            <TeamBoard rows={snap.teamBoard!} size="xl" />
          </section>
        )}
      </div>
    </div>
  );
}

function FullscreenButton() {
  if (typeof document === "undefined" || !document.fullscreenEnabled) return <span />;
  return (
    <button
      type="button"
      onClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void document.documentElement.requestFullscreen())}
      className="rounded-xl px-3 py-1 text-base text-cloud-50/40 ring-2 ring-white/10 hover:text-cloud-50"
    >
      ⛶ Full screen
    </button>
  );
}

function Stage({ children, world = { target: CLIMB_START, instant: true } }: { children: ReactNode; world?: WorldProps }) {
  return (
    <main className="relative h-dvh overflow-hidden">
      <World {...world} />
      <div className="relative z-10 h-full px-12 py-8">{children}</div>
    </main>
  );
}
