import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode, type RefObject } from "react";
import { normalizeRoomCode } from "../../lib/game/live";
import type { LiveRevealView, LiveSnapshot } from "../../lib/game/live-types";
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
    <Stage world={{ ...climb.world, notes: snap.phase === "reveal" && snap.view && snap.view !== "climb" ? undefined : notes }}>
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
  if (snap.view === "answers") return <AnswerBoard snap={snap} />;
  if (snap.view === "given") return <GivenBoard snap={snap} />;
  return <ClimbView snap={snap} climb={climb} />;
}

/**
 * Shrinks the type in `ref` (from `start` px down to 11 px) until every item in it is
 * inside the box: a projector can't scroll. Refits once the pixel fonts load and on resize.
 */
function useFitFont(ref: RefObject<HTMLDivElement | null>, start: number, deps: readonly unknown[]) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // scrollWidth isn't reliable for multi-column boxes (it can report a phantom extra
    // column), so check where the items actually landed.
    const fits = (px: number) => {
      el.style.fontSize = `${px}px`;
      const box = el.getBoundingClientRect();
      return ![...el.querySelectorAll("li, h2")].some((item) => {
        const r = item.getBoundingClientRect();
        return r.right > box.right + 1 || r.bottom > box.bottom + 1;
      });
    };
    const fit = () => {
      if (fits(start)) return;
      let lo = 11;
      let hi = start - 1;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (fits(mid)) lo = mid;
        else hi = mid - 1;
      }
      fits(lo);
    };
    fit();
    let live = true;
    void document.fonts?.ready.then(() => live && fit());
    window.addEventListener("resize", fit);
    return () => {
      live = false;
      window.removeEventListener("resize", fit);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, ...deps]);
}

/**
 * The whole answer bank for the prompt, deepest tier first, shown when the host picks
 * "All answers". Answers players gave stand out (×count, who found the deep ones); the
 * rest are dimmed. Hover (or focus) an answer to see its reference in the bar below.
 * The type shrinks until everything fits: a projector can't scroll.
 */
function AnswerBoard({ snap }: { snap: LiveSnapshot }) {
  const r = snap.reveal!;
  const answers = r.reveal.answers;
  const total = answers.length;
  const [hovered, setHovered] = useState<RevealAnswer | null>(null);
  // Starting size by how many answers there are; then shrink until nothing overflows.
  const start = total <= 16 ? 40 : total <= 30 ? 34 : total <= 50 ? 30 : total <= 80 ? 26 : 22;
  const columns = total <= 16 ? 2 : total <= 30 ? 3 : total <= 60 ? 4 : 5;
  const boxRef = useRef<HTMLDivElement>(null);
  useFitFont(boxRef, start, [answers]);
  const given = answers.filter((a) => r.counts[a.canonical]).length;

  return (
    <div className="relative flex h-full min-h-0 flex-col gap-4">
      {/* dim the scene so the answers read well */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-night-950/70" />
      <div className="flex items-baseline justify-between gap-6">
        <h1 className="font-display text-5xl font-bold text-balance">{r.reveal.prompt}</h1>
        <p className="shrink-0 text-2xl text-cloud-50/70">
          {given} of {total} found
        </p>
      </div>
      <div
        ref={boxRef}
        // No transitions in here: the reduced-motion CSS gives everything a tiny transition on
        // every property, which would delay font-size changes and break the fitting above.
        className="min-h-0 flex-1 gap-5 overflow-hidden [&,&_*]:transition-none"
        style={{ columnCount: columns, columnFill: "auto", fontSize: `${start}px`, lineHeight: 1.2 }}
      >
        {DEEPEST_FIRST.map((tier) => {
          const list = answers.filter((a) => a.tier === tier);
          if (list.length === 0) return null;
          return (
            <section key={tier} aria-label={TIER_INFO[tier].label} className="mb-[0.7em]">
              <h2 className="mb-[0.3em] flex items-center gap-2" style={{ fontSize: "0.8em", breakAfter: "avoid-column" }}>
                <TierBadge tier={tier} size="lg" />
                <span className="text-cloud-50/60">{TIER_INFO[tier].points} pts</span>
              </h2>
              <ul className="space-y-[0.25em]">
                {list.map((a) => {
                  const count = r.counts[a.canonical] ?? 0;
                  const finders = r.finders[a.canonical];
                  return (
                    <li
                      key={a.canonical}
                      tabIndex={0}
                      title={a.reference || undefined}
                      onMouseEnter={() => setHovered(a)}
                      onMouseLeave={() => setHovered((h) => (h === a ? null : h))}
                      onFocus={() => setHovered(a)}
                      onBlur={() => setHovered((h) => (h === a ? null : h))}
                      className={`break-inside-avoid rounded-[0.4em] border-2 px-[0.45em] py-[0.15em] outline-none focus-visible:ring-4 focus-visible:ring-sun-300 ${
                        count
                          ? `bg-night-950/85 ${TIER_STYLE[tier].row} hover:bg-white/15`
                          : "border-transparent bg-night-950/40 text-cloud-50/55 hover:bg-white/10 hover:text-cloud-50"
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-[0.5em]">
                        <span className={count ? "font-semibold" : ""}>
                          {a.canonical}
                          {a.aiJudged && <span className="ml-[0.4em] text-sky-200" style={{ fontSize: "0.7em" }}>✨ AI</span>}
                        </span>
                        {count > 0 && <span className="shrink-0 font-mono text-sun-300 tabular-nums">×{count}</span>}
                      </div>
                      {finders && count > 0 && (
                        <p className="text-cloud-50/65" style={{ fontSize: "0.7em" }}>
                          {finders.join(" · ")}
                        </p>
                      )}
                      {a.gemNote && (
                        <p className="text-amber-100/90" style={{ fontSize: "0.7em" }}>
                          💎 {a.gemNote}
                        </p>
                      )}
                      {a.reference && <span className="sr-only">, {a.reference}</span>}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      {/* the hovered answer's reference */}
      <p aria-hidden="true" className="pixel-panel min-h-[3.25rem] px-5 py-2 text-2xl">
        {hovered ? (
          <>
            <span className="font-semibold">{hovered.canonical}</span>
            {hovered.reference && <span className="text-sun-300"> · {hovered.reference}</span>}
          </>
        ) : (
          <span className="text-cloud-50/0">·</span>
        )}
      </p>
    </div>
  );
}

/**
 * The room's climb: the prompt and altimeter up top. When the world stops at a tier somebody
 * reached, that tier's guesses (one box per distinct answer) sit centre stage; while it climbs
 * on, they move aside into a compact stack on the right. At the top it stays, with the top tier
 * centred. Reaching One in a Million sets off one big flash.
 */
function ClimbView({ snap, climb }: { snap: LiveSnapshot; climb: StagedClimb }) {
  const r = snap.reveal!;
  const given = r.reveal.answers.filter((a) => r.counts[a.canonical]);
  const stops = ANSWER_TIERS.filter((t) => given.some((a) => a.tier === t));
  // Tiers the room has arrived at so far (the one being climbed to joins on arrival).
  const arrived = climb.phase === "done" ? stops.length : climb.phase === "holding" ? climb.index + 1 : Math.max(0, climb.index);
  const shown = stops.slice(0, arrived).reverse(); // newest (highest) first
  // Stopped at a tier: it takes the centre. Moving: everything waits at the side.
  const settled = climb.phase === "holding" || climb.phase === "done";
  const centre = settled ? shown[0] : undefined;
  const side = centre ? shown.slice(1) : shown;
  const flash = useGemFlash(climb);
  const props = (tier: AnswerTier) => ({ tier, answers: given.filter((a) => a.tier === tier), counts: r.counts, finders: r.finders });
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="pixel-panel relative z-10 mx-auto max-w-[80%] px-10 py-4 text-center [text-shadow:3px_3px_0_rgb(0_0_0/0.55)]">
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
        <div className="relative min-h-0 flex-1">
          <div role="status" className="absolute inset-y-0 left-1/2 flex w-[54%] -translate-x-1/2 flex-col items-center pt-6">
            {centre && <FloatingTier key={centre} place="centre" {...props(centre)} />}
          </div>
          <div className="absolute top-0 right-0 bottom-12 flex w-[23%] flex-col items-end gap-3 overflow-hidden pt-6">
            {side.map((tier) => (
              <FloatingTier key={tier} place="side" {...props(tier)} />
            ))}
          </div>
        </div>
      )}
      {flash !== null && <GemFlash key={flash} />}
      {climb.phase !== "done" && given.length > 0 && (
        <button
          type="button"
          onClick={climb.skip}
          aria-label="Skip to the top"
          title="Skip to the top"
          className="absolute right-0 bottom-0 z-20 rounded-xl px-3 py-1 text-base text-cloud-50/40 ring-2 ring-white/10 hover:text-cloud-50"
        >
          ⏭
        </button>
      )}
    </div>
  );
}

/**
 * The landing count at which the room arrived at One in a Million while this view was up.
 * Coming back to the climb later (the host switched views) doesn't flash again.
 */
function useGemFlash(climb: StagedClimb): number | null {
  const [flash, setFlash] = useState<number | null>(null);
  const seen = useRef(climb.landing);
  useEffect(() => {
    if (climb.landing === seen.current) return;
    seen.current = climb.landing;
    if (climb.tier === "one_in_a_million") setFlash(climb.landing);
  }, [climb.landing, climb.tier]);
  return flash;
}

/**
 * One bright gold-white flash that fades, a burst of pixel sparks and two rings from the
 * gem answer. It plays once (no strobing). With reduced motion the animations end at once,
 * so nothing flashes: the gem's glow and rays carry it.
 */
function GemFlash() {
  const sparks = 36;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-50">
      <div className="gem-flash absolute inset-0" />
      <div className="absolute top-[42%] left-1/2">
        {Array.from({ length: sparks }, (_, i) => {
          const angle = (i / sparks) * Math.PI * 2;
          const dist = 24 + (i % 4) * 9;
          const size = i % 3 === 0 ? 14 : 9;
          return (
            <span
              key={i}
              className="climb-spark absolute top-0 left-0"
              style={
                {
                  width: size,
                  height: size,
                  background: i % 4 === 0 ? "#fff8ec" : i % 4 === 2 ? "#f0abfc" : "#ffd866",
                  animationDuration: "1100ms",
                  "--dx": `${Math.cos(angle) * dist}vmin`,
                  "--dy": `${Math.sin(angle) * dist}vmin`,
                } as CSSProperties
              }
            />
          );
        })}
        <div className="climb-ring absolute top-0 left-0" style={{ borderColor: "#ffd866" }} />
        <div className="climb-ring absolute top-0 left-0" style={{ borderColor: "#fff8ec", animationDelay: "180ms" }} />
      </div>
    </div>
  );
}

/** Names to show under a guess: a few, then "+N". */
function finderLine(names: readonly string[], max = 3): string {
  return names.length <= max ? names.join(" · ") : `${names.slice(0, max).join(" · ")} +${names.length - max}`;
}

/** Tiers at the side keep this many guesses (most given first), then "+N more". */
const OLDER_TIER_MAX = 6;

/**
 * One tier's guesses. In the centre (the tier the room is stopped at) they're big boxes that
 * get more compact as the tier fills up (a 30-player room can give 15+ different answers in
 * Plankton). One in a Million is the hero, with its note in full, a gold glow and rays.
 * At the side (tiers already passed) they're one line of small chips.
 */
function FloatingTier({
  tier,
  place,
  answers,
  counts,
  finders,
}: {
  tier: AnswerTier;
  place: "centre" | "side";
  answers: readonly RevealAnswer[];
  counts: Record<string, number>;
  finders: Record<string, string[]>;
}) {
  const sorted = [...answers].sort((a, b) => (counts[b.canonical] ?? 0) - (counts[a.canonical] ?? 0) || a.canonical.localeCompare(b.canonical));
  const many = sorted.length > 6;
  const crowd = sorted.length > 12;

  if (place === "side") {
    const kept = sorted.slice(0, OLDER_TIER_MAX);
    const rest = sorted.length - kept.length;
    return (
      <section className="climb-rise flex max-w-full flex-col items-end gap-1.5 opacity-60">
        <TierBadge tier={tier} />
        <ul className="flex flex-wrap justify-end gap-1.5">
          {kept.map((a) => (
            <li key={a.canonical} className={`max-w-full rounded-lg border-2 bg-night-950/90 px-2 py-0.5 text-base ${TIER_STYLE[tier].row}`}>
              <span className="flex items-baseline gap-2">
                <span className="truncate font-semibold">{a.canonical}</span>
                <span className="shrink-0 font-mono text-cloud-50/70 tabular-nums">×{counts[a.canonical]}</span>
              </span>
            </li>
          ))}
          {rest > 0 && <li className="rounded-lg bg-night-950/80 px-2 py-0.5 text-base text-cloud-50/70">+{rest} more</li>}
        </ul>
      </section>
    );
  }

  const gem = tier === "one_in_a_million";
  const text = gem ? "text-6xl" : crowd ? "text-2xl" : many ? "text-3xl" : "text-5xl";
  const box = gem
    ? "max-w-full border-4 border-sun-300 px-8 py-5 shadow-[0_0_56px_rgba(255,216,102,0.55),6px_6px_0_rgba(0,0,0,0.45)]"
    : crowd
      ? "max-w-[22rem] border-2 px-3 py-1 shadow-[4px_4px_0_rgba(0,0,0,0.4)]"
      : many
        ? "max-w-[30rem] border-2 px-4 py-1.5 shadow-[4px_4px_0_rgba(0,0,0,0.4)]"
        : "max-w-full border-2 px-5 py-2.5 shadow-[4px_4px_0_rgba(0,0,0,0.4)]";
  const nameCap = gem ? 6 : many ? 2 : 3;
  return (
    <section className="climb-rise relative flex w-full flex-col items-center gap-3 text-center">
      {gem && <div aria-hidden="true" className="climb-rays pointer-events-none absolute top-1/2 left-1/2 -z-10" />}
      <TierBadge tier={tier} size="lg" />
      <ul className={`flex flex-wrap justify-center ${crowd ? "gap-2" : "gap-3"}`}>
        {sorted.map((a, i) => {
          const names = finders[a.canonical];
          return (
            <li
              key={a.canonical}
              className={`animate-rise rounded-xl bg-night-950/90 ${gem ? "" : TIER_STYLE[tier].row} ${box}`}
              style={{ animationDelay: `${Math.min(i, 12) * 70}ms` }}
            >
              <div className={`flex items-baseline justify-center gap-3 ${text}`}>
                <span className={`font-semibold ${gem ? "text-sun-300" : "truncate"}`}>{a.canonical}</span>
                <span className="shrink-0 font-mono text-cloud-50/70 tabular-nums" style={{ fontSize: "0.6em" }}>
                  ×{counts[a.canonical]}
                </span>
              </div>
              {names && names.length > 0 && !crowd && (
                <p className={`text-cloud-50/75 ${gem ? "text-3xl" : "truncate text-xl"}`}>{finderLine(names, nameCap)}</p>
              )}
              {a.gemNote && <p className={`mt-1 text-amber-100 ${gem ? "text-2xl leading-snug text-balance" : "text-lg"}`}>💎 {a.gemNote}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * "Audience answers": every answer the room gave, deepest tier first, with ×N and the name of
 * everyone who gave it, then who didn't answer. Fitted to the screen like the answer board.
 */
function GivenBoard({ snap }: { snap: LiveSnapshot }) {
  const r = snap.reveal!;
  const byCanonical = new Map(r.reveal.answers.map((a) => [a.canonical, a]));
  // The server sends everyone's names in this view; an older server only has counts and a few names.
  const givers: Record<string, string[]> =
    r.givers ??
    Object.fromEntries(
      Object.entries(r.counts)
        .filter(([, n]) => n > 0)
        .map(([canonical]) => [canonical, r.finders[canonical] ?? []]),
    );
  const rows = Object.entries(givers)
    .map(([canonical, names]) => ({
      canonical,
      names,
      count: r.givers ? names.length : (r.counts[canonical] ?? names.length),
      answer: byCanonical.get(canonical),
    }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || a.canonical.localeCompare(b.canonical));
  const missed = r.missed ?? [];
  const groups: { tier: AnswerTier | null; rows: typeof rows }[] = [
    ...DEEPEST_FIRST.map((tier) => ({ tier: tier as AnswerTier | null, rows: rows.filter((row) => row.answer?.tier === tier) })),
    { tier: null, rows: rows.filter((row) => !row.answer) },
  ].filter((g) => g.rows.length > 0);

  const weight = rows.length + rows.reduce((n, row) => n + row.names.length, 0) / 4 + missed.length / 4;
  const start = weight <= 10 ? 40 : weight <= 20 ? 34 : weight <= 35 ? 30 : 26;
  const columns = weight <= 10 ? 2 : weight <= 24 ? 3 : 4;
  const boxRef = useRef<HTMLDivElement>(null);
  useFitFont(boxRef, start, [givers, missed]);

  return (
    <div className="relative flex h-full min-h-0 flex-col gap-4">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-night-950/70" />
      <div className="flex items-baseline justify-between gap-6">
        <div>
          <p className="text-2xl font-semibold tracking-widest text-sun-300 uppercase">Audience answers</p>
          <h1 className="font-display text-5xl font-bold text-balance">{r.reveal.prompt}</h1>
        </div>
        <p className="shrink-0 text-2xl text-cloud-50/70">
          {r.answered} of {r.players} answered
        </p>
      </div>
      <div
        ref={boxRef}
        // No transitions in here (see AnswerBoard): they'd delay the font-size changes the fitting relies on.
        className="min-h-0 flex-1 gap-5 overflow-hidden [&,&_*]:transition-none"
        style={{ columnCount: columns, columnFill: "auto", fontSize: `${start}px`, lineHeight: 1.2 }}
      >
        {rows.length === 0 && <p className="text-cloud-50/70">Nobody found a right answer this time.</p>}
        {groups.map(({ tier, rows: list }) => (
          <section key={tier ?? "other"} aria-label={tier ? TIER_INFO[tier].label : "Other answers"} className="mb-[0.7em]">
            {tier && (
              <h2 className="mb-[0.3em] flex items-center gap-2" style={{ fontSize: "0.8em", breakAfter: "avoid-column" }}>
                <TierBadge tier={tier} size="lg" />
                <span className="text-cloud-50/60">{TIER_INFO[tier].points} pts</span>
              </h2>
            )}
            <ul className="space-y-[0.25em]">
              {list.map((row) => (
                <li
                  key={row.canonical}
                  className={`break-inside-avoid rounded-[0.4em] border-2 bg-night-950/85 px-[0.45em] py-[0.15em] ${tier ? TIER_STYLE[tier].row : "border-white/20"}`}
                >
                  <div className="flex items-baseline justify-between gap-[0.5em]">
                    <span className="font-semibold">
                      {row.canonical}
                      {row.answer?.aiJudged && (
                        <span className="ml-[0.4em] text-sky-200" style={{ fontSize: "0.7em" }}>
                          ✨ AI
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 font-mono text-sun-300 tabular-nums">×{row.count}</span>
                  </div>
                  {row.names.length > 0 && (
                    <p className="text-cloud-50/75" style={{ fontSize: "0.7em" }}>
                      {row.names.join(" · ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {missed.length > 0 && (
          <ul className="break-inside-avoid">
            <li className="text-cloud-50/60" style={{ fontSize: "0.7em" }}>
              <span className="font-semibold text-cloud-50/80">No answer:</span> {missed.join(" · ")}
            </li>
          </ul>
        )}
      </div>
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
  // Answers nobody gave (dimmed on the "All answers" board), to preview a dense board.
  ...(
    [
      ["Yellow", "plankton"], ["Purple", "plankton"], ["Orange", "plankton"], ["Pink", "plankton"], ["Black", "plankton"], ["White", "plankton"],
      ["Navy", "too_clever"], ["Beige", "too_clever"], ["Lavender", "too_clever"], ["Turquoise", "too_clever"],
      ["Magenta", "schooler"], ["Indigo", "schooler"], ["Khaki", "schooler"], ["Coral", "schooler"], ["Crimson", "schooler"], ["Amber", "schooler"], ["Lime", "schooler"],
      ["Chartreuse", "rare"], ["Ochre", "rare"], ["Periwinkle", "rare"], ["Mauve", "rare"], ["Sienna", "rare"], ["Umber", "rare"], ["Taupe", "rare"],
      ["Celadon", "deep_cut"], ["Gamboge", "deep_cut"], ["Smaragdine", "deep_cut"], ["Falu", "deep_cut"], ["Glaucous", "deep_cut"], ["Xanadu", "deep_cut"],
      ["Coquelicot", "deep_cut"], ["Wenge", "deep_cut"], ["Zaffre", "deep_cut"], ["Caput mortuum", "deep_cut"], ["Isabelline", "deep_cut"], ["Eburnean", "deep_cut"],
    ] as const
  ).map(([canonical, tier]) => ({ canonical, tier: tier as AnswerTier, count: 0 })),
];

/** Made-up player names for the preview (not Bible names, so nothing here matches the bank). */
const DEMO_PLAYER_NAMES = [
  "Sam", "Alex", "Jo", "Kai", "Mia", "Leo", "Ava", "Max", "Zoe", "Ben", "Ivy", "Finn", "Nora", "Theo",
  "Luca", "Ella", "Owen", "Ruby", "Milo", "Iris", "Wren", "Cole", "Tess", "Reid", "Skye", "Hugo", "Quinn",
];

/** A 27-player room: many different answers per tier, popular ones ×N (made-up colours, never bank answers). */
const CROWD_NAMES = ["Sam", "Alex", "Jo", "Kai", "Mia", "Leo", "Ava", "Max", "Zoe", "Ben"];
const CROWD_DEMO_ANSWERS: typeof DEMO_ANSWERS = [
  ...(
    [
      ["Red", 5], ["Blue", 4], ["Green", 3], ["Yellow", 2], ["Purple", 2], ["Orange", 2], ["Pink", 1], ["Black", 1], ["White", 1],
      ["Brown", 1], ["Grey", 1], ["Gold", 1], ["Silver", 1], ["Cyan", 1], ["Tan", 1],
    ] as const
  ).map(([canonical, count]) => ({ canonical, tier: "plankton" as AnswerTier, count })),
  ...(["Navy", "Beige", "Lavender"] as const).map((canonical, i) => ({ canonical, tier: "too_clever" as AnswerTier, count: 3 - i })),
  ...(
    [["Magenta", 3], ["Indigo", 2], ["Khaki", 2], ["Coral", 1], ["Crimson", 1], ["Amber", 1], ["Lime", 1], ["Scarlet", 1]] as const
  ).map(([canonical, count]) => ({ canonical, tier: "schooler" as AnswerTier, count })),
  ...(["Chartreuse", "Ochre", "Periwinkle", "Mauve", "Sienna"] as const).map((canonical, i) => ({
    canonical,
    tier: "rare" as AnswerTier,
    count: i === 0 ? 2 : 1,
    finders: CROWD_NAMES.slice(i, i + (i === 0 ? 2 : 1)),
  })),
  ...(["Celadon", "Gamboge", "Smaragdine"] as const).map((canonical, i) => ({
    canonical,
    tier: "deep_cut" as AnswerTier,
    count: 1,
    finders: [CROWD_NAMES[5 + i]!],
  })),
  { canonical: "Fulvous", tier: "one_in_a_million", count: 1, finders: ["Ben"], gemNote: "Sample gem note: a dull brownish-yellow, shown here to preview how gem notes look." },
];

/**
 * /dev/climb?room=1 (dev only): the projector's staged room climb with made-up answers.
 * ?room=none: nobody scored. ?room=crowd: a 27-player room with many answers per tier.
 */
export function ProjectorRevealDemo({ nobody = false, initialView = "climb" }: { nobody?: boolean; initialView?: LiveRevealView }) {
  const [run, setRun] = useState(0);
  const [view, setView] = useState<LiveRevealView>(initialView);
  const crowd = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("room") === "crowd";
  const answers = nobody ? [] : crowd ? CROWD_DEMO_ANSWERS : DEMO_ANSWERS;
  const players = crowd ? 27 : 24;
  const snap = {
    code: "DEMO",
    phase: "reveal",
    view,
    roundIndex: run,
    roundCount: 12,
    playerCount: players,
    reveal: {
      reveal: {
        promptId: "demo",
        prompt: "Sample prompt: name a colour",
        answers: [...answers].reverse().map((a, i) => ({ canonical: a.canonical, tier: a.tier, points: TIER_INFO[a.tier].points, reference: `Sample ${i + 1}:1`, gemNote: a.gemNote })),
      },
      counts: Object.fromEntries(answers.filter((a) => a.count).map((a) => [a.canonical, a.count])),
      finders: Object.fromEntries(answers.filter((a) => a.finders).map((a) => [a.canonical, a.finders!])),
      answered: nobody ? 5 : players - 2,
      players,
      // Everyone's names, as the server sends them for the "given" view (made-up names).
      ...(() => {
        let n = 0;
        const next = () => DEMO_PLAYER_NAMES[n++ % DEMO_PLAYER_NAMES.length]!;
        const givers = Object.fromEntries(answers.filter((a) => a.count).map((a) => [a.canonical, Array.from({ length: a.count }, next)]));
        return { givers, missed: [next(), next()] };
      })(),
    },
  } as unknown as LiveSnapshot;
  const r = snap.reveal!;
  const reached: Partial<Record<AnswerTier, number>> = {};
  for (const a of answers) reached[a.tier] = (reached[a.tier] ?? 0) + a.count;
  const climb = useStagedClimb({ stops: ANSWER_TIERS.filter((t) => reached[t]), active: true, roundKey: run, holdMs: () => 2000 });
  const notes = Object.fromEntries(Object.entries(reached).map(([t, n]) => [t, `${n} ${n === 1 ? "climber" : "climbers"}`]));
  return (
    <Stage world={{ ...climb.world, notes: snap.phase === "reveal" && snap.view === "answers" ? undefined : notes }}>
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between text-2xl text-cloud-50/70">
          <span className="font-display font-bold text-sun-300">{APP_NAME}</span>
          <span className="flex gap-2">
            <button type="button" className="rounded-xl px-3 py-1 text-base ring-2 ring-white/20" onClick={() => setView(view === "climb" ? "answers" : view === "answers" ? "given" : "climb")}>
              {view === "climb" ? "All answers" : view === "answers" ? "Audience answers" : "Climb"}
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
