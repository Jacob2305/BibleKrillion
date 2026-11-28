import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { normalizeRoomCode } from "../../lib/game/live";
import type { LiveSnapshot } from "../../lib/game/live-types";
import type { RevealAnswer } from "../../lib/game/api-types";
import { CLIMB_START } from "../../lib/game/climb";
import { ANSWER_TIERS, TIER_INFO, type AnswerTier } from "../../lib/game/scoring";
import { World, type WorldProps } from "../game/climb/Climb";
import { useStagedClimb, type StagedClimb } from "../game/climb/staged";
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

  // The room climbs tier by tier, stopping at every tier somebody reached (lowest first);
  // each tier's marker says how many got there.
  const r = snap?.phase === "reveal" ? snap.reveal : undefined;
  const given = r ? r.reveal.answers.filter((a) => r.counts[a.canonical]) : [];
  const reached: Partial<Record<AnswerTier, number>> = {};
  for (const a of given) reached[a.tier] = (reached[a.tier] ?? 0) + r!.counts[a.canonical]!;
  const stops = ANSWER_TIERS.filter((t) => reached[t]);
  const climb = useStagedClimb({
    stops,
    active: !!r,
    roundKey: snap?.roundIndex ?? -1,
    // about 2 s per stop, a little longer when there are many answers to read
    holdMs: (tier) => Math.min(3600, 2000 + 250 * Math.max(0, given.filter((a) => a.tier === tier).length - 3)),
  });
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

function RevealScreen({ snap, climb }: { snap: LiveSnapshot; climb: StagedClimb }) {
  // The host picks what the room sees after a reveal; the climb is the default.
  return snap.view === "answers" ? <AnswerBoard snap={snap} /> : <ClimbView snap={snap} climb={climb} />;
}

/** Every answer, deepest tier first, plus what nobody said. Shown when the host picks "All answers". */
function AnswerBoard({ snap }: { snap: LiveSnapshot }) {
  const r = snap.reveal!;
  const given = r.reveal.answers.filter((a) => r.counts[a.canonical]);
  const missed = r.reveal.answers.filter((a) => !r.counts[a.canonical]);
  let delay = 0;
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
      {given.length === 0 && (
        <p className="pixel-panel mx-auto mt-[12vh] px-10 py-6 text-center text-5xl text-cloud-50/90">
          {r.answered > 0 ? "Nobody found a right answer this time." : "Nobody locked in an answer."}
        </p>
      )}
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

/**
 * The room's climb: the prompt and altimeter up top; as the world rises past each tier somebody
 * reached, that tier's guesses (one box per distinct answer) float in beside it. Lower tiers shrink
 * and fade as the room goes higher, and at the top it stays.
 */
function ClimbView({ snap, climb }: { snap: LiveSnapshot; climb: StagedClimb }) {
  const r = snap.reveal!;
  const given = r.reveal.answers.filter((a) => r.counts[a.canonical]);
  const stops = ANSWER_TIERS.filter((t) => given.some((a) => a.tier === t));
  // Tiers the room has arrived at so far (the one being climbed to joins on arrival).
  const arrived = climb.phase === "done" ? stops.length : climb.phase === "holding" ? climb.index + 1 : Math.max(0, climb.index);
  const shown = stops.slice(0, arrived).reverse(); // newest (highest) first
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="pixel-panel mx-auto max-w-[80%] px-10 py-4 text-center [text-shadow:3px_3px_0_rgb(0_0_0/0.55)]">
        <p className="text-2xl font-semibold tracking-widest text-sun-300 uppercase">
          Prompt {snap.roundIndex + 1} of {snap.roundCount}
        </p>
        <h1 className="font-display text-5xl leading-tight font-bold text-balance">{r.reveal.prompt}</h1>
        <p className="mt-1 font-mono text-4xl text-sun-300 tabular-nums" aria-hidden="true">
          ▲ <span ref={climb.meterRef}>0 m</span>
        </p>
      </div>
      {given.length === 0 ? (
        <p className="pixel-panel mx-auto mt-[14vh] px-10 py-6 text-center text-5xl text-cloud-50/90">
          {r.answered > 0 ? "Nobody found a right answer this time." : "Nobody locked in an answer."}
        </p>
      ) : (
        <div role="status" className="ml-auto flex min-h-0 w-[46%] flex-1 flex-col items-end gap-4 overflow-hidden pt-6">
          {shown.map((tier, i) => (
            <FloatingTier key={tier} tier={tier} newest={i === 0} answers={given.filter((a) => a.tier === tier)} counts={r.counts} finders={r.finders} />
          ))}
        </div>
      )}
      {climb.phase !== "done" && given.length > 0 && (
        <button
          type="button"
          onClick={climb.skip}
          aria-label="Skip to the top"
          title="Skip to the top"
          className="absolute right-0 bottom-0 rounded-xl px-3 py-1 text-base text-cloud-50/40 ring-2 ring-white/10 hover:text-cloud-50"
        >
          ⏭
        </button>
      )}
    </div>
  );
}

/** One tier's guesses as small floating boxes; older (lower) tiers shrink and fade. */
function FloatingTier({
  tier,
  newest,
  answers,
  counts,
  finders,
}: {
  tier: AnswerTier;
  newest: boolean;
  answers: readonly RevealAnswer[];
  counts: Record<string, number>;
  finders: Record<string, string[]>;
}) {
  const sorted = [...answers].sort((a, b) => (counts[b.canonical] ?? 0) - (counts[a.canonical] ?? 0) || a.canonical.localeCompare(b.canonical));
  return (
    <section className={`climb-rise flex max-w-full flex-col items-end gap-2 transition-opacity duration-700 ${newest ? "" : "opacity-60"}`}>
      <TierBadge tier={tier} size="lg" />
      <ul className="flex flex-wrap justify-end gap-2">
        {sorted.map((a, i) => (
          <li
            key={a.canonical}
            className={`animate-rise rounded-xl border-2 bg-night-950/90 px-3 py-1 shadow-[4px_4px_0_rgba(0,0,0,0.4)] ${TIER_STYLE[tier].row} ${newest ? "max-w-[34rem]" : "max-w-[22rem]"}`}
            style={{ animationDelay: `${i * 90}ms` }}
          >
            <div className={`flex items-baseline gap-3 ${newest ? "text-3xl" : "text-xl"}`}>
              <span className="truncate font-semibold">{a.canonical}</span>
              <span className="shrink-0 font-mono text-cloud-50/70 tabular-nums">×{counts[a.canonical]}</span>
            </div>
            {newest && finders[a.canonical] && <p className="truncate text-lg text-cloud-50/70">{finders[a.canonical]!.join(" · ")}</p>}
            {newest && a.gemNote && <p className="line-clamp-2 text-lg text-amber-100">💎 {a.gemNote}</p>}
          </li>
        ))}
      </ul>
    </section>
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
      aria-label="Full screen"
      title="Full screen"
      className="rounded-xl px-3 py-1 text-base text-cloud-50/40 ring-2 ring-white/10 hover:text-cloud-50"
    >
      ⛶
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

// ───────────────────────── dev preview ─────────────────────────

// Deliberately NOT from the answer bank: this file ships to browsers, and bank answers must not.
const DEMO_ANSWERS: { canonical: string; tier: AnswerTier; count: number; finders?: string[]; gemNote?: string }[] = [
  { canonical: "Red", tier: "plankton", count: 9 },
  { canonical: "Blue", tier: "plankton", count: 7 },
  { canonical: "Green", tier: "plankton", count: 2 },
  { canonical: "Teal", tier: "schooler", count: 3 },
  { canonical: "Maroon", tier: "schooler", count: 2 },
  { canonical: "Vermilion", tier: "rare", count: 1, finders: ["Grace"] },
  { canonical: "Cerulean", tier: "rare", count: 1, finders: ["Bot Gabriel"] },
  {
    canonical: "Fulvous",
    tier: "one_in_a_million",
    count: 1,
    finders: ["Sam"],
    gemNote: "Sample gem note: a dull brownish-yellow, shown here to preview how gem notes look.",
  },
];

/** /dev/climb?room=1 (dev only): the projector's staged room climb with made-up answers. ?room=none: nobody scored. */
export function ProjectorRevealDemo({ nobody = false }: { nobody?: boolean }) {
  const [run, setRun] = useState(0);
  const [view, setView] = useState<"climb" | "answers">("climb");
  const answers = nobody ? [] : DEMO_ANSWERS;
  const snap = {
    code: "DEMO",
    phase: "reveal",
    view,
    roundIndex: run,
    roundCount: 12,
    playerCount: 24,
    reveal: {
      reveal: {
        promptId: "demo",
        prompt: "Sample prompt: name a colour",
        answers: [...answers].reverse().map((a) => ({ canonical: a.canonical, tier: a.tier, points: TIER_INFO[a.tier].points, reference: "", gemNote: a.gemNote })),
      },
      counts: Object.fromEntries(answers.map((a) => [a.canonical, a.count])),
      finders: Object.fromEntries(answers.filter((a) => a.finders).map((a) => [a.canonical, a.finders!])),
      answered: nobody ? 5 : 24,
      players: 24,
    },
  } as unknown as LiveSnapshot;
  const r = snap.reveal!;
  const reached: Partial<Record<AnswerTier, number>> = {};
  for (const a of answers) reached[a.tier] = (reached[a.tier] ?? 0) + a.count;
  const climb = useStagedClimb({ stops: ANSWER_TIERS.filter((t) => reached[t]), active: true, roundKey: run, holdMs: () => 2000 });
  const notes = Object.fromEntries(Object.entries(reached).map(([t, n]) => [t, `${n} ${n === 1 ? "climber" : "climbers"}`]));
  return (
    <Stage world={{ ...climb.world, notes }}>
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between text-2xl text-cloud-50/70">
          <span className="font-display font-bold text-sun-300">{APP_NAME}</span>
          <span className="flex gap-2">
            <button type="button" className="rounded-xl px-3 py-1 text-base ring-2 ring-white/20" onClick={() => setView(view === "climb" ? "answers" : "climb")}>
              {view === "climb" ? "All answers" : "Climb"}
            </button>
            <button type="button" className="rounded-xl px-3 py-1 text-base ring-2 ring-white/20" onClick={() => setRun((n) => n + 1)}>
              Replay
            </button>
          </span>
        </header>
        <div className="min-h-0 flex-1 py-8">
          <RevealScreen key={run} snap={snap} climb={climb} />
        </div>
        <footer className="text-lg text-cloud-50/40">{r.players} climbers</footer>
      </div>
    </Stage>
  );
}
