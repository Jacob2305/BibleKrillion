import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { normalizeRoomCode } from "../../lib/game/live";
import type { RevealAnswer } from "../../lib/game/api-types";
import type { LiveMe, LiveSnapshot } from "../../lib/game/live-types";
import { APP_NAME } from "../../lib/game/brand";
import { TIER_INFO } from "../../lib/game/scoring";
import { RevealHud, World } from "../game/climb/Climb";
import { roomStops, useFollowClimb, type FollowClimb } from "../game/climb/staged";
import { SkyPage } from "../game/Sky";
import { BigButton } from "../game/DivePlayer";
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

/** The "+ New team" choice in the team picker. */
const NEW_TEAM = "__new_team__";

function JoinForm({ notice, onJoined }: { notice: string | null; onJoined: (code: string, data: Awaited<ReturnType<typeof liveApi.join>>) => void }) {
  const [code, setCode] = useState(() => codeFromUrl() ?? "");
  const [name, setName] = useState(getNickname);
  const [team, setTeam] = useState("");
  /** Team rooms: join one of these, or type a new one. */
  const [teamChoice, setTeamChoice] = useState<string>(NEW_TEAM);
  const [room, setRoom] = useState<{ code: string; teams: boolean; teamNames: string[] } | null>(null);
  const [teamError, setTeamError] = useState<string | null>(null);
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
        const teamNames = res.snapshot.teamNames ?? [];
        setRoom({ code: normalized, teams: res.snapshot.teams, teamNames });
        if (teamNames.length > 0) setTeamChoice((c) => (c === NEW_TEAM || teamNames.includes(c) ? c : NEW_TEAM));
        setCodeError(res.snapshot.phase === "final" ? "That game has finished." : null);
      })
      .catch((err: unknown) => live && setCodeError(err instanceof ApiError ? err.message : "Couldn't find that room."));
    return () => {
      live = false;
    };
  }, [normalized, room?.code]);

  // New teams appear for everyone still on this form (a light poll while it's open).
  const teamRoom = room?.teams ? room.code : null;
  useEffect(() => {
    if (!teamRoom) return;
    let live = true;
    const timer = window.setInterval(() => {
      liveApi
        .stateByCode(teamRoom)
        .then((res) => {
          if (!live) return;
          const teamNames = res.snapshot.teamNames ?? [];
          setRoom((r) => (r && r.code === teamRoom ? { ...r, teams: res.snapshot.teams, teamNames } : r));
        })
        .catch(() => {}); // a missed refresh is fine; the next one tries again
    }, 3000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [teamRoom]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!normalized) return setCodeError("Room codes are 4 letters. Check the big screen.");
    const nickname = name.replace(/\s+/g, " ").trim();
    const chosenTeam = room?.teams ? (teamChoice === NEW_TEAM ? team.replace(/\s+/g, " ").trim() : teamChoice) : "";
    if (room?.teams && !chosenTeam) return setTeamError("Name your team, or pick one above.");
    if (!nickname) return setNameError("Pick a name.");
    setBusy(true);
    try {
      const res = await liveApi.join(normalized, nickname, chosenTeam || undefined);
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
          {codeError}
        </p>
      </div>

      {room?.teams && (
        <fieldset className="space-y-2">
          <legend className="block font-medium">Your team</legend>
          {room.teamNames.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {room.teamNames.map((t) => (
                <label
                  key={t}
                  className={`cursor-pointer rounded-xl px-3 py-2 ring-2 has-[:focus-visible]:ring-sun-300 ${teamChoice === t ? "bg-sun-400 font-semibold text-night-950 ring-sun-300" : "bg-white/10 ring-white/15"}`}
                >
                  <input
                    type="radio"
                    name="live-team-choice"
                    value={t}
                    checked={teamChoice === t}
                    onChange={() => {
                      setTeamChoice(t);
                      setTeamError(null);
                    }}
                    className="sr-only"
                  />
                  {t}
                </label>
              ))}
              <label
                className={`cursor-pointer rounded-xl px-3 py-2 ring-2 has-[:focus-visible]:ring-sun-300 ${teamChoice === NEW_TEAM ? "bg-sun-400 font-semibold text-night-950 ring-sun-300" : "bg-white/10 ring-white/15"}`}
              >
                <input
                  type="radio"
                  name="live-team-choice"
                  value={NEW_TEAM}
                  checked={teamChoice === NEW_TEAM}
                  onChange={() => setTeamChoice(NEW_TEAM)}
                  className="sr-only"
                />
                + New team
              </label>
            </div>
          )}
          {teamChoice === NEW_TEAM && (
            <input
              id="live-team"
              aria-label="New team name"
              value={team}
              onChange={(e) => {
                setTeam(e.target.value);
                setTeamError(null);
              }}
              maxLength={24}
              autoCapitalize="words"
              aria-invalid={teamError ? true : undefined}
              placeholder="Team name"
              className={input}
            />
          )}
          {teamError && (
            <p role="alert" className="text-sm text-amber-200">
              {teamError}
            </p>
          )}
        </fieldset>
      )}

      <div className="space-y-2">
        <label htmlFor="live-nickname" className="block font-medium">
          Your name
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
          {nameError}
        </p>
      </div>


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
  // Team average, also kept between boards. The board's row has the latest team (the host may move players).
  const myTeam = myRow?.team ?? me?.team ?? null;
  const lastTeamAverage = useRef<number | null>(null);
  const teamRow = myTeam ? snap?.teamBoard?.find((t) => t.team.toLowerCase() === myTeam.toLowerCase()) : undefined;
  if (teamRow) lastTeamAverage.current = teamRow.average;
  else if (!myTeam) lastTeamAverage.current = null;
  // Places for the small line at the bottom, also kept between boards.
  const lastPlace = useRef<{ rank: number; of: number } | null>(null);
  if (myRow && snap?.leaderboard) lastPlace.current = { rank: myRow.rank, of: snap.leaderboard.length };
  const lastTeamPlace = useRef<{ rank: number; of: number } | null>(null);
  if (teamRow && snap?.teamBoard) lastTeamPlace.current = { rank: teamRow.rank, of: snap.teamBoard.length };
  else if (!myTeam) lastTeamPlace.current = null;

  const kicked = removed || !!me?.kicked || (!!me && !!snap?.removed.includes(me.id));
  // This prompt's locked answer: from this session, or remembered by the server after a refresh.
  const lockedNow = snap && me ? ([locked, me.current].find((l) => l && snap.question && l.index === snap.question.index) ?? null) : null;
  // The reveal stays on the phone when the host shows the leaderboard on the big screen
  // (that snapshot carries no reveal), so remember the last one for this prompt.
  const lastReveal = useRef<{ snap: LiveSnapshot; answer: RevealAnswer | undefined } | null>(null);
  if (snap?.phase === "reveal" && snap.reveal && me) {
    const mine = [locked, me.current].find((l) => l && snap.question && l.index === snap.question.index) ?? null;
    lastReveal.current = { snap, answer: mine ? snap.reveal.reveal.answers.find((a) => a.canonical === mine.canonical) : undefined };
  } else if (snap && snap.phase !== "leaderboard") {
    lastReveal.current = null;
  }
  const shown = snap && lastReveal.current && lastReveal.current.snap.roundIndex === snap.roundIndex ? lastReveal.current : null;
  const revealing = !!shown && !!me && !kicked;
  const myAnswer = shown?.answer;
  // Rise with the room (the same stops as the big screen), then glide to this player's own tier.
  const { stops, holdMs } = roomStops(shown?.snap.reveal);
  const climb = useFollowClimb({
    stops,
    holdMs,
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
  } else if (shown) {
    body = <MyReveal snap={shown.snap} answer={myAnswer} climb={climb} />;
  } else if (snap.phase === "reveal" || snap.phase === "leaderboard") {
    // Rejoined after the reveal: nothing to replay; the place line at the bottom has the standings.
    body = null;
  } else {
    body = <Final snap={snap} me={me} />;
  }

  return (
    <div className="relative min-h-dvh">
      <World
        {...climb.world}
        explore={!kicked && (snap.phase === "lobby" || (revealing && climb.phase === "landed"))}
        backClass="bottom-10"
      />
      <main className="relative z-10 mx-auto max-w-xl px-4 pt-4 pb-16">
        <header className="pixel-panel mb-5 px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="font-logo tracking-widest text-cloud-50/60">{snap.code}</span>
            <span className="min-w-0 truncate font-medium">{me.nickname}</span>
            <span className="flex items-center gap-2">
              <span className="font-mono text-sun-300 tabular-nums">
                <span className="sr-only">Your score: </span>
                {metersOf(total)}
              </span>
              <MuteButton />
            </span>
          </div>
          {snap.teams && myTeam && (
            <div className="mt-1 flex items-center justify-between gap-3 border-t border-white/10 pt-1 text-cloud-50/70">
              <span className="min-w-0 truncate">Team {myTeam}</span>
              <span className="font-mono text-sun-300 tabular-nums">{metersOf(lastTeamAverage.current ?? 0)} avg</span>
            </div>
          )}
        </header>
        {snap.closed && snap.phase !== "final" && !kicked && (
          <p className="mb-4 rounded-xl bg-night-950/85 px-3 py-2 text-cloud-50/80">The host has ended this room. Thanks for diving!</p>
        )}
        {body}
      </main>
      {!kicked && snap.phase !== "lobby" && (lastPlace.current || (snap.teams && myTeam && lastTeamPlace.current)) && (
        <p className="fixed inset-x-0 bottom-0 z-40 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-center text-xs text-cloud-50/70 [text-shadow:1px_1px_0_rgb(0_0_0/0.7)]">
          {lastPlace.current && (
            <span>
              #{lastPlace.current.rank} of {lastPlace.current.of}
            </span>
          )}
          {snap.teams && myTeam && lastTeamPlace.current && (
            <span>
              {lastPlace.current && " · "}Team {myTeam} #{lastTeamPlace.current.rank} of {lastTeamPlace.current.of}
            </span>
          )}
        </p>
      )}
      <div className="fixed inset-x-0 bottom-6 z-40 text-center">
        <ConnectionNote connection={room.connection} error={room.error} />
      </div>
    </div>
  );
}

function Lobby({ me, snap }: { me: LiveMe; snap: LiveSnapshot }) {
  // The lobby list is fresher than `me` if the host just moved this player.
  const team = snap.players?.find((p) => p.id === me.id)?.team ?? me.team;
  return (
    <Card>
      <p className="animate-bob text-5xl" aria-hidden="true">
        🤿
      </p>
      <p className="mt-3 text-3xl font-bold">You're in, {me.nickname}!</p>
      {team && <p className="mt-1 text-cloud-50/70">Team {team}</p>}
      {snap.teams && snap.teamNames && snap.teamNames.length > 0 && (
        <p className="mt-3 text-sm text-cloud-50/60">Teams: {snap.teamNames.join(" · ")}</p>
      )}
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
  // A "Did you mean …?" is only accepted when the player says yes; the buzzer never accepts it for them.

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
          <span className="text-cloud-50/80">⏱ Time's up!</span>
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
    </Card>
  );
}

/** The reveal stays where the climb landed. Kept minimal: the big screen shows the answers. */
function MyReveal({ snap, answer, climb }: { snap: LiveSnapshot; answer: RevealAnswer | undefined; climb: FollowClimb }) {
  if (climb.following) {
    // Rising with the room: just the prompt and the altimeter, so eyes go to the big screen.
    const tier = climb.room.tier;
    return (
      <div className="pointer-events-none fixed inset-x-0 top-24 z-20 px-4 text-center">
        <div className="pixel-panel mx-auto w-fit max-w-md px-5 py-3">
          <p className="text-sm text-cloud-50/80">{snap.question?.prompt.prompt}</p>
          <p className="mt-1 font-mono text-3xl text-sun-300 tabular-nums" aria-hidden="true">
            ▲ <span ref={climb.room.meterRef}>0 m</span>
          </p>
          <p className="sr-only" role="status">
            {tier ? `${TIER_INFO[tier].label} reached` : "Rising"}
          </p>
        </div>
      </div>
    );
  }
  return (
    <RevealHud
      climb={climb}
      hideClimber
      topClass="pt-24"
      kicker={answer ? "Your answer" : snap.question?.prompt.prompt}
      headline={answer ? answer.canonical : "No answer this time"}
      details={
        (answer?.gemNote || answer?.aiJudged) && (
          <>
            {answer?.gemNote && <p className="text-amber-100">💎 {answer.gemNote}</p>}
            {answer?.aiJudged && <p className="text-sky-200">✨ Accepted by the AI judge: {answer.reference}</p>}
          </>
        )
      }
    />
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
