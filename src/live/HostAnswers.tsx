/**
 * Host console: every answer for one prompt, in a column per tier. Drag an
 * answer to another column (or use its tier menu) to change what it scores in
 * every future room (saved permanently). Host only — the list comes from a PIN-protected host request.
 */
import { useCallback, useEffect, useState, type DragEvent } from "react";
import type { LiveHostAnswer, LiveHostAnswers, LiveHostResponse } from "../../lib/game/live-types";
import { ANSWER_TIERS, TIER_INFO, type AnswerTier } from "../../lib/game/scoring";
import { TierBadge } from "../game/TierBadge";
import { TIER_STYLE } from "../game/tierStyle";
import { liveApi } from "./liveApi";

/** Our own drag type, so another draggable's data is never read as an answer. */
const DRAG_TYPE = "application/x-bible-dive-answer";

export function HostAnswers({
  token,
  index,
  version,
  onAccept,
}: {
  token: string;
  index: number;
  /** The room version: the list reloads when the room changes. */
  version: number;
  /** Hands a full host response back to the console (fresh snapshot and host info). */
  onAccept: (data: LiveHostResponse) => void;
}) {
  const [data, setData] = useState<LiveHostAnswers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [over, setOver] = useState<AnswerTier | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  /** The answer that just landed in a new tier, flashed briefly so the move is obvious. */
  const [landed, setLanded] = useState<string | null>(null);
  useEffect(() => {
    if (!landed) return;
    const t = window.setTimeout(() => setLanded(null), 1600);
    return () => window.clearTimeout(t);
  }, [landed]);

  const load = useCallback(async () => {
    try {
      const res = await liveApi.host(token, "answers", { index });
      if (res.host.answers) setData(res.host.answers);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the answers.");
    }
  }, [token, index]);

  useEffect(() => {
    void load();
  }, [load, version]);

  const move = async (canonical: string, tier: AnswerTier) => {
    const current = data?.answers.find((a) => a.canonical === canonical);
    if (!data || !current || current.tier === tier) return;
    // Show the move straight away; the server's reply replaces it.
    setData({ ...data, answers: data.answers.map((a) => (a.canonical === canonical ? { ...a, tier } : a)) });
    setSaving(canonical);
    setLanded(canonical);
    setError(null);
    try {
      const res = await liveApi.host(token, "retier", { index, canonical, tier });
      if (res.host.answers) setData(res.host.answers);
      onAccept(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't move that answer.");
      void load();
    } finally {
      setSaving(null);
    }
  };

  if (!data) {
    return <p className="px-1 py-2 text-sm text-cloud-50/60">{error ?? "Loading answers…"}</p>;
  }

  const moved = data.answers.filter((a) => a.tier !== a.baseTier).length;
  const onDrop = (tier: AnswerTier) => (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(null);
    setDragging(null);
    const canonical = e.dataTransfer.getData(DRAG_TYPE);
    if (canonical) void move(canonical, tier);
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-cloud-50/60">
        {data.answers.length} answers
        {moved > 0 && <span className="text-sun-300"> · {moved} moved</span>}
      </p>
      {error && (
        <p role="alert" className="text-sm text-amber-200">
          {error}
        </p>
      )}
      <div className="grid gap-2 overflow-x-auto pb-1 sm:grid-cols-2 xl:grid-cols-3">
        {ANSWER_TIERS.map((tier) => {
          const list = data.answers.filter((a) => a.tier === tier);
          return (
            <section
              key={tier}
              aria-label={`${TIER_INFO[tier].label} answers`}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "move";
                if (over !== tier) setOver(tier);
              }}
              onDragLeave={(e) => {
                // Moving over an answer inside the column isn't leaving it.
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                setOver((t) => (t === tier ? null : t));
              }}
              onDrop={onDrop(tier)}
              className={`flex min-h-24 flex-col rounded-xl border-2 bg-night-950/60 p-2 transition-colors ${
                over === tier ? "border-sun-300 bg-night-700/70" : TIER_STYLE[tier].row
              }`}
            >
              <h4 className="mb-1.5 flex items-center justify-between gap-2">
                <TierBadge tier={tier} />
                <span className="text-xs text-cloud-50/60 tabular-nums">
                  {TIER_INFO[tier].points} pts · {list.length}
                </span>
              </h4>
              <ul className="max-h-72 space-y-1 overflow-y-auto">
                {list.length === 0 && <li className="py-2 text-center text-xs text-cloud-50/40">—</li>}
                {list.map((a) => (
                  <AnswerChip
                    key={a.canonical}
                    answer={a}
                    saving={saving === a.canonical}
                    dragging={dragging === a.canonical}
                    landed={landed === a.canonical}
                    onDragStart={() => setDragging(a.canonical)}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    onMove={(t) => void move(a.canonical, t)}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function AnswerChip({
  answer: a,
  saving,
  dragging,
  landed,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  answer: LiveHostAnswer;
  saving: boolean;
  dragging: boolean;
  landed: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (tier: AnswerTier) => void;
}) {
  const moved = a.tier !== a.baseTier;
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.setData(DRAG_TYPE, a.canonical);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`flex cursor-grab items-center gap-2 rounded-lg px-2 py-1 text-sm transition-colors active:cursor-grabbing ${
        landed ? "bg-sun-300/30 ring-2 ring-sun-300" : "bg-white/5"
      } ${dragging ? "opacity-40" : ""} ${saving ? "opacity-60" : ""}`}
      title={a.reference}
    >
      <span className="min-w-0 flex-1 truncate">
        {a.canonical}
        {a.ai && <span className="ml-1 text-xs text-cloud-50/50">✨AI</span>}
        {moved && <span className="ml-1 text-xs text-sun-300">(was {TIER_INFO[a.baseTier].label})</span>}
      </span>
      {a.count > 0 && <span className="shrink-0 text-xs font-semibold text-sun-300 tabular-nums">×{a.count}</span>}
      <select
        aria-label={`Tier for ${a.canonical}`}
        value={a.tier}
        onChange={(e) => onMove(e.target.value as AnswerTier)}
        className="w-6 shrink-0 cursor-pointer appearance-none rounded border-0 bg-white/10 px-1 py-0.5 text-center text-xs text-cloud-50 focus:ring-2 focus:ring-sun-300 focus:outline-none"
      >
        {ANSWER_TIERS.map((t) => (
          <option key={t} value={t} className="text-night-950">
            {TIER_INFO[t].emoji} {TIER_INFO[t].label}
            {t === a.baseTier ? " (bank)" : ""}
          </option>
        ))}
      </select>
    </li>
  );
}
