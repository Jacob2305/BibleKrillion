# Bible Dive

A Bible trivia game where **rarer correct answers climb higher**. Answer 7 open-ended prompts
("Name a judge of Israel") in 25 seconds each. Common answers score a little; obscure ones score a lot.

> Full setup and deploy guide (Supabase, Vercel, env vars, pre-event checklist) is written in step 8.

**Live:** https://bible-dive-nu.vercel.app · before an event, go through [EVENT-CHECKLIST.md](EVENT-CHECKLIST.md).

## Develop

```bash
npm install
npm test                # Vitest: scoring, matching, bank validation
npm run typecheck
npm run dev             # app + /api functions at http://localhost:5173 (works without Supabase: Daily and live rooms use a temporary in-memory store)
npm run validate-bank   # check data/prompts.json (add -- --quiet to hide warnings)
npm run review-bank     # list answers marked needs_review
npm run format-bank     # re-lay-out prompts.json after hand edits
npm run check-supabase  # is the Supabase project set up right? (tables, grants, RLS, realtime)
npm run check-judge     # is the AI judge working? (2 sample answers to Gemini)
npm run load-test       # one live room with 100 simulated phones (-- --base URL --pin PIN --realtime)
npm run merge-approved  # copy host-approved AI answers into data/prompts.json (-- --dry-run to preview)
```

## Layout

| Path | What lives there |
| --- | --- |
| `lib/game/` | Pure game logic shared by server and client: `scoring.ts`, `normalize.ts`, `levenshtein.ts`, `matching.ts` |
| `api/` | Vercel serverless functions: `practice`, `daily`, `live` (thin wrappers around `server/`) |
| `server/` | Server-only logic: the answer bank, sealed tokens, Daily and live-room stores, realtime broadcasts |
| `data/prompts.json` | The answer bank. **Server-only**; never imported from `src/` |
| `src/` | React + Tailwind client |
| `scripts/` | `validate-bank`, `review-bank`, `merge-approved`, load test |
| `supabase/migrations/` | SQL schema |

## Look and feel

Pixel-art climb: the background of every screen is one tall world, one zone per tier: the sea (Plankton), the
creekside town on the cliff (Too Clever), open sky (Schooler), the edge of space (Rare), outer space (Deep Cut) and the
cosmos (One in a Million). It rests at sea level; at each reveal the camera flies up to the answer's tier, lands with a
flash and stays there (Next / See possible answers), then glides back down for the next prompt. Before a prompt and
after a landing, players can scroll or drag the background to look around the map. All art is original and drawn in
code (`src/game/climb/`: scenes, sprites, the camera and the reveal; `src/game/pixel.tsx`: the sprite renderer).

Sounds are tiny chiptune effects synthesized in the browser (`src/lib/sound.ts`, no audio files); the 🔊 button mutes
them and is remembered per device. Everything works by keyboard (Enter to answer, any key skips the climb, Escape
closes the answer list), and people who ask their device for reduced motion get the reveal without the flight.
Fonts are free Google Fonts: Jersey 15 (text), Pixelify Sans (logo and room codes), VT323 (numbers). The game's name
lives in one place, `lib/game/brand.ts` (plus the `<title>` in `index.html`).

## Scoring

| Tier | Points |
| --- | --- |
| Plankton | 10 |
| Too Clever | 15 |
| Schooler | 30 |
| Rare | 60 |
| Deep Cut | 85 |
| One in a Million | 100 |
| Miss | 0 |

Max 700 per dive; 1 point = 10 m of depth. Dive rating: 0–150 Plankton, 151–250 Schooler,
251–350 Rare, 351–449 Deep Cut, 450+ One in a Million.

## Matching

Answers are normalized (lowercase, accents/punctuation stripped, leading *the / st / saint / king /
prophet / apostle* dropped, "First/1st/I Kings" → "1 kings"), then matched exact-or-alias first, then
fuzzy (Levenshtein ≤1 edit for terms ≤5 chars, ≤2 for longer; terms under 3 chars must be exact).
If two different answers tie for the closest fuzzy match, the player is asked to be more specific.
A fuzzy (corrected-spelling) match isn't locked in straight away: the player sees "Did you mean **Nehemiah**?" above the
answer box and presses Enter to confirm, or edits it. If time runs out with the suggestion still showing, it counts.
Exact matches and listed aliases go straight through. None of this uses the AI judge.

## The prompt bank (`data/prompts.json`)

A JSON array of prompts. Each answer sits on one line so it's easy to review and diff.

```jsonc
{
  "id": "the-twelve",                       // kebab-case, unique
  "prompt": "Name one of Jesus' twelve apostles (Matthias counts)",
  "category": "Apostles",
  "testament": "NT",                        // "OT" | "NT" | "both"
  "difficulty": "easy",                     // optional: "easy" | "medium" | "hard"
  "closed_set": true,                       // true = every valid answer is listed; unlisted answers are rejected
  "strip_prefixes": ["mount", "mt"],        // optional: filler removed from the START of input ("Mount Sinai" -> "sinai")
  "answers": [
    {"canonical":"James","aliases":[],"tier":"plankton","reference":"Matthew 10:2-3","generic_for":["James son of Zebedee","James son of Alphaeus"]},
    {"canonical":"James son of Alphaeus","aliases":["James the Less"],"tier":"deep_cut","reference":"Matthew 10:3","needs_review":true,"review_note":"why it needs checking"},
    {"canonical":"Matthias","aliases":[],"tier":"one_in_a_million","reference":"Acts 1:26","gem_note":"Shown at reveal."}
  ]
}
```

- **Tiers:** `plankton`, `too_clever`, `schooler`, `rare`, `deep_cut`, `one_in_a_million` (gem; needs a `gem_note`).
- **Shared names:** when a name could mean several answers ("James", "Mary", "Kings"), add it as its own
  answer with `generic_for` listing the specific answers. The validator makes sure the generic scores
  less than at least one specific answer and never more than any of them, so being specific pays.
- **Rules enforced by `validate-bank`:** valid schema and tiers; every answer has a reference that starts with a
  book of the 66-book canon; every prompt has ≥8 answers and ≥1 gem; no name/alias (after normalization)
  appears in two answers of the same prompt. Fuzzy near-collisions (e.g. Eli vs Elon) are warnings only.
- **Workflow for hand edits:** edit the JSON → `npm run format-bank` → `npm run validate-bank` → `npm test`.
  Clear `needs_review`/`review_note` once you've checked an answer.
- The bank is **server-only**: the Vite build fails if client code imports it.

## Live Event Room

For a room full of people with one projector.

1. **Host** opens `/host` on a laptop, picks prompts (3–12), seconds per prompt, and teams on/off, then clicks **Create room**.
   If `HOST_PIN` is set, the page asks for it.
2. Click **Open projector screen**, drag that window to the projector and press F11. It shows the 4-letter room code,
   a QR code to `/join?code=XXXX`, and the names as people join.
3. **Players** scan the QR (or open `/join` and type the code), pick a nickname (and a team, if on). A refresh or a dropped
   connection rejoins them as the same player.
4. The host console drives everything: **Start** → players type answers; the first accepted answer locks in (its tier stays a
   surprise) → the timer ends early once everyone has locked in, or use **Stop the timer** → **Reveal** shows every answer with
   how many picked it, and who found the deep ones → **Show leaderboard** (optional) → **Next prompt** … → **Final results**
   (podium, plus team standings by average depth).
5. Host tools: swap upcoming prompts, remove a player (they vanish from the screen and boards; **Restore** undoes it),
   **End room** when you're done.

How it stays in sync: the server is the only authority (deadlines, matching, scores). Each host action pushes one snapshot
to every phone over Supabase Realtime *broadcast* on a private channel; phones can listen but not send. If a phone's socket
drops it falls back to polling every few seconds, and it refreshes whenever the screen wakes. The host console and projector
also poll every 2 s during the lobby and while answers come in, for the live "locked in" count. Rooms hold up to 150
players (the Supabase free tier allows 200 realtime connections) and expire after 12 hours.

## AI judge (optional, free)

When an answer isn't in the bank, an AI can rule on it. Off unless `GEMINI_API_KEY` is set; the game works fully without it.

- **Closed-set prompts** (books of the Bible, the 12 tribes…) never use it: every valid answer is already listed.
- **Open prompts:** the server asks Google Gemini (`gemini-3.5-flash-lite` by default, on the free tier) for a strict JSON
  ruling `{ valid, canonical, reference, reason }`. The server double-checks it (a real book of the Bible, a name).
  Valid answers score **Deep Cut (85)** with a ✨ AI judge badge. If the AI recognises an answer that *is* in the bank
  (a spelling the matcher missed), the player gets that answer's normal tier.
- **Same ruling for everyone:** every verdict is cached per prompt + normalized answer (`judge_cache`), so the AI is asked once.
- **Limits:** 3 AI calls per player per prompt and 500 per day for the whole app (`JUDGE_CALLS_PER_PROMPT`, `JUDGE_DAILY_LIMIT`).
  Cached answers don't count. Over the limit, unlisted answers are simply rejected.
- **Timing:** players see "Asking the judge…"; an answer sent before the buzzer counts even if the ruling lands after it.
  (Live rooms: if the host reveals before the ruling arrives, that answer doesn't count.)
- **Host review:** the live host console lists the room's AI-accepted answers with **Approve** / **Reject** (rejecting takes
  the points away in that room and makes future players' copies wrong). `/review` (protected by `HOST_PIN`) does the same for
  answers from Daily and Practice.
- **Growing the bank:** `npm run merge-approved` adds approved answers to `data/prompts.json` as Deep Cut with `needs_review: true`,
  re-validates the bank, and marks them merged. Check them with `npm run review-bank`, adjust tiers if you like, then redeploy.

**Setup:** get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey), put it in `.env.local` as
`GEMINI_API_KEY=…` (and later in Vercel), restart `npm run dev`, and run `npm run check-judge`. Note: on Google's free tier,
requests may be used to improve Google's products. The judge only ever sends the prompt and the typed answer (no names, no
device ids).

## Load test

`npm run load-test` runs one live room the way an event would: the host creates it, 100 phones join within a few
seconds, and for each round they answer at random moments (most right, some wrong first, some confirming a typo, a few
not at all) while polling like the real app; then reveal, leaderboard, final. It prints response times per call and
checks every locked answer was counted. Options: `--players 150`, `--rounds 5`, `--seconds 20`, `--base
https://your-app.vercel.app`, `--pin 1234` (if HOST_PIN is set), `--realtime` (each phone also listens on the Supabase
broadcast channel). It creates a real room, so against production run it before the event, not during one.

## Supabase setup (Daily Dive results and live rooms)

Free tier is plenty. About 10 minutes:

1. Go to [supabase.com](https://supabase.com), sign in, and click **New project**. Name it `bible-dive`, set a
   database password (save it in your password manager; the app doesn't need it), pick the region closest to you, and click **Create**.
2. When it's ready, open **SQL Editor** → **New query**. Paste the whole contents of
   `supabase/migrations/0001_daily.sql` and click **Run**. You should see "Success. No rows returned".
   Then do the same with `supabase/migrations/0002_live.sql` and `0003_judge.sql`. Run any later migration files the same way, in number order.
   (All migrations are safe to re-run: if a file changes, just run it again.)
3. Open **Project Settings → API Keys** (older projects: **Settings → API**) and copy:
   - **Project URL** → `SUPABASE_URL`
   - **anon / publishable** key → `SUPABASE_ANON_KEY`
   - **service_role / secret** key → `SUPABASE_SERVICE_ROLE_KEY` (**server only**; never put it in client code or share it)
4. In the project folder, copy `.env.example` to `.env.local` and paste those three values in.
   (`.env.local` is git-ignored; it never gets committed.)
5. Open **Realtime → Settings** and turn **off** "Allow public access" (so only private, server-controlled channels exist),
   then **Save**.
6. Run `npm run check-supabase`. Every line should be a green ✓.
7. Restart `npm run dev`. Daily results now save to Supabase: check **Table Editor → daily_results** after a dive.
   Live rooms land in **rooms / players / rounds / submissions**. Rejected answers land in **rejected_answers**, handy for
   growing the bank.

**Security:** every table has Row Level Security on with no public policies, so the anon key can't read or write
anything. All game writes go through the `/api` functions using the service-role key. The one policy is on
`realtime.messages`: browsers may *receive* broadcasts on `room:…` topics, never send them.

**Housekeeping (optional):** old rooms just sit there. To clear rooms older than a month, run
`delete from rooms where created_at < now() - interval '30 days';` (players, rounds and submissions go with them).

**Free projects pause after about a week without activity.** Before an event, open the Supabase dashboard; if the
project says *Paused*, click **Restore project** and wait a couple of minutes. Do this the day before, not the
morning of. Playing a dive also counts as activity.
