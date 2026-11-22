import { APP_NAME, TAGLINE } from "../../lib/game/brand";
import { dayKey } from "../../lib/game/daily";
import { METERS_PER_POINT, TIER_INFO, TIER_ORDER } from "../../lib/game/scoring";
import { Dove } from "../game/pixel";
import { SkyPage } from "../game/Sky";
import { TierBadge } from "../game/TierBadge";
import { Link } from "../lib/router";
import { getDailyRecord } from "../lib/storage";

export default function Home() {
  const today = getDailyRecord(dayKey(Date.now()));
  const dailyBlurb =
    today?.status === "done" && today.total !== undefined
      ? `✓ Done today: ${(today.total * METERS_PER_POINT).toLocaleString("en-US")} m. See how everyone answered.`
      : today?.status === "playing"
        ? "You're mid-climb. Jump back in."
        : "Same 7 prompts for everyone, today only.";
  return (
    <SkyPage>
      <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-8 px-4 py-10">
        <header className="pixel-panel flex flex-col items-center p-5 text-center">
          <Dove className="mb-4 w-24 animate-bob drop-shadow-[4px_4px_0_rgba(0,0,0,0.35)]" />
          <h1 className="font-logo text-5xl font-bold tracking-wide text-sun-300 uppercase [text-shadow:4px_4px_0_rgba(0,0,0,0.45)]">
            {APP_NAME}
          </h1>
          <p className="mt-3 text-lg text-cloud-50/90 [text-shadow:2px_2px_0_rgba(0,0,0,0.4)]">{TAGLINE}</p>
        </header>

        <nav className="space-y-4" aria-label="Game modes">
          <ModeCard href="/daily" title="Daily Ascent" blurb={dailyBlurb} featured />
          <ModeCard href="/practice" title="Practice" blurb="Random prompts, as many climbs as you like." />
          <ModeCard href="/join" title="Join a live room" blurb="Playing at an event? Enter the code on the big screen." />
        </nav>

        <section aria-labelledby="how-heading" className="pixel-panel p-5">
          <h2 id="how-heading" className="mb-2 text-xl font-bold text-sun-300">
            How it works
          </h2>
          <p className="mb-4 text-cloud-50/85">
            Each prompt has many right answers. The answer everyone says barely gets you off the ground; the obscure one lifts you
            into the heights. 7 prompts · 25 seconds each · up to 7,000 m.
          </p>
          <ul className="space-y-2.5">
            {TIER_ORDER.filter((t) => t !== "miss").map((tier) => (
              <li key={tier}>
                <div className="flex items-center justify-between gap-3">
                  <TierBadge tier={tier} />
                  <span className="font-mono text-sun-300 tabular-nums">{TIER_INFO[tier].points} pts</span>
                </div>
                <p className="mt-0.5 text-sm text-cloud-50/65">{TIER_INFO[tier].blurb}</p>
              </li>
            ))}
          </ul>
        </section>

        <p className="text-center text-sm text-cloud-50/70">
          Running an event?{" "}
          <Link href="/host" className="text-sun-300 underline underline-offset-4">
            Host a live room
          </Link>
        </p>
      </main>
    </SkyPage>
  );
}

function ModeCard({ href, title, blurb, featured }: { href: string; title: string; blurb: string; featured?: boolean }) {
  return (
    <Link
      href={href}
      className={`pixel-button block p-5 transition-colors focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-white ${
        featured ? "bg-sun-400 text-night-950 hover:bg-sun-300" : "bg-night-800 text-cloud-50 hover:bg-night-700"
      }`}
    >
      <span className="flex items-center justify-between">
        <span className="text-2xl font-bold">{title}</span>
        <span aria-hidden="true" className="font-mono text-3xl">
          ▶
        </span>
      </span>
      <span className={`mt-1 block ${featured ? "text-night-950/80" : "text-cloud-50/75"}`}>{blurb}</span>
    </Link>
  );
}
