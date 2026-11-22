import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { normalizeRoomCode } from "../../lib/game/live";
import type { RevealAnswer } from "../../lib/game/api-types";
import type { LiveMe, LiveSnapshot } from "../../lib/game/live-types";
import { APP_NAME } from "../../lib/game/brand";
import { AnswersSheet, RevealHud, World, useRevealClimb, type RevealClimb } from "../game/climb/Climb";
import { SkyPage } from "../game/Sky";
import { BigButton } from "../game/DivePlayer";
import { RevealList } from "../game/RevealList";
import { SuggestionLine, suggestionShowing } from "../game/Suggestion";
import type { Suggestion } from "../game/useDive";
import { TimerBar } from "../game/TimerBar";
import { ApiError } from "../lib/api";
import { Link } from "../lib/router";
import { clearLiveSeat, getLiveSeat, getNickname, setLiveSeat, setNickname } from "../lib/storage";
import { useCountdown } from "../lib/useCountdown";
import { useSlow } from "../lib/useSlow";
import { liveApi } from "../live/liveApi";
import { playSfx } from "../lib/sound";
import { MuteButton } from "../game/MuteButton";
import { ConnectionNote, Leaderboard, Podium, TeamBoard, metersOf, liveRatingLabel } from "../live/ui";
import { useLiveRoom, type LiveData } from "../live/useLiveRoom";

interface Seat {
  code: string;
  token: string;
  initial?: LiveData;
}

function codeFromUrl(): string | null {
  return normalizeRoomCode(new URLSearchParams(window.location.search).get("code"));
}

/** /join — a player's phone. */
export default function Join() {
  const [seat, setSeat] = useState<Seat | null>(() => {
    const code = codeFromUrl();
    const saved = code ? getLiveSeat(code) : null;
    return saved ? { code: saved.code, token: saved.token } : null;
  });
  const [notice, setNotice] = useState<string | null>(null);

  if (!seat) {
    return (
      <Shell>
        <JoinForm
          notice={notice}
          onJoined={(code, data) => {
            setLiveSeat({ code, token: data.playerToken, nickname: data.me.nickname, at: Date.now() });
            window.history.replaceState(null, "", `/join?code=${code}`);
            setSeat({ code, token: data.playerToken, initial: data });
          }}
        />
      </Shell>
    );
  }
  return (
    <PlayerRoom
      key={seat.token}
      seat={seat}
      onLeave={(message) => {
        clearLiveSeat(seat.code);
        setNotice(message);
        setSeat(null);
      }}
    />
  );
}

// ───────────────────────── joining ─────────────────────────

function JoinForm({ notice, onJoined }: { notice: string | null; onJoined: (code: string, data: Awaited<ReturnType<typeof liveApi.join>>) => void }) {
  const [code, setCode] = useState(() => codeFromUrl() ?? "");
  const [name, setName] = useState(getNickname);
  const [team, setTeam] = useState("");
  const [room, setRoom] = useState<{ code: string; teams: boolean } | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const normalized = normalizeRoomCode(code);

  // Look the room up as soon as the code is complete (to know whether to ask for a team).
  useEffect(() => {
    if (!normalized || room?.code === normalized) return;
    let live = true;
    liveApi
      .stateByCode(normalized)
      .then((res) => {
        if (!live) return;
        setRoom({ code: normalized, teams: res.snapshot.teams });
        setCodeError(res.snapshot.phase === "final" ? "That game has finished." : null);
      })
      .catch((err: unknown) => live && setCodeError(err instanceof ApiError ? err.message : "Couldn't find that room."));
    return () => {
      live = false;
    };
  }, [normalized, room?.code]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!normalized) return setCodeError("Room codes are 4 letters. Check the big screen.");
    const nickname = name.replace(/\s+/g, " ").trim();
    if (!nickname) return setNameError("Pick a nickname.");
    setBusy(true);
    try {
      const res = await liveApi.join(normalized, nickname, room?.teams ? team.trim() || undefined : undefined);
      setNickname(nickname);
      onJoined(normalized, res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't join.";
      if (err instanceof ApiError && err.code === "name_taken") setNameError(msg);
      else setCodeError(msg);
    } finally {
      setBusy(false);
    }
  };

  const input =
    "w-full rounded-2xl border-0 bg-white/95 px-4 py-3.5 text-lg text-night-950 placeholder:text-slate-400 focus:ring-4 focus:ring-sun-300/60 focus:outline-none";
  return (
    <form onSubmit={submit} className="pixel-panel space-y-6 p-5">
      <div className="space-y-2">
        <h1 className="font-display text-4xl font-bold">Join a live ascent</h1>
        <p className="text-lg text-cloud-50/80">Enter the code on the big screen.</p>
        {notice && (
          <p role="alert" className="rounded-xl bg-amber-900/40 px-3 py-2 text-amber-100 ring-2 ring-amber-300/30">
            {notice}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label htmlFor="room-code" className="block font-medium">
          Room code
        </label>
        <input
          id="room-code"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4));
            setCodeError(null);
          }}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={4}
          placeholder="ABCD"
          aria-invalid={codeError ? true : undefined}
          aria-describedby="room-code-help"
          className={`${input} text-center font-logo text-3xl tracking-[0.5em] uppercase`}
        />
        <p id="room-code-help" className={`text-sm ${codeError ? "text-amber-200" : "text-cloud-50/50"}`}>
          {codeError ?? "4 letters, no vowels."}
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="live-nickname" className="block font-medium">
          Your nickname
        </label>
        <input
          id="live-nickname"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameError(null);
          }}
          maxLength={24}
          autoComplete="nickname"
          autoCapitalize="words"
          aria-invalid={nameError ? true : undefined}
          aria-describedby="live-nickname-help"
          placeholder="e.g. High Flying Hannah"
          className={input}
        />
        <p id="live-nickname-help" className={`text-sm ${nameError ? "text-amber-200" : "text-cloud-50/50"}`}>
          {nameError ?? "This shows on the big screen, so keep it friendly."}
        </p>
      </div>

      {room?.teams && (
        <div className="space-y-2">
          <label htmlFor="live-team" className="block font-medium">
            Team <span className="font-normal text-cloud-50/50">(optional)</span>
          </label>
          <input
            id="live-team"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            maxLength={24}
            autoCapitalize="words"
            placeholder="e.g. Table 4"
            className={input}
          />
          <p className="text-sm text-cloud-50/50">Use the exact same team name as your teammates.</p>
        </div>
      )}

      <BigButton type="submit">{busy ? "Joining…" : "Join"}</BigButton>
    </form>
  );
}

// ───────────────────────── in the room ─────────────────────────

type Feedback = { message: string; nonce: number; tone: "warn" | "error" };

function PlayerRoom({ seat, onLeave }: { seat: Seat; onLeave: (message: string) => void }) {
  const [removed, setRemoved] = useState(false);
  const room = useLiveRoom(
    { kind: "player", token: seat.token },
    {
      initial: seat.initial,
      onFatal: (err) => (err.code === "kicked" ? setRemoved(true) : onLeave(err.message)),
    },
  );
  const { snapshot: snap, me } = room;
  const [locked, setLocked] = useState<{ index: number; canonical: string } | null>(null);
  // Depth stays on screen between leaderboards (snapshots only carry it after reveals).
  const lastTotal = useRef(0);
  const myRow = snap?.leaderboard?.find((r) => r.id === me?.id);
  if (myRow) lastTotal.current = myRow.total;
  const total = lastTotal.current;

  const kicked = removed || !!me?.kicked || (!!me && !!snap?.removed.includes(me.id));
  // This prompt's locked answer: from this session, or remembered by the server after a refresh.
  const lockedNow = snap && me ? ([locked, me.current].find((l) => l && snap.question && l.index === snap.question.index) ?? null) : null;
  const revealing = !!snap && !!me && snap.phase === "reveal" && !!snap.reveal && !kicked;
  const myAnswer = revealing && lockedNow ? snap.reveal!.reveal.answers.find((a) => a.canonical === lockedNow.canonical) : undefined;
  // The world climbs to this player's tier at the reveal, then glides back to the sea for the next prompt.
  const climb = useRevealClimb({
    tier: myAnswer?.tier ?? "miss",
    active: revealing,
    roundKey: snap?.roundIndex ?? -1,
    seenKey: snap && me ? `bibledive:climbed:${snap.code}:${me.id}:${snap.roundIndex}` : undefined,
  });

  if (!snap || !me) {
    return (
      <Shell>
        <p className="py-24 text-center text-cloud-50/70" role="status">
          Finding your seat…
        </p>
      </Shell>
    );
  }

  let body: ReactNode;
  if (kicked) {
    body = (
      <Card>
        <p className="text-2xl font-bold">You've been removed from this room.</p>
        <p className="mt-2 text-cloud-50/70">If that's a mistake, ask the host.</p>
      </Card>
    );
  } else if (snap.phase === "lobby") {
    body = <Lobby me={me} snap={snap} />;
  } else if (snap.phase === "question" && snap.question) {
    body = lockedNow ? (
      <Locked canonical={lockedNow.canonical} snap={snap} />
    ) : (
      <Answering
        key={snap.question.index}
        snap={snap}
        deadline={room.toLocal(snap.question.deadline)}
        token={seat.token}
        onLocked={setLocked}
        onRemoved={() => setRemoved(true)}
        onStale={() => void room.refresh()}
      />
    );
  } else if (snap.phase === "reveal") {
    body = <MyReveal snap={snap} me={me} answer={myAnswer} climb={climb} connection={<ConnectionNote connection={room.connection} error={room.error} />} />;
  } else if (snap.phase === "leaderboard") {
    body = <Standings snap={snap} me={me} />;
  } else {
    body = <Final snap={snap} me={me} />;
  }

  return (
    <div className="relative min-h-dvh">
      <World
        {...climb.world}
        explore={!kicked && (snap.phase === "lobby" || (revealing && climb.phase === "landed"))}
        backClass={revealing ? "bottom-40" : "bottom-6"}
      />
      <main className="relative z-10 mx-auto max-w-xl px-4 pt-4 pb-16">
        <header className="pixel-panel mb-5 flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <span className="font-logo tracking-widest text-cloud-50/60">{snap.code}</span>
          <span className="min-w-0 truncate font-medium">{me.nickname}</span>
          <span className="flex items-center gap-2">
            <span className="font-mono text-sun-300 tabular-nums">{metersOf(total)}</span>
            <MuteButton />
          </span>
        </header>
        {snap.closed && snap.phase !== "final" && !kicked && (
          <p className="mb-4 rounded-xl bg-night-950/85 px-3 py-2 text-cloud-50/80">The host has ended this room. Thanks for diving!</p>
        )}
        {body}
        {!revealing && (
          <div className="mt-6 text-center">
            <ConnectionNote connection={room.connection} error={room.error} />
          </div>
        )}
      </main>
    </div>
  );
}

function Lobby({ me, snap }: { me: LiveMe; snap: LiveSnapshot }) {
  return (
    <Card>
      <p className="animate-bob text-5xl" aria-hidden="true">
        🤿
      </p>
      <p className="mt-3 text-3xl font-bold">You're in, {me.nickname}!</p>
      {me.team && <p className="mt-1 text-cloud-50/70">Team {me.team}</p>}
      <p className="mt-4 text-lg text-cloud-50/80">Look up at the big screen. The ascent starts soon.</p>
      <p className="mt-2 text-cloud-50/60" aria-live="polite">
        {snap.playerCount} {snap.playerCount === 1 ? "climber" : "climbers"} in the room · {snap.roundCount} prompts · {snap.seconds}s each
      </p>
    </Card>
  );
}

function Answering({
  snap,
  deadline,
  token,
  onLocked,
  onRemoved,
  onStale,
}: {
  snap: LiveSnapshot;
  deadline: number;
  token: string;
  onLocked: (l: { index: number; canonical: string }) => void;
  onRemoved: () => void;
  onStale: () => void;
}) {
  const q = snap.question!;
  const remaining = useCountdown(deadline);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    playSfx({ name: "start" });
  }, []);
  const timeUp = remaining === 0;
  const slow = useSlow(busy);

  const send = async (answerText: string, atBuzzer = false) => {
    if (busy || (timeUp && !atBuzzer)) return;
    // Pressing Enter again on the same text confirms the suggested spelling.
    const confirm = suggestionShowing(suggestion, answerText);
    setBusy(true);
    const nonce = Date.now();
    try {
      const res = await liveApi.answer(token, q.index, answerText, confirm || undefined);
      if (res.status === "locked") {
        playSfx({ name: "lock" });
        return onLocked({ index: res.index, canonical: res.canonical });
      }
      if (res.status === "confirm") {
        playSfx({ name: "suggest" });
        setFeedback(null);
        setSuggestion({ text: answerText.trim(), canonical: res.suggestion });
        return;
      }
      setSuggestion(null);
      if (res.status !== "too_late") playSfx({ name: "wrong" });
      setFeedback({ message: res.message, nonce, tone: "warn" });
      if (res.status === "too_late") onStale();
      else inputRef.current?.select();
    } catch (err) {
      if (err instanceof ApiError && err.code === "kicked") return onRemoved();
      setFeedback({ message: err instanceof Error ? err.message : "Couldn't send that.", nonce, tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(text);
  };
  // A "Did you mean …?" still showing at the buzzer counts as yes (the server allows a short grace).
  const autoConfirmed = useRef(false);
  useEffect(() => {
    if (timeUp && !autoConfirmed.current && suggestionShowing(suggestion, text)) {
      autoConfirmed.current = true;
      void send(text, true);
    }
  });

  return (
    <div className="pixel-panel space-y-5 p-5">
      <div>
        <p className="mb-2 text-xs font-semibold tracking-widest text-sun-300/80 uppercase">
          Prompt {q.index + 1} of {snap.roundCount} · {q.prompt.category}
        </p>
        <h1 className="font-display text-3xl leading-tight font-bold text-balance">{q.prompt.prompt}</h1>
      </div>
      <TimerBar remainingMs={remaining} totalSeconds={q.seconds} />
      <SuggestionLine suggestion={suggestion} text={text} id="live-suggestion" />
      <form className="flex gap-2" onSubmit={submit}>
        <label htmlFor="live-answer" className="sr-only">
          Your answer
        </label>
        <input
          id="live-answer"
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={timeUp}
          maxLength={80}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="words"
          spellCheck={false}
          enterKeyHint="go"
          placeholder="Type an answer…"
          aria-describedby="live-suggestion live-feedback"
          className="min-w-0 flex-1 rounded-2xl border-0 bg-white/95 px-4 py-3.5 text-lg text-night-950 shadow-inner placeholder:text-slate-400 focus:ring-4 focus:ring-sun-300/60 focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={timeUp || busy}
          className="pixel-button bg-sun-400 px-5 text-lg font-bold text-night-950 transition-colors hover:bg-sun-300 focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-white disabled:opacity-50"
        >
          {suggestionShowing(suggestion, text) ? "Yes" : "Rise"}
        </button>
      </form>
      <p id="live-feedback" aria-live="polite" className="min-h-6">
        {timeUp ? (
          <span className="text-cloud-50/80">⏱ Time's up! Eyes on the big screen.</span>
        ) : busy ? (
          <span className="text-cloud-50/70">{slow ? "Asking the judge…" : "Checking…"}</span>
        ) : feedback ? (
          <span key={feedback.nonce} className={`inline-block animate-shake ${feedback.tone === "error" ? "text-rose-300" : "text-amber-200"}`}>
            {feedback.message}
          </span>
        ) : (
          <span className="text-cloud-50/50">Your first accepted answer locks in. Rarer rises higher.</span>
        )}
      </p>
    </div>
  );
}

function Locked({ canonical, snap }: { canonical: string; snap: LiveSnapshot }) {
  return (
    <Card>
      <p className="text-sm text-cloud-50/60">{snap.question?.prompt.prompt}</p>
      <p className="mt-4 text-sm font-semibold tracking-widest text-sun-300/80 uppercase">🔒 Locked in</p>
      <p className="mt-1 font-display text-4xl font-bold">{canonical}</p>
      <p className="mt-4 text-cloud-50/70">How high did it go? Find out at the reveal.</p>
    </Card>
  );
}

/** The reveal stays where the climb landed; every answer is one tap away. The host moves the room on. */
function MyReveal({
  snap,
  me,
  answer,
  climb,
  connection,
}: {
  snap: LiveSnapshot;
  me: LiveMe;
  answer: RevealAnswer | undefined;
  climb: RevealClimb;
  connection: ReactNode;
}) {
  const reveal = snap.reveal!;
  const row = snap.leaderboard?.find((r) => r.id === me.id);
  const [showAnswers, setShowAnswers] = useState(false);
  return (
    <>
      <RevealHud
        climb={climb}
        kicker={answer ? "Your answer" : snap.question?.prompt.prompt}
        headline={answer ? answer.canonical : "No answer this time"}
        caption={row ? `You're #${row.rank} of ${snap.playerCount} at ${metersOf(row.total)}` : undefined}
        details={
          <>
            {answer?.gemNote && <p className="text-amber-100">💎 {answer.gemNote}</p>}
            {answer?.aiJudged && <p className="text-sky-200">✨ Not in our list, but the AI judge accepted it: {answer.reference}</p>}
          </>
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => setShowAnswers(true)}
              className="pixel-button w-full bg-sun-400 px-6 py-4 text-xl font-bold text-night-950 hover:bg-sun-300 focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-white"
            >
              See all answers
            </button>
            <p className="text-center text-cloud-50/70 [text-shadow:2px_2px_0_rgb(0_0_0/0.6)]">Look up: the host starts the next prompt.</p>
            <div className="text-center">{connection}</div>
          </>
        }
      />
      <AnswersSheet open={showAnswers} title="Every answer in the bank" onClose={() => setShowAnswers(false)}>
        <p className="mb-4 text-cloud-50/70">
          {snap.question?.prompt.prompt} · {reveal.answered} of {reveal.players} answered
        </p>
        <RevealList reveal={reveal.reveal} mine={answer?.canonical ?? null} counts={reveal.counts} />
      </AnswersSheet>
    </>
  );
}

function Standings({ snap, me }: { snap: LiveSnapshot; me: LiveMe }) {
  const row = snap.leaderboard?.find((r) => r.id === me.id);
  return (
    <div className="space-y-5">
      <Card>
        <p className="text-sm text-cloud-50/60">
          After {snap.roundIndex + 1} of {snap.roundCount} prompts
        </p>
        <p className="mt-1 text-5xl font-bold">{row ? `#${row.rank}` : "–"}</p>
        <p className="mt-1 text-cloud-50/70">
          of {snap.playerCount} · {metersOf(row?.total ?? 0)}
        </p>
      </Card>
      {snap.leaderboard && <Leaderboard rows={snap.leaderboard} limit={5} highlightId={me.id} />}
      {snap.teamBoard && snap.teamBoard.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Teams</h2>
          <TeamBoard rows={snap.teamBoard} />
        </section>
      )}
    </div>
  );
}

function Final({ snap, me }: { snap: LiveSnapshot; me: LiveMe }) {
  const row = snap.leaderboard?.find((r) => r.id === me.id);
  return (
    <div className="space-y-6">
      <h1 className="pixel-panel py-3 text-center font-display text-4xl font-bold">Final results</h1>
      {snap.leaderboard && <Podium rows={snap.leaderboard} rounds={snap.roundCount} />}
      {row && (
        <Card>
          <p className="text-sm text-cloud-50/60">You finished</p>
          <p className="text-5xl font-bold">#{row.rank}</p>
          <p className="mt-1 font-mono text-xl text-sun-300 tabular-nums">{metersOf(row.total)}</p>
          <p className="mt-1 text-cloud-50/70">{liveRatingLabel(row.total, snap.roundCount)}</p>
        </Card>
      )}
      {snap.teamBoard && snap.teamBoard.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Teams</h2>
          <TeamBoard rows={snap.teamBoard} />
        </section>
      )}
      {snap.leaderboard && <Leaderboard rows={snap.leaderboard} limit={10} highlightId={me.id} />}
      <div className="space-y-3">
        <Link
          href="/practice"
          className="block w-full rounded-2xl bg-sun-400 px-6 py-4 text-center text-lg font-bold text-night-950 hover:bg-sun-300 focus-visible:ring-4 focus-visible:ring-white/70 focus-visible:outline-none"
        >
          Keep diving: Practice
        </Link>
      </div>
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <section className="pixel-panel p-6 text-center">{children}</section>;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <SkyPage>
      <main className="mx-auto max-w-xl px-4 pt-4 pb-16">
        <header className="mb-5 text-sm">
          <Link href="/" className="rounded-lg px-1 py-1 text-cloud-50/70 hover:text-cloud-50 focus-visible:outline-2 focus-visible:outline-sun-300">
            ← {APP_NAME}
          </Link>
        </header>
        {children}
      </main>
    </SkyPage>
  );
}
