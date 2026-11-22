-- Bible Dive — migration 0001: Daily Dive results + rejected-answer log.
-- Run in Supabase → SQL Editor (paste the whole file, click Run). Safe to re-run.
--
-- Security model: Row Level Security is ON and there are NO policies for the
-- public (anon) role, so browsers cannot read or write these tables at all.
-- Every read/write goes through the /api functions with the service-role key.

-- ───────────────────────── daily_results ─────────────────────────
-- One row per device per day. Created when the dive starts; `rounds` fills in
-- prompt by prompt; `finished_at`/`total` are set when the dive ends.
create table if not exists public.daily_results (
  id          uuid primary key default gen_random_uuid(),
  day         date not null,                       -- America/New_York calendar day
  device_id   text not null check (char_length(device_id) between 8 and 64),
  nickname    text not null check (char_length(nickname) between 1 and 24),
  prompt_ids  text[] not null,                     -- today's prompts, frozen at start
  -- [{ "promptId", "deadline" (epoch ms), "tier"?, "canonical"?, "doneAt"? }, ...]
  rounds      jsonb not null default '[]'::jsonb,
  total       integer check (total between 0 and 700),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  unique (day, device_id)
);

create index if not exists daily_results_finished_by_day
  on public.daily_results (day) where finished_at is not null;

alter table public.daily_results enable row level security;

-- ───────────────────────── rejected_answers ─────────────────────────
-- Every answer that wasn't accepted, for improving the bank later.
create table if not exists public.rejected_answers (
  id         bigint generated always as identity primary key,
  prompt_id  text not null,
  raw_text   text not null check (char_length(raw_text) <= 200),
  reason     text not null check (reason in ('not_in_bank', 'ambiguous')),
  mode       text not null check (mode in ('practice', 'daily', 'live')),
  created_at timestamptz not null default now()
);

create index if not exists rejected_answers_by_prompt
  on public.rejected_answers (prompt_id, created_at desc);

alter table public.rejected_answers enable row level security;

-- ───────────────────────── table privileges ─────────────────────────
-- Newer Supabase projects don't auto-grant tables to the API roles, so grant
-- the service role (used only by /api) explicitly, and make sure the browser
-- roles have nothing.
revoke all on public.daily_results, public.rejected_answers from anon, authenticated;
grant select, insert, update, delete on public.daily_results to service_role;
grant select, insert on public.rejected_answers to service_role;

-- ───────────────────────── aggregate helpers ─────────────────────────
-- How many finished divers gave each answer to each of a day's prompts.
-- (Counts are for fun at reveal; they never change anyone's points.)
create or replace function public.daily_distribution(p_day date)
returns table (prompt_id text, canonical text, tier text, n bigint)
language sql stable
set search_path = public
as $$
  select r->>'promptId', r->>'canonical', r->>'tier', count(*)
  from public.daily_results d
  cross join lateral jsonb_array_elements(d.rounds) as r
  where d.day = p_day and d.finished_at is not null
  group by 1, 2, 3;
$$;

-- Finished divers today, and how many of them scored lower than p_total.
create or replace function public.daily_standing(p_day date, p_total integer)
returns table (players bigint, shallower bigint)
language sql stable
set search_path = public
as $$
  select count(*), count(*) filter (where total < p_total)
  from public.daily_results
  where day = p_day and finished_at is not null;
$$;

revoke all on function public.daily_distribution(date) from public, anon, authenticated;
revoke all on function public.daily_standing(date, integer) from public, anon, authenticated;
grant execute on function public.daily_distribution(date) to service_role;
grant execute on function public.daily_standing(date, integer) to service_role;
