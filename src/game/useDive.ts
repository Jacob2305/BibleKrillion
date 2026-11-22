/**
 * Client state machine for one dive (7 prompts). Mode-agnostic: Practice and
 * Daily pass their own DiveApi. All matching happens on the server; the client
 * only ever learns a prompt's answers after the player locks in or time runs out.
 */
import { useCallback, useRef, useState } from "react";
import type { PromptReveal, PublicPrompt, RevealAnswer } from "../../lib/game/api-types";
import { pointsForTier, type ResultTier } from "../../lib/game/scoring";
import { ApiError, type DiveApi } from "../lib/api";
import { playSfx } from "../lib/sound";

export interface RoundResult {
  prompt: PublicPrompt;
  tier: ResultTier;
  points: number;
  /** The bank answer the player locked in, or null on a miss. */
  answer: RevealAnswer | null;
  /** What the player actually typed for the accepted answer. */
  typed: string | null;
  /** Full answer list; absent for rounds restored after a refresh. */
  reveal?: PromptReveal;
}

export interface ActiveRound {
  index: number;
  prompt: PublicPrompt;
  promptToken: string;
  /** Local epoch ms when time runs out (server deadline corrected for clock offset). */
  deadline: number;
  seconds: number;
}

export type Feedback = { kind: "rejected" | "ambiguous" | "empty" | "error"; message: string; nonce: number };

/** "Did you mean …?": the server corrected the spelling of `text` to `canonical`. */
export interface Suggestion {
  text: string;
  canonical: string;
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export type DivePhase =
  | { name: "idle" }
  | { name: "starting" }
  | { name: "loading"; index: number }
  | { name: "playing"; round: ActiveRound }
  | { name: "timeup"; round: ActiveRound }
  | { name: "reveal"; result: RoundResult; index: number }
  | { name: "finished" }
  | { name: "error"; message: string; retry: () => void };

export function useDive(api: DiveApi) {
  const [phase, setPhase] = useState<DivePhase>({ name: "idle" });
  const [results, setResults] = useState<RoundResult[]>([]);
  const [count, setCount] = useState(0);
  const [diveToken, setDiveToken] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const suggestionRef = useRef<Suggestion | null>(null);
  suggestionRef.current = suggestion;
  /** What's in the answer box right now (to auto-confirm a suggestion at the buzzer). */
  const draftRef = useRef("");

  const diveRef = useRef<string | null>(null);
  /** Identifies the live round so late responses from an old round are ignored. */
  const roundRef = useRef<ActiveRound | null>(null);
  const submittingRef = useRef(false);
  const expiredWhileSubmittingRef = useRef(false);
  const nonceRef = useRef(0);

  const showFeedback = (kind: Feedback["kind"], message: string) => setFeedback({ kind, message, nonce: ++nonceRef.current });

  const finishRound = useCallback((round: ActiveRound, result: Omit<RoundResult, "prompt" | "points">) => {
    if (roundRef.current !== round) return;
    roundRef.current = null;
    const full: RoundResult = { ...result, prompt: round.prompt, points: pointsForTier(result.tier) };
    setResults((prev) => [...prev, full]);
    setFeedback(null);
    setSuggestion(null);
    setPhase({ name: "reveal", result: full, index: round.index });
  }, []);

  const loadPrompt = useCallback(
    async (index: number) => {
      const dive = diveRef.current;
      if (!dive) return;
      setPhase({ name: "loading", index });
      setFeedback(null);
      setSuggestion(null);
      draftRef.current = "";
      try {
        const res = await api.begin(dive, index);
        const offset = res.serverNow - Date.now();
        const round: ActiveRound = {
          index,
          prompt: res.prompt,
          promptToken: res.promptToken,
          deadline: res.deadline - offset,
          seconds: res.seconds,
        };
        roundRef.current = round;
        setPhase({ name: "playing", round });
      } catch (err) {
        // Out of sync with the server (e.g. played in another tab): re-sync via start.
        const retry = err instanceof ApiError && err.code === "out_of_sync" ? () => void startRef.current() : () => void loadPrompt(index);
        setPhase({ name: "error", message: errorMessage(err), retry });
      }
    },
    [api],
  );
  const startRef = useRef<() => Promise<void>>(async () => {});

  const start = useCallback(async () => {
    setPhase({ name: "starting" });
    setResults([]);
    setFeedback(null);
    roundRef.current = null;
    try {
      const res = await api.start();
      diveRef.current = res.dive;
      setDiveToken(res.dive);
      setCount(res.count);
      // Resume: rounds already played on this device (Daily Dive after a refresh).
      const done: RoundResult[] = (res.completed ?? []).map((c) => ({
        prompt: c.prompt,
        tier: c.tier,
        points: pointsForTier(c.tier),
        answer: c.answer,
        typed: null,
      }));
      setResults(done);
      if (res.finished || done.length >= res.count) setPhase({ name: "finished" });
      else await loadPrompt(done.length);
    } catch (err) {
      setPhase({ name: "error", message: errorMessage(err), retry: () => void start() });
    }
  }, [api, loadPrompt]);
  startRef.current = start;

  /** Time ran out with nothing locked in: fetch the reveal and record a miss. */
  const revealMiss = useCallback(
    async (round: ActiveRound) => {
      if (roundRef.current !== round) return;
      setPhase({ name: "timeup", round });
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const { reveal } = await api.reveal(round.promptToken);
          finishRound(round, { tier: "miss", answer: null, typed: null, reveal });
          return;
        } catch (err) {
          // Our clock may run slightly ahead of the server's; wait a moment and retry.
          if (err instanceof ApiError && err.code === "too_early") {
            await new Promise((r) => setTimeout(r, 400));
            continue;
          }
          setPhase({ name: "error", message: errorMessage(err), retry: () => void revealMiss(round) });
          return;
        }
      }
      setPhase({ name: "error", message: "The server clock disagrees with yours.", retry: () => void revealMiss(round) });
    },
    [api, finishRound],
  );

  const timeUp = useCallback(() => {
    const round = roundRef.current;
    if (!round) return;
    // An answer sent before the deadline still counts: wait for it to come back.
    if (submittingRef.current) {
      expiredWhileSubmittingRef.current = true;
      return;
    }
    // A "Did you mean …?" still showing at the buzzer counts as yes (the server allows a short grace).
    const pending = suggestionRef.current;
    if (pending && sameText(pending.text, draftRef.current)) {
      void submitRef.current(pending.text, { atBuzzer: true });
      return;
    }
    void revealMiss(round);
  }, [revealMiss]);

  const submit = useCallback(
    async (text: string, opts: { atBuzzer?: boolean } = {}) => {
      const round = roundRef.current;
      if (!round || submittingRef.current) return;
      if (!text.trim()) {
        showFeedback("empty", "Type an answer first.");
        return;
      }
      // Pressing Enter again on the same text confirms the suggested spelling.
      const confirm = !!suggestionRef.current && sameText(suggestionRef.current.text, text);
      submittingRef.current = true;
      expiredWhileSubmittingRef.current = !!opts.atBuzzer;
      setSubmitting(true);
      try {
        const res = await api.answer(round.promptToken, text, confirm || undefined);
        if (roundRef.current !== round) return;
        if (res.status !== "confirm") setSuggestion(null);
        switch (res.status) {
          case "confirm":
            playSfx({ name: "suggest" });
            setFeedback(null);
            setSuggestion({ text: text.trim(), canonical: res.suggestion });
            if (opts.atBuzzer) expiredWhileSubmittingRef.current = true;
            return;
          case "accepted":
            playSfx({ name: "lock" });
            expiredWhileSubmittingRef.current = false;
            finishRound(round, { tier: res.answer.tier, answer: res.answer, typed: text.trim(), reveal: res.reveal });
            return;
          case "too_late":
            expiredWhileSubmittingRef.current = false;
            finishRound(round, { tier: "miss", answer: null, typed: null, reveal: res.reveal });
            return;
          default:
            playSfx({ name: "wrong" });
            showFeedback(res.status, res.message);
        }
      } catch (err) {
        if (roundRef.current === round) showFeedback("error", errorMessage(err));
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
        if (expiredWhileSubmittingRef.current && roundRef.current === round) {
          expiredWhileSubmittingRef.current = false;
          void revealMiss(round);
        }
      }
    },
    [api, finishRound, revealMiss],
  );
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const noteDraft = useCallback((text: string) => {
    draftRef.current = text;
  }, []);

  const next = useCallback(() => {
    if (phase.name !== "reveal") return;
    if (phase.index + 1 < count) void loadPrompt(phase.index + 1);
    else setPhase({ name: "finished" });
  }, [phase, count, loadPrompt]);

  const totalPoints = results.reduce((sum, r) => sum + r.points, 0);

  return { phase, results, count, totalPoints, diveToken, feedback, suggestion, submitting, start, submit, noteDraft, timeUp, next };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}
