import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BigButton } from "../game/DivePlayer";
import { ApiError, post } from "../lib/api";
import { Link } from "../lib/router";

interface ReviewItem {
  promptId: string;
  prompt: string;
  canonical: string;
  reference: string;
  reason: string;
  variants: string[];
  status: "auto" | "approved" | "rejected" | "merged";
  firstSeen: number;
}

interface ListResponse {
  judgeEnabled: boolean;
  model: string;
  items: ReviewItem[];
}

const PIN_KEY = "bibledive:review-pin";

/** /review — approve or overrule answers the AI judge accepted (any mode). */
export default function Review() {
  const [pin, setPin] = useState(() => {
    try {
      return window.sessionStorage.getItem(PIN_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [needsPin, setNeedsPin] = useState(false);
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"todo" | "all">("todo");

  const load = useCallback(async (withPin: string) => {
    setError(null);
    try {
      const res = await post<ListResponse>("/api/review", { action: "list", pin: withPin });
      setData(res);
      setNeedsPin(false);
      try {
        window.sessionStorage.setItem(PIN_KEY, withPin);
      } catch {
        /* storage unavailable */
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "pin") setNeedsPin(true);
      setError(err instanceof Error ? err.message : "Couldn't load the list.");
    }
  }, []);

  useEffect(() => {
    void load(pin);
    // Only on first load; later loads pass the PIN explicitly.
  }, []);

  const decide = async (item: ReviewItem, decision: "approve" | "reject") => {
    try {
      await post("/api/review", { action: "review", pin, promptId: item.promptId, canonical: item.canonical, decision });
      await load(pin);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    }
  };

  const items = data?.items.filter((i) => filter === "all" || i.status === "auto") ?? [];
  return (
    <div className="min-h-dvh bg-night-900">
      <main className="mx-auto max-w-3xl px-4 pt-4 pb-16">
        <header className="mb-5 text-sm">
          <Link href="/host" className="px-1 py-1 text-cloud-50/70 hover:text-cloud-50">
            ← Host
          </Link>
        </header>
        <h1 className="font-display text-4xl font-bold">AI-judged answers</h1>
        <p className="mt-2 text-cloud-50/75">
          Answers players gave that aren't in the list, but the AI judge accepted (Deep Cut, 85 pts). Approve the good ones, then run{" "}
          <code className="font-mono text-sun-300">npm run merge-approved</code> to add them to the bank. Rejecting one means future
          players get it marked wrong.
        </p>

        {needsPin && (
          <form
            className="mt-6 flex items-end gap-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void load(pin);
            }}
          >
            <label className="space-y-1">
              <span className="block text-sm">Host PIN</span>
              <input
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                inputMode="numeric"
                autoFocus
                className="w-40 bg-white/95 px-3 py-2.5 font-mono tracking-widest text-night-950 focus:ring-4 focus:ring-sun-300/60 focus:outline-none"
              />
            </label>
            <div className="w-32">
              <BigButton type="submit">Open</BigButton>
            </div>
          </form>
        )}
        {error && (
          <p role="alert" className="mt-4 text-amber-200">
            {error}
          </p>
        )}

        {data && (
          <>
            <p className="mt-6 text-sm text-cloud-50/60">
              {data.judgeEnabled ? `Judge is on (${data.model}).` : "Judge is off: set GEMINI_API_KEY to turn it on."}
            </p>
            <div className="mt-4 flex gap-2" role="group" aria-label="Filter">
              {(["todo", "all"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 ring-2 ${filter === f ? "bg-sun-400 text-night-950 ring-sun-400" : "ring-white/20 hover:bg-white/10"}`}
                >
                  {f === "todo" ? `To check (${data.items.filter((i) => i.status === "auto").length})` : `All (${data.items.length})`}
                </button>
              ))}
            </div>
            <ul className="mt-4 space-y-3">
              {items.length === 0 && <li className="text-cloud-50/60">Nothing here yet.</li>}
              {items.map((item) => (
                <li key={`${item.promptId}|${item.canonical}`} className="space-y-2 bg-night-950/75 p-4 ring-2 ring-white/10">
                  <p className="text-sm text-cloud-50/60">{item.prompt}</p>
                  <p className="text-xl font-bold">
                    {item.canonical} <span className="font-normal text-cloud-50/70">· {item.reference}</span>
                  </p>
                  {item.reason && <p className="text-cloud-50/80">Judge: {item.reason}</p>}
                  <p className="text-sm text-cloud-50/50">Typed as: {item.variants.map((v) => `“${v}”`).join(", ")}</p>
                  {item.status === "auto" ? (
                    <div className="flex gap-3 pt-1">
                      <button type="button" onClick={() => void decide(item, "approve")} className="px-4 py-2 ring-2 ring-emerald-300/60 hover:bg-emerald-900/40">
                        Approve
                      </button>
                      <button type="button" onClick={() => void decide(item, "reject")} className="px-4 py-2 ring-2 ring-rose-300/60 hover:bg-rose-950/50">
                        Reject
                      </button>
                    </div>
                  ) : (
                    <p className={item.status === "rejected" ? "text-rose-200" : "text-emerald-200"}>
                      {item.status === "rejected" ? "Rejected" : item.status === "merged" ? "Added to the bank" : "Approved (run merge-approved)"}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
