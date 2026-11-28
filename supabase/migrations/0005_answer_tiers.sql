-- Bible Dive — migration 0005: permanent tier changes.
-- Run in Supabase → SQL Editor after 0004 (paste the whole file, click Run). Safe to re-run.

-- When the host moves an answer to another tier, it's saved here for good:
-- every new room, Practice and the Daily use it. `npm run merge-tiers` copies
-- these into data/prompts.json (and then they can be cleared).
create table if not exists public.answer_tiers (
  prompt_id  text not null check (char_length(prompt_id) <= 80),
  canonical  text not null check (char_length(canonical) <= 120),
  tier       text not null check (tier in ('plankton', 'too_clever', 'schooler', 'rare', 'deep_cut', 'one_in_a_million')),
  updated_at timestamptz not null default now(),
  primary key (prompt_id, canonical)
);

-- Same security model as earlier migrations: only the server (service role) touches it.
alter table public.answer_tiers enable row level security;
grant select, insert, update, delete on public.answer_tiers to service_role;
