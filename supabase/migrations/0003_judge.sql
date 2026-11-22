-- Bible Dive — migration 0003: AI judge for unlisted answers.
-- Run in Supabase → SQL Editor after 0002 (paste the whole file, click Run). Safe to re-run.

-- ───────────────────────── judge_cache ─────────────────────────
-- One verdict per (prompt, normalized answer), so every player who types the
-- same thing gets the same ruling and the AI is asked only once.
create table if not exists public.judge_cache (
  prompt_id   text not null,
  normalized  text not null check (char_length(normalized) between 1 and 120),
  raw_text    text not null check (char_length(raw_text) <= 200),
  valid       boolean not null,
  canonical   text check (canonical is null or char_length(canonical) <= 80),
  reference   text check (reference is null or char_length(reference) <= 80),
  reason      text check (reason is null or char_length(reason) <= 300),
  model       text,
  -- auto: the AI's ruling stands · approved: a host confirmed it · rejected: a host overruled it
  -- merged: copied into data/prompts.json by `npm run merge-approved`
  status      text not null default 'auto' check (status in ('auto', 'approved', 'rejected', 'merged')),
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz,
  primary key (prompt_id, normalized)
);

create index if not exists judge_cache_review on public.judge_cache (status, created_at desc) where valid;

-- ───────────────────────── judge_calls ─────────────────────────
-- Rate-limit counters: per player per prompt, plus one per day for the whole app.
create table if not exists public.judge_calls (
  key        text primary key check (char_length(key) <= 200),
  calls      integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Atomically counts one call against `p_key`; true while still within `p_limit`.
create or replace function public.judge_take_call(p_key text, p_limit integer)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  n integer;
begin
  insert into public.judge_calls (key, calls) values (p_key, 1)
  on conflict (key) do update set calls = public.judge_calls.calls + 1, updated_at = now()
  returning calls into n;
  return n <= p_limit;
end;
$$;

-- ───────────────────────── live submissions ─────────────────────────
-- Answers the AI accepted aren't in the bank, so the submission carries its own reference.
alter table public.submissions add column if not exists ai boolean not null default false;
alter table public.submissions add column if not exists reference text;

-- ───────────────────────── security ─────────────────────────
alter table public.judge_cache enable row level security;
alter table public.judge_calls enable row level security;

revoke all on public.judge_cache, public.judge_calls from anon, authenticated;
grant select, insert, update, delete on public.judge_cache, public.judge_calls to service_role;

revoke all on function public.judge_take_call(text, integer) from public, anon, authenticated;
grant execute on function public.judge_take_call(text, integer) to service_role;
