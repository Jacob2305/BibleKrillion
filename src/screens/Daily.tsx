import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { dayKey, dayLabel } from "../../lib/game/daily";
import { BigButton, DivePlayer } from "../game/DivePlayer";
import { createDailyApi } from "../lib/api";
import { Link } from "../lib/router";
import { getDailyRecord, getDeviceId, getNickname, setDailyRecord, setNickname } from "../lib/storage";
import { APP_NAME } from "../../lib/game/brand";
import { SkyPage } from "../game/Sky";
import { DailyFinish } from "./DailyFinish";

type View = { name: "intro" } | { name: "dive"; nickname: string } | { name: "done"; token: string };

export default function Daily() {
  const today = useMemo(() => dayKey(Date.now()), []);
  const [view, setView] = useState<View>(() => {
    const record = getDailyRecord(today);
    if (record?.status === "done") return { name: "done", token: record.token };
    const nickname = getNickname();
    // Mid-dive refresh: go straight back in; the server resumes the same attempt and deadlines.
    if (record?.status === "playing" && nickname) return { name: "dive", nickname };
    return { name: "intro" };
  });

  if (view.name === "done") {
    return (
      <Shell>
        <DailyFinish token={view.token} />
      </Shell>
    );
  }

  if (view.name === "dive") {
    return <DailyDive nickname={view.nickname} />;
  }

  return (
    <Shell>
      <NicknameForm
        day={today}
        onStart={(nickname) => {
          setNickname(nickname);
          setView({ name: "dive", nickname });
        }}
      />
    </Shell>
  );
}

function DailyDive({ nickname }: { nickname: string }) {
  const api = useMemo(
    () =>
      createDailyApi({
        deviceId: getDeviceId(),
        nickname,
        onStart: (res) => {
          if (res.day) setDailyRecord({ day: res.day, status: res.finished ? "done" : "playing", token: res.dive });
        },
      }),
    [nickname],
  );
  return (
    <DivePlayer
      api={api}
      modeLabel="Daily Ascent"
      autoStart
      renderFinished={({ diveToken }) => (diveToken ? <DailyFinish token={diveToken} /> : null)}
    />
  );
}

function NicknameForm({ day, onStart }: { day: string; onStart: (nickname: string) => void }) {
  const [name, setName] = useState(getNickname);
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = name.replace(/\s+/g, " ").trim();
    if (!clean) {
      setError("Pick a name so we can save your ascent.");
      return;
    }
    onStart(Array.from(clean).slice(0, 24).join(""));
  };
  return (
    <form onSubmit={submit} className="pixel-panel space-y-6 p-5">
      <div className="space-y-3">
        <p className="text-sm font-semibold tracking-widest text-sun-300/80 uppercase">{dayLabel(day)}</p>
        <h1 className="font-display text-4xl font-bold">Daily Ascent</h1>
        <p className="text-lg text-cloud-50/80">Today's 7 prompts are the same for everyone. Rarer right answers rise higher.</p>
        <ul className="space-y-1.5 text-cloud-50/70">
          <li>• One official ascent per device per day, so make it count.</li>
          <li>• 25 seconds per prompt. Keep guessing until something is in the bank.</li>
          <li>• Afterwards, share your climb (no spoilers) and see how everyone answered.</li>
        </ul>
      </div>
      <div className="space-y-2">
        <label htmlFor="nickname" className="block font-medium">
          Your name
        </label>
        <input
          id="nickname"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          maxLength={24}
          autoComplete="nickname"
          autoCapitalize="words"
          enterKeyHint="go"
          aria-invalid={error ? true : undefined}
          aria-describedby="nickname-help"
          className="w-full rounded-2xl border-0 bg-white/95 px-4 py-3.5 text-lg text-night-950 placeholder:text-slate-400 focus:ring-4 focus:ring-sun-300/60 focus:outline-none"
          placeholder="e.g. High Flying Hannah"
        />
        <p id="nickname-help" className={`text-sm ${error ? "text-amber-200" : "text-cloud-50/50"}`}>
          {error ?? "No account needed. Just a name for your results."}
        </p>
      </div>
      <BigButton type="submit">Start today's ascent</BigButton>
    </form>
  );
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
