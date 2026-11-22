import { useState, type FormEvent, type ReactNode } from "react";
import { APP_NAME } from "../../lib/game/brand";
import { normalizeRoomCode } from "../../lib/game/live";
import type { LiveHostInfo, LiveHostOp, LiveSnapshot } from "../../lib/game/live-types";
import { PROMPTS_PER_DIVE } from "../../lib/game/scoring";
import { BigButton } from "../game/DivePlayer";
import { TierBadge } from "../game/TierBadge";
import { TimerBar } from "../game/TimerBar";
import { ApiError } from "../lib/api";
import { Link } from "../lib/router";
import { addHostedRoom, getHostedRooms, removeHostedRoom } from "../lib/storage";
import { useCountdown } from "../lib/useCountdown";
import { joinDisplayUrl, joinUrl, liveApi } from "../live/liveApi";
import { ConnectionNote, Leaderboard, Podium, QrCode, TeamBoard } from "../live/ui";
import { useLiveRoom, type LiveData } from "../live/useLiveRoom";

const ROUND_OPTIONS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const SECOND_OPTIONS = [10, 15, 20, 25, 30, 40, 45, 60];

interface Active {
  code: string;
  token: string;
  initial?: LiveData;
}

/** /host — create a room and run it. */
export default function Host() {
  const [active, setActive] = useState<Active | null>(() => {
    const code = normalizeRoomCode(new URLSearchParams(window.location.search).get("code"));
    const saved = code ? getHostedRooms().find((r) => r.code === code) : undefined;
    return saved ? { code: saved.code, token: saved.token } : null;
  });

  if (!active) {
    return (
      <Setup
        onCreated={(data) => {
          const code = data.snapshot.code;
          addHostedRoom({ code, token: data.hostToken, at: Date.now() });
          window.history.replaceState(null, "", `/host?code=${code}`);
          setActive({ code, token: data.hostToken, initial: data });
        }}
        onResume={(code, token) => {
          window.history.replaceState(null, "", `/host?code=${code}`);
          setActive({ code, token });
        }}
      />
    );
  }
  return (
    <Console
      key={active.token}
      active={active}
      onExit={() => {
        window.history.replaceState(null, "", "/host");
        setActive(null);
      }}
    />
  );
}

// ───────────────────────── setup ─────────────────────────

function Setup({ onCreated, onResume }: { onCreated: (data: Awaited<ReturnType<typeof liveApi.create>>) => void; onResume: (code: string, token: string) => void }) {
  const [rounds, setRounds] = useState(PROMPTS_PER_DIVE);
  const [seconds, setSeconds] = useState(25);
  const [teams, setTeams] = useState(false);
  const [pin, setPin] = useState("");
  const [needsPin, setNeedsPin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previous, setPrevious] = useState(getHostedRooms);
  const urlCode = normalizeRoomCode(new URLSearchParams(window.location.search).get("code"));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated(await liveApi.create({ rounds, seconds, teams, pin: pin || undefined }));
    } catch (err) {
      if (err instanceof ApiError && err.code === "pin") setNeedsPin(true);
      setError(err instanceof Error ? err.message : "Couldn't create the room.");
    } finally {
      setBusy(false);
    }
  };

  const field = "rounded-xl border-0 bg-white/95 px-3 py-2.5 text-night-950 focus:ring-4 focus:ring-sun-300/60 focus:outline-none";
  return (
    <Page>
      <h1 className="font-display text-4xl font-bold">Host a live ascent</h1>
      <p className="mt-2 text-lg text-cloud-50/80">
        Put the room on a projector; everyone plays on their phone. Up to 150 players.
      </p>
      {urlCode && (
        <p className="mt-4 rounded-xl bg-amber-900/40 px-3 py-2 text-amber-100 ring-2 ring-amber-300/30">
          This browser isn't the host of room {urlCode}. Open the host link on the device that created it, or start a new room.
        </p>
      )}

      {previous.length > 0 && (
        <section className="mt-6 space-y-2">
          <h2 className="font-semibold">Your rooms</h2>
          {previous.map((r) => (
            <div key={r.code} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onResume(r.code, r.token)}
                className="flex-1 rounded-xl bg-night-700/60 px-4 py-3 text-left ring-2 ring-sun-300/30 hover:bg-night-700 focus-visible:ring-4 focus-visible:ring-sun-300 focus-visible:outline-none"
              >
                <span className="font-logo text-xl tracking-widest">{r.code}</span>
                <span className="ml-3 text-sm text-cloud-50/60">started {new Date(r.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · resume →</span>
              </button>
              <button
                type="button"
                aria-label={`Forget room ${r.code}`}
                onClick={() => {
                  removeHostedRoom(r.code);
                  setPrevious(getHostedRooms());
                }}
                className="rounded-xl px-3 py-3 text-cloud-50/50 ring-2 ring-white/10 hover:bg-white/10"
              >
                ✕
              </button>
            </div>
          ))}
        </section>
      )}

      <form onSubmit={submit} className="mt-8 space-y-5 rounded-3xl bg-night-950/75 p-5 ring-2 ring-white/10">
        <h2 className="text-xl font-semibold">New room</h2>
        <div className="grid grid-cols-2 gap-4">
          <label className="space-y-1">
            <span className="block text-sm font-medium">Prompts</span>
            <select value={rounds} onChange={(e) => setRounds(Number(e.target.value))} className={`${field} w-full`}>
              {ROUND_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-sm font-medium">Seconds each</span>
            <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} className={`${field} w-full`}>
              {SECOND_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex items-center gap-3">
          <input type="checkbox" checked={teams} onChange={(e) => setTeams(e.target.checked)} className="h-5 w-5 accent-teal-400" />
          <span>
            Teams <span className="text-sm text-cloud-50/60">(players type a team name; teams rank by average depth)</span>
          </span>
        </label>
        {needsPin && (
          <label className="block space-y-1">
            <span className="block text-sm font-medium">Host PIN</span>
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              className={`${field} w-40 font-mono tracking-widest`}
            />
          </label>
        )}
        {error && (
          <p role="alert" className="text-amber-200">
            {error}
          </p>
        )}
        <BigButton type="submit">{busy ? "Creating…" : "Create room"}</BigButton>
        <p className="text-sm text-cloud-50/50">You can change prompts and settings in the lobby before starting.</p>
      </form>
    </Page>
  );
}

// ───────────────────────── console ─────────────────────────

function Console({ active, onExit }: { active: Active; onExit: () => void }) {
  const [fatal, setFatal] = useState<string | null>(null);
  const room = useLiveRoom({ kind: "host", token: active.token }, { initial: active.initial, watchCounts: true, onFatal: (err) => setFatal(err.message) });
  const [busy, setBusy] = useState<LiveHostOp | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { snapshot: snap, host } = room;

  const act = async (op: LiveHostOp, extra: Record<string, unknown> = {}) => {
    setBusy(op);
    setActionError(null);
    try {
      room.accept(await liveApi.host(active.token, op, extra));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That didn't work.");
      void room.refresh();
    } finally {
      setBusy(null);
    }
  };

  if (fatal) {
    return (
      <Page>
        <p role="alert" className="text-xl">
          {fatal}
        </p>
        <div className="mt-6">
          <BigButton
            onClick={() => {
              removeHostedRoom(active.code);
              onExit();
            }}
          >
            Start a new room
          </BigButton>
        </div>
      </Page>
    );
  }
  if (!snap || !host) {
    return (
      <Page>
        <p role="status" className="py-24 text-center text-cloud-50/70">
          Loading room {active.code}…
        </p>
      </Page>
    );
  }

  return (
    <div className="min-h-dvh bg-night-900">
      <div className="mx-auto max-w-6xl px-4 pt-4 pb-16">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3 text-sm">
          <Link href="/" className="rounded-lg px-1 py-1 text-cloud-50/70 hover:text-cloud-50 focus-visible:outline-2 focus-visible:outline-sun-300">
            ← {APP_NAME}
          </Link>
          <span className="text-cloud-50/60">Host console · keep this tab open</span>
          <ConnectionNote connection={room.connection} error={room.error} />
        </header>

        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <aside className="space-y-4">
            <JoinCard code={snap.code} />
            <button
              type="button"
              onClick={() => window.open(`/screen?code=${snap.code}`, `bible-dive-screen-${snap.code}`)}
              className="w-full rounded-2xl px-4 py-3 font-semibold ring-2 ring-sun-300/50 hover:bg-white/10 focus-visible:ring-4 focus-visible:ring-sun-300 focus-visible:outline-none"
            >
              Open projector screen ↗
            </button>
            <p className="text-xs text-cloud-50/50">
              Drag that window to the projector and press F11 (or use its full-screen button). It updates by itself.
            </p>
          </aside>

          <main className="min-w-0 space-y-6">
            {snap.closed && (
              <p className="rounded-xl bg-night-950/85 px-4 py-3">
                This room has ended. <button type="button" onClick={onExit} className="underline">Host another room</button>
              </p>
            )}
            <PhasePanel snap={snap} busy={busy} act={act} toLocal={room.toLocal} />
            {actionError && (
              <p role="alert" className="text-amber-200">
                {actionError}
              </p>
            )}
            <Players snap={snap} host={host} act={act} />
            <AiAnswers host={host} act={act} />
            <Prompts snap={snap} host={host} act={act} busy={busy} />
            {!snap.closed && (
              <div className="border-t border-white/10 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`End room ${snap.code}? Nobody can join or answer after this.`)) void act("end");
                  }}
                  className="rounded-xl px-4 py-2 text-sm text-rose-200 ring-2 ring-rose-300/40 hover:bg-rose-950/50"
                >
                  End room
                </button>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function JoinCard({ code }: { code: string }) {
  return (
    <section className="space-y-3 rounded-3xl bg-night-950/80 p-5 text-center ring-2 ring-white/10" aria-label="How to join">
      <p className="text-sm text-cloud-50/60">Join at {joinDisplayUrl()}</p>
      <p className="font-logo text-6xl font-bold tracking-[0.2em] text-sun-300">{code}</p>
      <QrCode text={joinUrl(code)} className="mx-auto w-48" />
    </section>
  );
}

type Act = (op: LiveHostOp, extra?: Record<string, unknown>) => Promise<void>;

function PhasePanel({
  snap,
  busy,
  act,
  toLocal,
}: {
  snap: LiveSnapshot;
  busy: LiveHostOp | null;
  act: Act;
  toLocal: (ms: number) => number;
}) {
  const isLast = snap.roundIndex + 1 >= snap.roundCount;
  const nextButton = isLast ? (
    <BigButton onClick={() => void act("final")}>{busy === "final" ? "…" : "Final results 🏆"}</BigButton>
  ) : (
    <BigButton onClick={() => void act("start")}>{busy === "start" ? "…" : `Next prompt (${snap.roundIndex + 2} of ${snap.roundCount}) →`}</BigButton>
  );

  if (snap.closed) return null;

  switch (snap.phase) {
    case "lobby":
      return (
        <Panel title="Lobby">
          <Settings snap={snap} act={act} />
          <p className="text-cloud-50/70">
            {snap.playerCount === 0 ? "Waiting for players to join…" : `${snap.playerCount} ${snap.playerCount === 1 ? "player has" : "players have"} joined.`}
          </p>
          <BigButton onClick={() => void act("start")}>{busy === "start" ? "Starting…" : `Start the ascent: prompt 1 of ${snap.roundCount}`}</BigButton>
        </Panel>
      );

    case "question":
      return <QuestionPanel snap={snap} busy={busy} act={act} deadline={toLocal(snap.question!.deadline)} />;

    case "reveal": {
      const reveal = snap.reveal!;
      const given = reveal.reveal.answers.filter((a) => reveal.counts[a.canonical]).sort((a, b) => b.points - a.points);
      return (
        <Panel title={`Reveal · prompt ${snap.roundIndex + 1} of ${snap.roundCount}`}>
          <p className="text-lg font-semibold">{reveal.reveal.prompt}</p>
          <p className="text-cloud-50/70">
            {reveal.answered} of {reveal.players} answered · {given.length} different answers
          </p>
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {given.map((a) => (
              <li key={a.canonical} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  {a.canonical}
                  {reveal.finders[a.canonical] && <span className="ml-2 text-cloud-50/50">{reveal.finders[a.canonical]!.join(", ")}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <TierBadge tier={a.tier} />
                  <span className="w-8 text-right tabular-nums">{reveal.counts[a.canonical]}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="grid gap-3 sm:grid-cols-2">
            <BigButton onClick={() => void act("leaderboard")}>{busy === "leaderboard" ? "…" : "Show leaderboard"}</BigButton>
            {nextButton}
          </div>
        </Panel>
      );
    }

    case "leaderboard":
      return (
        <Panel title={`Leaderboard after ${snap.roundIndex + 1} of ${snap.roundCount}`}>
          {snap.leaderboard && <Leaderboard rows={snap.leaderboard} limit={5} />}
          {nextButton}
        </Panel>
      );

    case "final":
      return (
        <Panel title="Final results">
          {snap.leaderboard && <Podium rows={snap.leaderboard} rounds={snap.roundCount} />}
          {snap.teamBoard && <TeamBoard rows={snap.teamBoard} />}
          <BigButton onClick={() => void act("end")}>{busy === "end" ? "…" : "End room"}</BigButton>
        </Panel>
      );
  }
}

function QuestionPanel({ snap, busy, act, deadline }: { snap: LiveSnapshot; busy: LiveHostOp | null; act: Act; deadline: number }) {
  const q = snap.question!;
  const remaining = useCountdown(deadline);
  const open = remaining > 0;
  const answered = snap.answeredCount ?? 0;
  return (
    <Panel title={`Prompt ${q.index + 1} of ${snap.roundCount} · ${q.prompt.category}`}>
      <p className="font-display text-2xl font-bold">{q.prompt.prompt}</p>
      <TimerBar remainingMs={remaining} totalSeconds={q.seconds} />
      <div>
        <div className="mb-1 flex justify-between text-sm">
          <span>Locked in</span>
          <span className="tabular-nums">
            {answered} / {snap.playerCount}
          </span>
        </div>
        <div className="h-2 rounded-none bg-white/10" aria-hidden="true">
          <div className="h-full rounded-none bg-sun-300 transition-[width]" style={{ width: `${snap.playerCount ? (answered / snap.playerCount) * 100 : 0}%` }} />
        </div>
      </div>
      {open ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => void act("close")}
            className="rounded-2xl px-6 py-4 font-semibold ring-2 ring-white/30 hover:bg-white/10 focus-visible:ring-4 focus-visible:ring-white/60 focus-visible:outline-none"
          >
            {busy === "close" ? "…" : "Stop the timer"}
          </button>
          <BigButton onClick={() => void act("reveal")}>{busy === "reveal" ? "Revealing…" : "Reveal now"}</BigButton>
        </div>
      ) : (
        <BigButton onClick={() => void act("reveal")} autoFocus>
          {busy === "reveal" ? "Revealing…" : "Time's up: reveal answers"}
        </BigButton>
      )}
    </Panel>
  );
}

function Settings({ snap, act }: { snap: LiveSnapshot; act: Act }) {
  const field = "rounded-xl border-0 bg-white/95 px-3 py-2 text-night-950 focus:ring-4 focus:ring-sun-300/60 focus:outline-none";
  return (
    <div className="flex flex-wrap items-end gap-4">
      <label className="space-y-1">
        <span className="block text-sm">Prompts</span>
        <select value={snap.roundCount} onChange={(e) => void act("settings", { rounds: Number(e.target.value) })} className={field}>
          {ROUND_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1">
        <span className="block text-sm">Seconds each</span>
        <select value={snap.seconds} onChange={(e) => void act("settings", { seconds: Number(e.target.value) })} className={field}>
          {[...new Set([...SECOND_OPTIONS, snap.seconds])].sort((a, b) => a - b).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 pb-2">
        <input type="checkbox" checked={snap.teams} onChange={(e) => void act("settings", { teams: e.target.checked })} className="h-5 w-5 accent-teal-400" />
        Teams
      </label>
    </div>
  );
}

function Players({ snap, host, act }: { snap: LiveSnapshot; host: LiveHostInfo; act: Act }) {
  const active = host.players.filter((p) => !p.kicked);
  const removed = host.players.filter((p) => p.kicked);
  const question = snap.phase === "question";
  return (
    <details className="rounded-3xl bg-night-950/75 ring-2 ring-white/10" open={snap.phase === "lobby"}>
      <summary className="cursor-pointer px-5 py-4 font-semibold focus-visible:outline-2 focus-visible:outline-sun-300">
        Players ({active.length}){removed.length > 0 && <span className="font-normal text-cloud-50/50"> · {removed.length} removed</span>}
      </summary>
      <ul className="max-h-80 space-y-1 overflow-y-auto px-5 pb-4">
        {host.players.length === 0 && <li className="text-cloud-50/60">Nobody yet.</li>}
        {host.players.map((p) => (
          <li key={p.id} className={`flex items-center gap-3 rounded-xl px-2 py-1.5 ${p.kicked ? "opacity-50" : ""}`}>
            <span className="w-5 text-center" aria-label={question ? (p.answered ? "locked in" : "still answering") : undefined}>
              {question ? (p.answered ? "✓" : "…") : ""}
            </span>
            <span className={`min-w-0 flex-1 truncate ${p.kicked ? "line-through" : ""}`}>
              {p.nickname}
              {p.team && <span className="ml-2 text-xs text-cloud-50/50">{p.team}</span>}
            </span>
            <button
              type="button"
              onClick={() => {
                if (p.kicked || window.confirm(`Remove “${p.nickname}” from the room? They'll disappear from the screen and leaderboard.`)) {
                  void act(p.kicked ? "unkick" : "kick", { playerId: p.id });
                }
              }}
              className="rounded-lg px-2 py-1 text-xs ring-2 ring-white/20 hover:bg-white/10"
            >
              {p.kicked ? "Restore" : "Remove"}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

function AiAnswers({ host, act }: { host: LiveHostInfo; act: Act }) {
  if (host.aiAnswers.length === 0) return null;
  const pending = host.aiAnswers.filter((a) => a.status === "auto").length;
  return (
    <details className="rounded-3xl bg-night-950/75 ring-2 ring-white/10" open={pending > 0}>
      <summary className="cursor-pointer px-5 py-4 font-semibold focus-visible:outline-2 focus-visible:outline-sun-300">
        ✨ AI-judged answers ({host.aiAnswers.length}){pending > 0 && <span className="font-normal text-sun-300"> · {pending} to check</span>}
      </summary>
      <p className="px-5 text-sm text-cloud-50/60">
        Not in the answer list, but the AI judge accepted them (Deep Cut, 85 pts). Approve to keep them for future games; reject to
        take the points away in this room.
      </p>
      <ul className="space-y-2 px-5 py-4">
        {host.aiAnswers.map((a) => (
          <li key={`${a.roundIndex}|${a.canonical}`} className="flex flex-wrap items-center gap-3 rounded-xl bg-night-950/60 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {a.canonical} <span className="font-normal text-cloud-50/60">· {a.reference}</span>
                {a.count > 1 && <span className="ml-2 text-sm text-cloud-50/60">×{a.count}</span>}
              </p>
              <p className="truncate text-xs text-cloud-50/50">
                Prompt {a.roundIndex + 1}: {a.prompt}
              </p>
            </div>
            {a.status === "auto" ? (
              <span className="flex gap-2">
                <button type="button" onClick={() => void act("ai_approve", { roundIndex: a.roundIndex, canonical: a.canonical })} className="px-3 py-1 text-sm ring-2 ring-emerald-300/60 hover:bg-emerald-900/40">
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Reject “${a.canonical}”? Players who gave it lose those points in this room.`)) {
                      void act("ai_reject", { roundIndex: a.roundIndex, canonical: a.canonical });
                    }
                  }}
                  className="px-3 py-1 text-sm ring-2 ring-rose-300/60 hover:bg-rose-950/50"
                >
                  Reject
                </button>
              </span>
            ) : (
              <span className={`text-sm ${a.status === "rejected" ? "text-rose-200" : "text-emerald-200"}`}>
                {a.status === "rejected" ? "Rejected" : a.status === "merged" ? "In the bank" : "Approved"}
              </span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Prompts({ snap, host, act, busy }: { snap: LiveSnapshot; host: LiveHostInfo; act: Act; busy: LiveHostOp | null }) {
  return (
    <details className="rounded-3xl bg-night-950/75 ring-2 ring-white/10">
      <summary className="cursor-pointer px-5 py-4 font-semibold focus-visible:outline-2 focus-visible:outline-sun-300">
        Prompts <span className="font-normal text-cloud-50/50">(host only: don't show this on the projector)</span>
      </summary>
      <ol className="space-y-1 px-5 pb-4">
        {host.prompts.map((p) => {
          const done = p.index < snap.roundIndex || (p.index === snap.roundIndex && snap.phase !== "question");
          const current = p.index === snap.roundIndex && snap.phase === "question";
          const upcoming = p.index > snap.roundIndex && snap.phase !== "final" && !snap.closed;
          return (
            <li key={p.index} className="flex items-center gap-3 rounded-xl px-2 py-1.5">
              <span className="w-6 text-right font-mono text-cloud-50/50 tabular-nums">{p.index + 1}</span>
              <span className="w-5 text-center" aria-hidden="true">
                {done ? "✓" : current ? "▶" : ""}
              </span>
              <span className={`min-w-0 flex-1 ${done ? "text-cloud-50/50" : ""}`}>
                {p.prompt}
                <span className="ml-2 text-xs text-cloud-50/40">{p.category}</span>
              </span>
              {upcoming && (
                <button
                  type="button"
                  disabled={busy === "swap"}
                  onClick={() => void act("swap", { index: p.index })}
                  className="rounded-lg px-2 py-1 text-xs ring-2 ring-white/20 hover:bg-white/10 disabled:opacity-50"
                >
                  Swap
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-3xl bg-night-950/80 p-5 ring-2 ring-white/10">
      <h2 className="text-sm font-semibold tracking-widest text-sun-300/80 uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Page({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-night-900">
      <main className="mx-auto max-w-xl px-4 pt-4 pb-16">
        <header className="mb-5 text-sm">
          <Link href="/" className="rounded-lg px-1 py-1 text-cloud-50/70 hover:text-cloud-50 focus-visible:outline-2 focus-visible:outline-sun-300">
            ← {APP_NAME}
          </Link>
        </header>
        {children}
      </main>
    </div>
  );
}
