import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { METERS_PER_POINT } from "../../lib/game/scoring";
import type { DiveApi } from "../lib/api";
import { Link } from "../lib/router";
import { useCountdown } from "../lib/useCountdown";
import { useSlow } from "../lib/useSlow";
import { APP_NAME } from "../../lib/game/brand";
import { AltitudeGauge, formatMeters, useAnimatedNumber } from "./Altitude";
import { AnswersSheet, RevealHud, World, useRevealClimb, type RevealClimb } from "./climb/Climb";
import { Dove } from "./pixel";
import { MuteButton } from "./MuteButton";
import { playSfx } from "../lib/sound";
import { RevealList } from "./RevealList";
import { TimerBar } from "./TimerBar";
import { SuggestionLine, suggestionShowing } from "./Suggestion";
import { useDive, type ActiveRound, type Feedback, type RoundResult, type Suggestion } from "./useDive";

interface Props {
  api: DiveApi;
  /** Shown in the header, e.g. "Practice". */
  modeLabel: string;
  /** Shown before the dive starts (ignored with autoStart). */
  intro?: ReactNode;
  /** Start immediately on mount instead of showing the intro. */
  autoStart?: boolean;
  /** The finished screen. */
  renderFinished: (ctx: { results: RoundResult[]; diveToken: string | null; restart: () => void }) => ReactNode;
}

export function DivePlayer({ api, modeLabel, intro, autoStart, renderFinished }: Props) {
  const dive = useDive(api);
  const { phase, results, count, totalPoints } = dive;
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStart && !autoStarted.current) {
      autoStarted.current = true;
      void dive.start();
    }
  }, [autoStart, dive]);
  const depth = useAnimatedNumber(totalPoints * METERS_PER_POINT);

  const index =
    phase.name === "playing" || phase.name === "timeup"
      ? phase.round.index
      : phase.name === "reveal" || phase.name === "loading"
        ? phase.index
        : null;

  // The world rests at sea level and climbs to each answer's tier at the reveal, then glides back down.
  const climb = useRevealClimb({
    tier: phase.name === "reveal" ? phase.result.tier : "miss",
    active: phase.name === "reveal",
    roundKey: phase.name === "reveal" ? phase.index : -1,
  });

  return (
    <div className="relative min-h-dvh">
      <World
        {...climb.world}
        explore={phase.name === "idle" || (phase.name === "reveal" && climb.phase === "landed")}
        backClass={phase.name === "reveal" ? "bottom-44" : "bottom-6"}
      />
      <div className="relative z-10 mx-auto flex max-w-xl gap-2 px-4">
        <main className="min-w-0 flex-1 pt-4 pb-28">
          <header className="pixel-panel mb-5 flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <Link href="/" className="rounded-lg px-1 py-1 text-cloud-50/70 hover:text-cloud-50 focus-visible:outline-2 focus-visible:outline-sun-300">
              ← {APP_NAME}
            </Link>
            <span className="text-cloud-50/60">
              {modeLabel}
              {index !== null && count > 0 && ` · ${index + 1} of ${count}`}
            </span>
            <span className="flex items-center gap-2">
              <span className="font-mono tabular-nums text-sun-300" aria-label={`Altitude ${formatMeters(totalPoints * METERS_PER_POINT)}`}>
                {formatMeters(depth)}
              </span>
              <MuteButton />
            </span>
          </header>

          {phase.name === "idle" && (
            <div className="pixel-panel space-y-6 p-5">
              {intro}
              <p className="text-sm text-cloud-50/60">↕ Scroll or drag the background to look around the map.</p>
              <BigButton onClick={() => void dive.start()} autoFocus>
                Start ascent
              </BigButton>
            </div>
          )}

          {(phase.name === "starting" || phase.name === "loading") && <Ascending />}

          {(phase.name === "playing" || phase.name === "timeup") && (
            <PlayingView
              key={phase.round.promptToken}
              round={phase.round}
              timeUp={phase.name === "timeup"}
              feedback={dive.feedback}
              suggestion={dive.suggestion}
              submitting={dive.submitting}
              onSubmit={(text) => void dive.submit(text)}
              onDraft={dive.noteDraft}
              onExpire={dive.timeUp}
            />
          )}

          {phase.name === "reveal" && (
            <RevealView result={phase.result} isLast={phase.index + 1 >= count} onNext={dive.next} climb={climb} />
          )}

          {phase.name === "finished" &&
            renderFinished({ results, diveToken: dive.diveToken, restart: () => void dive.start() })}

          {phase.name === "error" && (
            <div role="alert" className="space-y-4 rounded-2xl bg-rose-950/50 p-5 ring-2 ring-rose-400/40">
              <p className="font-medium text-rose-100">{phase.message}</p>
              <BigButton onClick={phase.retry}>Try again</BigButton>
            </div>
          )}
        </main>

        <aside className="sticky top-0 h-dvh py-4">
          <AltitudeGauge points={totalPoints} />
        </aside>
      </div>
    </div>
  );
}

function PlayingView({
  round,
  timeUp,
  feedback,
  suggestion,
  submitting,
  onSubmit,
  onDraft,
  onExpire,
}: {
  round: ActiveRound;
  timeUp: boolean;
  feedback: Feedback | null;
  suggestion: Suggestion | null;
  submitting: boolean;
  onSubmit: (text: string) => void;
  onDraft: (text: string) => void;
  onExpire: () => void;
}) {
  const remaining = useCountdown(round.deadline, onExpire);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    playSfx({ name: "start" });
  }, []);
  // After a rejection, select the text so the next guess simply replaces it.
  useEffect(() => {
    if (feedback && feedback.kind !== "error") inputRef.current?.select();
  }, [feedback]);

  const locked = timeUp || remaining === 0;
  const slow = useSlow(submitting);

  return (
    <div className="pixel-panel space-y-5 p-5">
      <div>
        <p className="mb-2 text-xs font-semibold tracking-widest text-sun-300/80 uppercase">{round.prompt.category}</p>
        <h1 className="font-display text-3xl leading-tight font-bold text-balance">{round.prompt.prompt}</h1>
      </div>

      <TimerBar remainingMs={remaining} totalSeconds={round.seconds} />

      <SuggestionLine suggestion={suggestion} text={text} id="answer-suggestion" />

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!locked) onSubmit(text);
        }}
      >
        <label htmlFor="answer" className="sr-only">
          Your answer
        </label>
        <input
          id="answer"
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onDraft(e.target.value);
          }}
          disabled={locked}
          maxLength={80}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="words"
          spellCheck={false}
          enterKeyHint="go"
          placeholder="Type an answer…"
          aria-describedby="answer-suggestion answer-feedback"
          className="min-w-0 flex-1 rounded-2xl border-0 bg-white/95 px-4 py-3.5 text-lg text-night-950 shadow-inner placeholder:text-slate-400 focus:ring-4 focus:ring-sun-300/60 focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={locked || submitting}
          className="pixel-button bg-sun-400 px-5 text-lg font-bold text-night-950 transition-colors hover:bg-sun-300 focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-white disabled:opacity-50"
        >
          {suggestionShowing(suggestion, text) ? "Yes" : "Rise"}
        </button>
      </form>

      <p id="answer-feedback" aria-live="polite" className="min-h-6 text-base">
        {timeUp || locked ? (
          <span className="text-cloud-50/80">⏱ Time's up! Gathering the answers…</span>
        ) : submitting ? (
          <span className="text-cloud-50/70">{slow ? "Asking the judge…" : "Checking…"}</span>
        ) : feedback ? (
          <span key={feedback.nonce} className={`inline-block animate-shake ${feedback.kind === "error" ? "text-rose-300" : "text-amber-200"}`}>
            {feedback.message}
          </span>
        ) : (
          <span className="text-cloud-50/50">Rarer right answers rise higher. Close spellings are fine.</span>
        )}
      </p>
    </div>
  );
}

/** The reveal stays where the climb landed: the answer, its tier, and two choices. */
function RevealView({ result, isLast, onNext, climb }: { result: RoundResult; isLast: boolean; onNext: () => void; climb: RevealClimb }) {
  const nextRef = useRef<HTMLButtonElement>(null);
  const [showAnswers, setShowAnswers] = useState(false);
  const landed = climb.phase === "landed";
  useEffect(() => {
    if (landed && !showAnswers) nextRef.current?.focus({ preventScroll: true });
  }, [landed, showAnswers]);
  const answer = result.answer;
  const typedDiffers = answer && result.typed && result.typed.toLowerCase() !== answer.canonical.toLowerCase();
  return (
    <>
      <RevealHud
        climb={climb}
        kicker={answer ? "Your answer" : result.prompt.prompt}
        headline={answer ? answer.canonical : "Time's up"}
        details={
          <>
            {typedDiffers && <p className="text-cloud-50/80">You typed “{result.typed}”</p>}
            {answer?.gemNote && <p className="text-amber-100">💎 {answer.gemNote}</p>}
            {answer?.aiJudged && <p className="text-sky-200">✨ Not in our list, but the AI judge accepted it: {answer.reference}</p>}
          </>
        }
        actions={
          <>
            <BigButton ref={nextRef} onClick={onNext}>
              {isLast ? "See my ascent" : "Next prompt →"}
            </BigButton>
            <button
              type="button"
              onClick={() => setShowAnswers(true)}
              className="pixel-button w-full bg-night-800 px-6 py-3 text-lg font-bold text-cloud-50 hover:bg-night-700 focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-white"
            >
              See possible answers
            </button>
          </>
        }
      />
      <AnswersSheet open={showAnswers} title="Every answer in the bank" onClose={() => setShowAnswers(false)}>
        <p className="mb-4 text-cloud-50/70">{result.prompt.prompt}</p>
        {result.reveal && <RevealList reveal={result.reveal} mine={answer?.canonical ?? null} />}
      </AnswersSheet>
    </>
  );
}

function Ascending() {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-cloud-50/70" role="status">
      <Dove className="w-16 animate-bob" />
      Ascending…
    </div>
  );
}

export function BigButton({
  children,
  onClick,
  autoFocus,
  ref,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  autoFocus?: boolean;
  ref?: Ref<HTMLButtonElement>;
  type?: "button" | "submit";
}) {
  return (
    <button
      ref={ref}
      type={type}
      onClick={onClick}
      autoFocus={autoFocus}
      className="pixel-button w-full bg-sun-400 px-6 py-4 text-xl font-bold tracking-wide text-night-950 transition-colors hover:bg-sun-300 focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-white"
    >
      {children}
    </button>
  );
}
