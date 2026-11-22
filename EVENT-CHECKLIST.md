# Pre-event checklist

Live site: **https://bible-dive-nu.vercel.app**

| Who | Opens |
| --- | --- |
| You (laptop) | `/host`: needs your host PIN (it's `HOST_PIN` in `.env.local`) |
| Projector | `/screen?code=XXXX` (the host console has a button for it) |
| Players | scan the QR code on the projector, or go to `/join` and type the code |

## A week before

- [ ] **Wake Supabase.** Free Supabase projects pause after about a week with no activity. Open the Supabase dashboard
      and make sure the project is running (press *Restore* if it's paused). Do this again the day before.
- [ ] Run `npm run check-supabase`: every line should be ✓.
- [ ] Optional hardening: Supabase → Realtime → Settings → turn **off** "Allow public access" (the app only uses
      private channels).
- [ ] Look over the answer bank: `npm run review-bank`. Edit `data/prompts.json`, then `git commit` and `git push`
      (Vercel redeploys automatically once GitHub is connected).
- [ ] Load test the live site (not during an event; it creates a test room):
      `npm run load-test -- --base https://bible-dive-nu.vercel.app --pin YOUR_PIN --realtime`. It should end in
      **PASS ✓**. (Tested 2026-11-21: 100 phones, 3 rounds, all checks passed, answers in about 0.2 s.)
- [ ] AI judge (optional): get a free key at https://aistudio.google.com/apikey and add it in Vercel → Project
      **bible-dive** → Settings → Environment Variables as `GEMINI_API_KEY`, then **redeploy** (Deployments → ⋯ →
      Redeploy). Check it with `npm run check-judge` (with the key also in `.env.local`).

## On the day

- [ ] Venue internet: make sure phones can get online (Wi-Fi details on a slide, or good mobile signal).
- [ ] On the laptop: open `/host`, enter the PIN, pick the number of prompts, seconds and whether teams are on,
      then **Create room**. Preview the prompts and swap any you don't want.
- [ ] On the projector: open the screen link, press **Full screen**, and click the page once so sound can play
      (🔊 mutes it).
- [ ] Join from your own phone and play one prompt to check everything (the room can be ended and recreated).
- [ ] Check the QR code scans from the back of the room; the 4-letter code and `/join` link are shown too.

## During the game

- Host buttons: **Start** → (players answer; the timer closes early when everyone has answered) → **Reveal answers**
  → **Show leaderboard** → **Next prompt** … → **Final results**.
- A phone that refreshes or sleeps rejoins its own seat automatically.
- The projector lost its connection? Reload the page; it rejoins the same room.
- Remove a player: Players list → **Remove**.
- AI-accepted answers (if the judge is on) appear in the host console: **Approve** or **Reject** (rejecting takes
  the points away).
- Up to 150 players per room.

## Afterwards

- [ ] Press **End room** in the host console.
- [ ] Review AI-judged answers at `/review` (same PIN). Approved ones go into the bank with `npm run merge-approved`,
      then commit and push.
- [ ] Old rooms and test data can be cleared with the housekeeping SQL in the README (Supabase section).

## Settings on Vercel

Project **bible-dive** → Settings → Environment Variables (changing one needs a redeploy):

| Name | What |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | your Supabase project (same as `.env.local`) |
| `SESSION_SECRET` | random key that signs game tokens (generated; don't share) |
| `HOST_PIN` | PIN for `/host` and `/review` |
| `PROMPT_SECONDS` | seconds per prompt (30) |
| `GEMINI_API_KEY` | optional: turns the AI judge on |
